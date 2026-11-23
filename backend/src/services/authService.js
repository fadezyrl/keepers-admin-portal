const { getAdminClient, getAnonClient } = require('../config/supabase');
const { query, withTransaction } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { writeAudit } = require('./auditService');
const { loadAuthContext } = require('../middleware/auth');

async function getMembershipLevelByCode(code) {
  const res = await query(
    `SELECT * FROM membership_levels WHERE code = $1 AND is_active = TRUE`,
    [code.toLowerCase()],
  );
  return res.rows[0] || null;
}

async function getRoleByCode(code) {
  const res = await query(`SELECT * FROM roles WHERE code = $1`, [code]);
  return res.rows[0] || null;
}

async function signup(payload, req) {
  const admin = getAdminClient();
  const anon = getAnonClient();
  if (!admin || !anon) {
    throw new AppError(503, 'AUTH_NOT_CONFIGURED', 'Supabase Auth is not configured');
  }

  const {
    email,
    password,
    firstName,
    lastName,
    username,
    phone,
    nationality,
    gender,
    emergencyContact,
    avatarUrl,
    vehicle,
    social,
    agreementAccepted,
  } = payload;

  if (!agreementAccepted) {
    throw new AppError(400, 'AGREEMENT_REQUIRED', 'You must accept the terms and privacy policy');
  }

  const existingUsername = await query(
    `SELECT id FROM member_profiles WHERE lower(username) = lower($1)`,
    [username],
  );
  if (existingUsername.rowCount > 0) {
    throw new AppError(409, 'USERNAME_TAKEN', 'Username is already taken');
  }

  const junior =
    (await getMembershipLevelByCode('junior_1')) ||
    (await getMembershipLevelByCode('junior'));
  const memberRole = await getRoleByCode('member');

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      first_name: firstName,
      last_name: lastName,
      username,
    },
  });

  if (error || !created?.user) {
    throw new AppError(400, 'SIGNUP_FAILED', error?.message || 'Unable to create account');
  }

  const userId = created.user.id;

  try {
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO member_profiles (
          id, first_name, last_name, username, email, phone, nationality, gender,
          avatar_url, membership_level_id, status, agreement_accepted_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending', NOW())`,
        [
          userId,
          firstName,
          lastName,
          username,
          email.toLowerCase(),
          phone || null,
          nationality || null,
          gender || null,
          avatarUrl || null,
          junior?.id || null,
        ],
      );

      if (vehicle) {
        await client.query(
          `INSERT INTO vehicles (user_id, manufacturer, model, model_year, vin, image_url, is_primary)
           VALUES ($1,$2,$3,$4,$5,$6,TRUE)`,
          [
            userId,
            vehicle.manufacturer,
            vehicle.model,
            vehicle.year || null,
            vehicle.vin || null,
            vehicle.image || null,
          ],
        );
      }

      if (emergencyContact) {
        await client.query(
          `INSERT INTO emergency_contacts (user_id, phone) VALUES ($1, $2)`,
          [userId, emergencyContact],
        );
      }

      if (social) {
        for (const platform of ['instagram', 'facebook', 'tiktok']) {
          if (social[platform]) {
            await client.query(
              `INSERT INTO social_links (user_id, platform, handle_or_url)
               VALUES ($1, $2, $3)`,
              [userId, platform, social[platform]],
            );
          }
        }
      }

      await client.query(
        `INSERT INTO notification_preferences (user_id) VALUES ($1)`,
        [userId],
      );

      if (memberRole) {
        await client.query(
          `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`,
          [userId, memberRole.id],
        );
      }
    });
  } catch (err) {
    await admin.auth.admin.deleteUser(userId);
    throw err;
  }

  await writeAudit({
    actorId: userId,
    action: 'member.signup',
    entityType: 'member_profiles',
    entityId: userId,
    metadata: { email, username, status: 'pending' },
    req,
  });

  return {
    userId,
    email,
    status: 'pending',
    message: 'Registration received. An Admin must approve your membership before you can sign in.',
  };
}

async function login(email, password) {
  const anon = getAnonClient();
  if (!anon) {
    throw new AppError(503, 'AUTH_NOT_CONFIGURED', 'Supabase Auth is not configured');
  }

  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data?.session) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const ctx = await loadAuthContext(data.user.id);
  if (!ctx.profile) {
    // Soft-deleted / scrubbed profiles are excluded from loadAuthContext
    const gone = await query(
      `SELECT id FROM member_profiles WHERE id = $1 AND deleted_at IS NOT NULL`,
      [data.user.id],
    );
    if (gone.rows[0]) {
      throw new AppError(403, 'ACCOUNT_DELETED', 'This account has been permanently deleted');
    }
    throw new AppError(403, 'PROFILE_REQUIRED', 'Member profile not found');
  }

  if (ctx.profile.status === 'pending') {
    // Still return session so Admin portal can... no, members pending shouldn't use app.
    // Admins created via seed won't be pending. Reject app access for pending.
    return {
      session: data.session,
      user: summarizeUser(data.user, ctx),
      accessBlocked: true,
      blockReason: 'PENDING_APPROVAL',
      message: 'Your membership is pending Admin approval',
    };
  }

  if (ctx.profile.status === 'suspended') {
    throw new AppError(403, 'SUSPENDED', 'Your account has been deactivated');
  }
  if (ctx.profile.deleted_at) {
    throw new AppError(403, 'ACCOUNT_DELETED', 'This account has been permanently deleted');
  }
  if (ctx.profile.status === 'rejected') {
    throw new AppError(403, 'REJECTED', 'Your membership application was rejected');
  }

  return {
    session: data.session,
    user: summarizeUser(data.user, ctx),
    accessBlocked: false,
  };
}

async function me(userId) {
  const ctx = await loadAuthContext(userId);
  if (!ctx.profile) {
    throw new AppError(404, 'NOT_FOUND', 'Profile not found');
  }

  const vehicle = await query(
    `SELECT * FROM vehicles WHERE user_id = $1 AND deleted_at IS NULL ORDER BY is_primary DESC, created_at ASC LIMIT 1`,
    [userId],
  );
  const social = await query(`SELECT platform, handle_or_url FROM social_links WHERE user_id = $1`, [
    userId,
  ]);
  const emergency = await query(
    `SELECT id, name, phone, relationship FROM emergency_contacts WHERE user_id = $1`,
    [userId],
  );
  const prefs = await query(`SELECT * FROM notification_preferences WHERE user_id = $1`, [userId]);

  const socialMap = {};
  for (const row of social.rows) socialMap[row.platform] = row.handle_or_url;

  return {
    id: ctx.profile.id,
    firstName: ctx.profile.first_name,
    lastName: ctx.profile.last_name,
    username: ctx.profile.username,
    email: ctx.profile.email,
    phone: ctx.profile.phone,
    nationality: ctx.profile.nationality,
    gender: ctx.profile.gender,
    avatar: ctx.profile.avatar_url,
    membership:
      ctx.profile.membership_display_name ||
      ctx.profile.membership_name ||
      ctx.profile.membership_code,
    membershipDisplayName:
      ctx.profile.membership_display_name || ctx.profile.membership_name,
    membershipCode: ctx.profile.membership_code,
    membershipRank: ctx.profile.membership_rank,
    membershipRankGroup: ctx.profile.membership_rank_group,
    membershipLevelNumber: ctx.profile.membership_level_number,
    completedTrips: ctx.profile.completed_trips,
    status: ctx.profile.status,
    roles: ctx.roles,
    permissions: ctx.permissions,
    vehicle: vehicle.rows[0]
      ? {
          id: vehicle.rows[0].id,
          manufacturer: vehicle.rows[0].manufacturer,
          model: vehicle.rows[0].model,
          year: vehicle.rows[0].model_year,
          vin: vehicle.rows[0].vin,
          image: vehicle.rows[0].image_url,
        }
      : null,
    social: socialMap,
    emergencyContacts: emergency.rows,
    notificationPrefs: prefs.rows[0]
      ? {
          trips: prefs.rows[0].trips,
          events: prefs.rows[0].events,
          club: prefs.rows[0].club,
          registrations: prefs.rows[0].registrations !== false,
          ratings: prefs.rows[0].ratings !== false,
        }
      : {
          trips: true,
          events: true,
          club: true,
          registrations: true,
          ratings: true,
        },
    privacy: {
      showVehicle: ctx.profile.privacy_show_vehicle,
      showSocial: ctx.profile.privacy_show_social,
    },
  };
}

function summarizeUser(authUser, ctx) {
  return {
    id: authUser.id,
    email: authUser.email,
    status: ctx.profile?.status,
    roles: ctx.roles,
    permissions: ctx.permissions,
    firstName: ctx.profile?.first_name,
    lastName: ctx.profile?.last_name,
    username: ctx.profile?.username,
    membership: ctx.profile?.membership_name || ctx.profile?.membership_code,
  };
}

async function requestPasswordReset(email, redirectTo) {
  const anon = getAnonClient();
  if (!anon) {
    throw new AppError(503, 'AUTH_NOT_CONFIGURED', 'Supabase Auth is not configured');
  }
  const target =
    redirectTo ||
    process.env.MOBILE_RESET_REDIRECT_URL ||
    'https://keepers-admin-portal.vercel.app/auth/mobile-reset';
  // Always return success to avoid email enumeration
  await anon.auth.resetPasswordForEmail(email, { redirectTo: target });
  return { message: 'If an account exists, a password reset link has been sent' };
}

async function changePassword(userId, email, currentPassword, nextPassword) {
  const anon = getAnonClient();
  const admin = getAdminClient();
  if (!anon || !admin) {
    throw new AppError(503, 'AUTH_NOT_CONFIGURED', 'Supabase Auth is not configured');
  }
  if (!nextPassword || nextPassword.length < 8) {
    throw new AppError(400, 'VALIDATION_ERROR', 'New password must be at least 8 characters');
  }
  if (currentPassword === nextPassword) {
    throw new AppError(400, 'VALIDATION_ERROR', 'New password must be different from the current password');
  }

  const { error: verifyError } = await anon.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (verifyError) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
  }

  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: nextPassword,
  });
  if (error) {
    throw new AppError(400, 'PASSWORD_UPDATE_FAILED', error.message);
  }

  return { message: 'Password updated successfully' };
}

async function setPasswordWithRecoveryToken(accessToken, nextPassword) {
  const admin = getAdminClient();
  if (!admin) {
    throw new AppError(503, 'AUTH_NOT_CONFIGURED', 'Supabase Auth is not configured');
  }
  if (!accessToken) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Recovery token is required');
  }
  if (!nextPassword || nextPassword.length < 8) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Password must be at least 8 characters');
  }

  const { data, error } = await admin.auth.getUser(accessToken);
  if (error || !data?.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid or expired recovery link');
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(data.user.id, {
    password: nextPassword,
  });
  if (updateError) {
    throw new AppError(400, 'PASSWORD_UPDATE_FAILED', updateError.message);
  }

  return { message: 'Password updated successfully', email: data.user.email };
}

async function deleteAccount(userId, email, currentPassword, req) {
  const anon = getAnonClient();
  const admin = getAdminClient();
  if (!anon || !admin) {
    throw new AppError(503, 'AUTH_NOT_CONFIGURED', 'Supabase Auth is not configured');
  }

  const { error: verifyError } = await anon.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (verifyError) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Password confirmation failed');
  }

  // Soft-delete profile and scrub PII before removing auth user
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE member_profiles SET
         deleted_at = NOW(),
         status = 'suspended',
         email = $2,
         phone = NULL,
         avatar_url = NULL,
         first_name = 'Deleted',
         last_name = 'Member',
         username = $3
       WHERE id = $1`,
      [userId, `deleted+${userId}@keepers.invalid`, `deleted_${userId.slice(0, 8)}`],
    );
    await client.query(
      `UPDATE vehicles SET deleted_at = NOW(), image_url = NULL WHERE user_id = $1`,
      [userId],
    );
    await client.query(`DELETE FROM social_links WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM emergency_contacts WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM notification_preferences WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM notifications WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
    await client.query(
      `UPDATE trip_registrations SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND status IN ('registered', 'waitlist', 'pending')`,
      [userId],
    );
    await client.query(
      `UPDATE membership_upgrade_requests SET status = 'withdrawn', updated_at = NOW()
       WHERE member_id = $1 AND status = 'pending'`,
      [userId],
    );
    await client.query(
      `DELETE FROM trip_pre_marshall_assignments WHERE user_id = $1`,
      [userId],
    );
    await client.query(
      `UPDATE member_media SET deleted_at = NOW() WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
  });

  // Best-effort storage cleanup for user-prefixed objects
  try {
    for (const bucket of ['avatars', 'vehicles', 'gallery', 'documents']) {
      const listed = await admin.storage.from(bucket).list(userId, { limit: 100 });
      if (listed.data?.length) {
        const paths = listed.data.map((f) => `${userId}/${f.name}`);
        await admin.storage.from(bucket).remove(paths);
      }
    }
  } catch {
    // non-fatal — profile already scrubbed
  }

  // Invalidate refresh/session tokens before removing the auth user
  try {
    if (typeof admin.auth.admin.signOut === 'function') {
      await admin.auth.admin.signOut(userId, 'global');
    }
  } catch {
    // non-fatal — deleteUser still invalidates credentials
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    throw new AppError(500, 'DELETE_FAILED', deleteError.message);
  }

  await writeAudit({
    actorId: userId,
    action: 'member.delete_account',
    entityType: 'member_profiles',
    entityId: userId,
    req,
  });

  return { message: 'Account deleted' };
}

module.exports = {
  signup,
  login,
  me,
  requestPasswordReset,
  changePassword,
  setPasswordWithRecoveryToken,
  deleteAccount,
  getMembershipLevelByCode,
  getRoleByCode,
};

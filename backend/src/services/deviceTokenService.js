const { query } = require('../config/db');
const { AppError } = require('../utils/AppError');

function normalizePlatform(platform) {
  const value = String(platform || '').toLowerCase();
  if (value !== 'android' && value !== 'ios') {
    throw new AppError(400, 'VALIDATION_ERROR', 'platform must be android or ios');
  }
  return value;
}

function sanitizeToken(token) {
  const value = String(token || '').trim();
  if (!value || value.length < 20 || value.length > 4096) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid FCM token');
  }
  return value;
}

/**
 * Upsert an FCM device token for the authenticated user.
 * Same token → reassign to this user. Same device_id → update token.
 */
async function registerDeviceToken(userId, payload) {
  const fcmToken = sanitizeToken(payload.fcmToken || payload.token);
  const platform = normalizePlatform(payload.platform);
  const deviceId = payload.deviceId ? String(payload.deviceId).slice(0, 255) : null;
  const appVersion = payload.appVersion
    ? String(payload.appVersion).slice(0, 64)
    : null;

  // Deactivate any other active rows for this device_id belonging to this user.
  if (deviceId) {
    await query(
      `UPDATE device_tokens
       SET is_active = FALSE, updated_at = NOW()
       WHERE user_id = $1 AND device_id = $2 AND fcm_token <> $3 AND is_active = TRUE`,
      [userId, deviceId, fcmToken],
    );
  }

  const result = await query(
    `INSERT INTO device_tokens (user_id, fcm_token, platform, device_id, app_version, is_active, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
     ON CONFLICT (fcm_token) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       platform = EXCLUDED.platform,
       device_id = COALESCE(EXCLUDED.device_id, device_tokens.device_id),
       app_version = COALESCE(EXCLUDED.app_version, device_tokens.app_version),
       is_active = TRUE,
       last_seen_at = NOW(),
       updated_at = NOW()
     RETURNING id, user_id, platform, device_id, app_version, is_active, last_seen_at, created_at, updated_at`,
    [userId, fcmToken, platform, deviceId, appVersion],
  );

  return result.rows[0];
}

async function deactivateDeviceToken(userId, tokenId) {
  const result = await query(
    `UPDATE device_tokens
     SET is_active = FALSE, updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING id, is_active`,
    [tokenId, userId],
  );
  if (!result.rows[0]) {
    throw new AppError(404, 'NOT_FOUND', 'Device token not found');
  }
  return result.rows[0];
}

async function deactivateTokenByValue(userId, fcmToken) {
  const token = sanitizeToken(fcmToken);
  const result = await query(
    `UPDATE device_tokens
     SET is_active = FALSE, updated_at = NOW()
     WHERE user_id = $1 AND fcm_token = $2
     RETURNING id, is_active`,
    [userId, token],
  );
  return result.rows[0] || null;
}

async function deactivateAllForUser(userId) {
  await query(
    `UPDATE device_tokens
     SET is_active = FALSE, updated_at = NOW()
     WHERE user_id = $1 AND is_active = TRUE`,
    [userId],
  );
  return { success: true };
}

async function listActiveTokensForUsers(userIds) {
  const unique = [...new Set((userIds || []).filter(Boolean))];
  if (!unique.length) return [];
  const result = await query(
    `SELECT id, user_id, fcm_token, platform
     FROM device_tokens
     WHERE user_id = ANY($1::uuid[]) AND is_active = TRUE`,
    [unique],
  );
  return result.rows;
}

async function deactivateTokensByIds(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return;
  await query(
    `UPDATE device_tokens
     SET is_active = FALSE, updated_at = NOW()
     WHERE id = ANY($1::uuid[])`,
    [unique],
  );
}

module.exports = {
  registerDeviceToken,
  deactivateDeviceToken,
  deactivateTokenByValue,
  deactivateAllForUser,
  listActiveTokensForUsers,
  deactivateTokensByIds,
};

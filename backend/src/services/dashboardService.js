const { query } = require('../config/db');

async function getDashboardStats() {
  const [
    members,
    active,
    pending,
    marshalls,
    upcomingTrips,
    activeRegs,
    pendingUpgrades,
    recentAudit,
    calendar,
  ] = await Promise.all([
    query(`SELECT COUNT(*)::int AS n FROM member_profiles WHERE deleted_at IS NULL`),
    query(
      `SELECT COUNT(*)::int AS n FROM member_profiles WHERE status = 'approved' AND deleted_at IS NULL`,
    ),
    query(
      `SELECT COUNT(*)::int AS n FROM member_profiles WHERE status = 'pending' AND deleted_at IS NULL`,
    ),
    query(
      `SELECT COUNT(DISTINCT ur.user_id)::int AS n
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE r.code IN ('marshall', 'pre_marshall')`,
    ),
    query(
      `SELECT COUNT(*)::int AS n FROM trips
       WHERE status = 'published' AND deleted_at IS NULL AND trip_date >= CURRENT_DATE`,
    ),
    query(
      `SELECT COUNT(*)::int AS n FROM trip_registrations tr
       JOIN trips t ON t.id = tr.trip_id
       WHERE tr.status = 'registered' AND t.status = 'published' AND t.deleted_at IS NULL`,
    ),
    query(
      `SELECT COUNT(*)::int AS n FROM membership_upgrade_requests WHERE status = 'pending'`,
    ),
    query(
      `SELECT al.*, mp.first_name, mp.last_name
       FROM audit_logs al
       LEFT JOIN member_profiles mp ON mp.id = al.actor_id
       ORDER BY al.created_at DESC
       LIMIT 15`,
    ),
    query(
      `SELECT id, title, trip_date, trip_time, destination, status, cover_image_url
       FROM trips
       WHERE deleted_at IS NULL AND status IN ('published','completed')
         AND trip_date BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE + INTERVAL '60 days'
       ORDER BY trip_date ASC`,
    ),
  ]);

  return {
    totals: {
      members: members.rows[0].n,
      activeMembers: active.rows[0].n,
      pendingApprovals: pending.rows[0].n,
      marshalls: marshalls.rows[0].n,
      upcomingTrips: upcomingTrips.rows[0].n,
      activeRegistrations: activeRegs.rows[0].n,
      pendingUpgradeRequests: pendingUpgrades.rows[0].n,
    },
    recentActivity: recentAudit.rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      actorName: r.first_name ? `${r.first_name} ${r.last_name}`.trim() : null,
      createdAt: r.created_at,
      metadata: r.metadata,
    })),
    upcomingCalendar: calendar.rows.map((t) => ({
      id: t.id,
      title: t.title,
      date: t.trip_date,
      time: t.trip_time,
      destination: t.destination,
      status: t.status,
      coverImage: t.cover_image_url,
    })),
  };
}

module.exports = { getDashboardStats };

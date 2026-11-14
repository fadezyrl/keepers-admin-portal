const { AppError } = require('../utils/AppError');
const { query } = require('../config/db');

/**
 * Optional pre-trip vehicle readiness checklist.
 * Minimum selections: 0 (informational only — never blocks join).
 */

async function listActiveRequirements(client = null) {
  const run = client ? client.query.bind(client) : query;
  const res = await run(
    `SELECT id, code, label, display_order
     FROM vehicle_readiness_requirements
     WHERE is_active = TRUE
     ORDER BY display_order ASC, code ASC`,
  );
  return res.rows.map((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    displayOrder: row.display_order,
  }));
}

/**
 * Validate client-submitted requirement IDs.
 * Allows 0..N selections; rejects unknown / inactive IDs and non-arrays.
 * @returns {string[]} unique valid UUIDs
 */
function normalizeSelectedIds(rawIds, catalog) {
  if (rawIds == null) return [];
  if (!Array.isArray(rawIds)) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'requirementIds must be an array of requirement IDs',
    );
  }

  const catalogIds = new Set(catalog.map((r) => r.id));
  const unique = [];
  const seen = new Set();

  for (const id of rawIds) {
    if (typeof id !== 'string' || !id.trim()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid requirement ID');
    }
    const trimmed = id.trim();
    if (seen.has(trimmed)) continue;
    if (!catalogIds.has(trimmed)) {
      throw new AppError(
        400,
        'INVALID_REQUIREMENT',
        'One or more readiness requirements are invalid',
      );
    }
    seen.add(trimmed);
    unique.push(trimmed);
  }

  return unique;
}

/**
 * Persist full checklist for a registration: every active requirement row,
 * with selected=true only for IDs the member chose. Replaces prior rows.
 */
async function saveRegistrationChecklist(client, registrationId, selectedIds) {
  const catalog = await listActiveRequirements(client);
  const selectedSet = new Set(normalizeSelectedIds(selectedIds, catalog));

  await client.query(
    `DELETE FROM trip_registration_readiness_items WHERE registration_id = $1`,
    [registrationId],
  );

  for (const req of catalog) {
    await client.query(
      `INSERT INTO trip_registration_readiness_items (
         registration_id, requirement_id, requirement_code, label_snapshot, selected
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        registrationId,
        req.id,
        req.code,
        req.label,
        selectedSet.has(req.id),
      ],
    );
  }

  return catalog.map((req) => ({
    id: req.id,
    code: req.code,
    label: req.label,
    selected: selectedSet.has(req.id),
  }));
}

/**
 * Load checklist snapshots keyed by registration_id.
 */
async function loadChecklistsByRegistrationIds(registrationIds) {
  if (!registrationIds?.length) return new Map();

  const res = await query(
    `SELECT registration_id, requirement_id, requirement_code, label_snapshot, selected, created_at
     FROM trip_registration_readiness_items
     WHERE registration_id = ANY($1::uuid[])
     ORDER BY requirement_code ASC`,
    [registrationIds],
  );

  const map = new Map();
  for (const row of res.rows) {
    const list = map.get(row.registration_id) || [];
    list.push({
      id: row.requirement_id,
      code: row.requirement_code,
      label: row.label_snapshot,
      selected: row.selected,
      submittedAt: row.created_at,
    });
    map.set(row.registration_id, list);
  }
  return map;
}

module.exports = {
  listActiveRequirements,
  normalizeSelectedIds,
  saveRegistrationChecklist,
  loadChecklistsByRegistrationIds,
};

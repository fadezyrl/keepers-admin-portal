/**
 * Driver progression helpers — 21 levels across 7 rank groups.
 * Club RBAC roles (pre_marshall / marshall) remain separate.
 */

const RANK_GROUP_LABELS = {
  junior: 'Junior',
  intermediate: 'Intermediate',
  intermediate_plus: 'Intermediate+',
  advanced: 'Advanced',
  advanced_plus: 'Advanced+',
  pre_marshall: 'Pre-Marshall',
  marshall: 'Marshall',
};

/** Legacy codes / display names → canonical level code */
const LEGACY_LEVEL_ALIASES = {
  junior: 'junior_1',
  intermediate: 'intermediate_1',
  advanced: 'advanced_1',
};

const ROLE_TRIGGER_LEVELS = {
  pre_marshall_1: 'pre_marshall',
  marshall_1: 'marshall',
};

function normalizeLevelKey(value) {
  if (value == null) return '';
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/\+/g, '_plus_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Resolve a client-supplied level token to a canonical code.
 * Accepts codes (junior_2), names (Junior 2), and legacy aliases (junior).
 */
function resolveLevelCode(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const lower = raw.toLowerCase();
  if (LEGACY_LEVEL_ALIASES[lower]) return LEGACY_LEVEL_ALIASES[lower];

  const normalized = normalizeLevelKey(raw);
  if (LEGACY_LEVEL_ALIASES[normalized]) return LEGACY_LEVEL_ALIASES[normalized];

  // "Intermediate+ 2" → intermediate_plus_2
  const plusMatch = raw.match(
    /^(junior|intermediate\+|intermediate|advanced\+|advanced|pre-?marshall|marshall)\s*([123])$/i,
  );
  if (plusMatch) {
    let group = plusMatch[1].toLowerCase().replace(/-/g, '_');
    if (group === 'intermediate+') group = 'intermediate_plus';
    if (group === 'advanced+') group = 'advanced_plus';
    if (group === 'premarshall') group = 'pre_marshall';
    return `${group}_${plusMatch[2]}`;
  }

  return normalized || null;
}

function formatLevel(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.display_name || row.name,
    displayName: row.display_name || row.name,
    rank: Number(row.rank),
    rankGroup: row.rank_group || null,
    rankGroupLabel: RANK_GROUP_LABELS[row.rank_group] || row.rank_group || null,
    levelNumber: row.level_number != null ? Number(row.level_number) : null,
    description: row.description || null,
    minCompletedTrips:
      row.min_completed_trips != null ? Number(row.min_completed_trips) : undefined,
    minAverageRating:
      row.min_average_rating != null ? Number(row.min_average_rating) : null,
    isActive: row.is_active !== false,
  };
}

function clubRoleForLevelCode(code) {
  return ROLE_TRIGGER_LEVELS[code] || null;
}

module.exports = {
  RANK_GROUP_LABELS,
  LEGACY_LEVEL_ALIASES,
  ROLE_TRIGGER_LEVELS,
  resolveLevelCode,
  formatLevel,
  clubRoleForLevelCode,
};

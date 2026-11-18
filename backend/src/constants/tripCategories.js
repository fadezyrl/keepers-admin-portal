/**
 * Canonical drive categories for Keepers Adventures.
 * Keep values stable — mobile + admin + DB CHECK share these strings.
 */
const TRIP_CATEGORIES = Object.freeze([
  'Desert Drives',
  'Camping Drives',
  'Mountain Drives',
  'Trips & Events',
]);

const TRIP_CATEGORY_SET = new Set(TRIP_CATEGORIES);

function isValidTripCategory(value) {
  return typeof value === 'string' && TRIP_CATEGORY_SET.has(value);
}

/**
 * Best-effort historical mapping from free-text trip_type / title / destination.
 * Ambiguous rows fall back to Trips & Events (never invent desert/mountain/camping).
 */
function inferCategoryFromLegacy({ tripType, title, destination } = {}) {
  const hay = `${tripType || ''} ${title || ''} ${destination || ''}`.toLowerCase();
  // Camping before desert so "Liwa camp" / overnight camp maps correctly.
  if (/\b(camp|camping|overnight|bivouac)\b/.test(hay)) {
    return 'Camping Drives';
  }
  if (/\b(mountain|mountains|wadi|jebel|traverse|highland)\b/.test(hay)) {
    return 'Mountain Drives';
  }
  if (/\b(desert|dune|rub.?al.?khali|liwa|empty quarter)\b/.test(hay)) {
    return 'Desert Drives';
  }
  return 'Trips & Events';
}

function assertTripCategory(value, { required = true } = {}) {
  if (value == null || value === '') {
    if (required) {
      const err = new Error('Drive category is required');
      err.status = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    return null;
  }
  if (!isValidTripCategory(value)) {
    const err = new Error(
      `Invalid drive category. Allowed: ${TRIP_CATEGORIES.join(', ')}`,
    );
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  return value;
}

module.exports = {
  TRIP_CATEGORIES,
  TRIP_CATEGORY_SET,
  isValidTripCategory,
  inferCategoryFromLegacy,
  assertTripCategory,
};

/**
 * Live verification: list + category filter + weather graceful path.
 * Requires DATABASE + a valid member JWT via LOGIN_EMAIL / LOGIN_PASSWORD or skips auth checks.
 */
require('dotenv').config();
const { query } = require('../src/config/db');
const {
  TRIP_CATEGORIES,
  assertTripCategory,
} = require('../src/constants/tripCategories');
const weatherService = require('../src/services/weatherService');
const tripService = require('../src/services/tripService');

async function main() {
  const results = [];

  for (const category of TRIP_CATEGORIES) {
    assertTripCategory(category);
  }
  results.push({ check: 'constants', ok: true });

  const listed = await tripService.listTrips({
    includeDrafts: true,
    limit: 5,
    page: 1,
  });
  results.push({
    check: 'listTrips',
    ok: Array.isArray(listed.items),
    count: listed.items.length,
    sampleCategory: listed.items[0]?.category || null,
  });

  for (const category of TRIP_CATEGORIES) {
    const filtered = await tripService.listTrips({
      category,
      includeDrafts: true,
      limit: 50,
      page: 1,
    });
    const mismatch = filtered.items.find((t) => t.category !== category);
    results.push({
      check: `filter:${category}`,
      ok: !mismatch,
      count: filtered.items.length,
    });
  }

  const any = await query(
    `SELECT id FROM trips WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
  );
  if (any.rows[0]) {
    const weather = await weatherService.getTripWeather(any.rows[0].id);
    results.push({
      check: 'weather',
      ok: weather && typeof weather.available === 'boolean',
      available: weather.available,
      message: weather.message || null,
    });
  } else {
    results.push({ check: 'weather', ok: true, skipped: true });
  }

  console.log(JSON.stringify({ results }, null, 2));
  const failed = results.filter((r) => !r.ok);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

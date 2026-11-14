/**
 * Vehicle readiness validation (no DB required for normalizeSelectedIds).
 * Run: node --test __tests__/vehicleReadinessService.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const dbPath = path.resolve(__dirname, '../src/config/db.js');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async () => ({ rows: [] }),
  },
};

const {
  normalizeSelectedIds,
} = require('../src/services/vehicleReadinessService');

const catalog = [
  { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', code: 'a', label: 'A' },
  { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', code: 'b', label: 'B' },
  { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', code: 'c', label: 'C' },
];

describe('normalizeSelectedIds', () => {
  it('allows empty / null (0 minimum)', () => {
    assert.deepEqual(normalizeSelectedIds(null, catalog), []);
    assert.deepEqual(normalizeSelectedIds(undefined, catalog), []);
    assert.deepEqual(normalizeSelectedIds([], catalog), []);
  });

  it('accepts partial and full selections', () => {
    assert.deepEqual(normalizeSelectedIds([catalog[0].id], catalog), [
      catalog[0].id,
    ]);
    assert.deepEqual(
      normalizeSelectedIds(
        catalog.map((c) => c.id),
        catalog,
      ),
      catalog.map((c) => c.id),
    );
  });

  it('dedupes ids', () => {
    assert.deepEqual(
      normalizeSelectedIds([catalog[0].id, catalog[0].id], catalog),
      [catalog[0].id],
    );
  });

  it('rejects non-array payloads', () => {
    assert.throws(
      () => normalizeSelectedIds('nope', catalog),
      (err) => err.code === 'VALIDATION_ERROR' && err.status === 400,
    );
  });

  it('rejects unknown requirement ids', () => {
    assert.throws(
      () =>
        normalizeSelectedIds(
          ['dddddddd-dddd-dddd-dddd-dddddddddddd'],
          catalog,
        ),
      (err) => err.code === 'INVALID_REQUIREMENT' && err.status === 400,
    );
  });
});

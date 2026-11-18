/**
 * Unit tests for drive category helpers.
 * Run: node --test __tests__/tripCategories.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  TRIP_CATEGORIES,
  isValidTripCategory,
  inferCategoryFromLegacy,
  assertTripCategory,
} = require('../src/constants/tripCategories');

describe('tripCategories', () => {
  it('exposes exactly four canonical categories', () => {
    assert.deepEqual(TRIP_CATEGORIES, [
      'Desert Drives',
      'Camping Drives',
      'Mountain Drives',
      'Trips & Events',
    ]);
  });

  it('validates known categories', () => {
    assert.equal(isValidTripCategory('Desert Drives'), true);
    assert.equal(isValidTripCategory('Night Drive'), false);
  });

  it('infers desert / camping / mountain safely', () => {
    assert.equal(
      inferCategoryFromLegacy({ tripType: 'Desert Expedition' }),
      'Desert Drives',
    );
    assert.equal(
      inferCategoryFromLegacy({ title: 'Overnight Camp Liwa' }),
      'Camping Drives',
    );
    assert.equal(
      inferCategoryFromLegacy({ tripType: 'Mountain Traverse' }),
      'Mountain Drives',
    );
  });

  it('falls back to Trips & Events for ambiguous legacy rows', () => {
    assert.equal(
      inferCategoryFromLegacy({ tripType: 'Night Drive' }),
      'Trips & Events',
    );
    assert.equal(
      inferCategoryFromLegacy({ tripType: 'Crossing' }),
      'Trips & Events',
    );
  });

  it('assertTripCategory rejects invalid values', () => {
    assert.throws(() => assertTripCategory('Beach'), /Invalid drive category/);
    assert.equal(assertTripCategory('Trips & Events'), 'Trips & Events');
  });
});

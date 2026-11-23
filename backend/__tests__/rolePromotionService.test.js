const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { clubRoleForLevelCode } = require('../src/services/progressionLevels');

describe('role promotion trigger rules (B1 / C1)', () => {
  const sequence = [
    'junior_1',
    'junior_2',
    'junior_3',
    'intermediate_1',
    'intermediate_2',
    'intermediate_3',
    'intermediate_plus_1',
    'intermediate_plus_2',
    'intermediate_plus_3',
    'advanced_1',
    'advanced_2',
    'advanced_3',
    'advanced_plus_1',
    'advanced_plus_2',
    'advanced_plus_3',
    'pre_marshall_1',
    'pre_marshall_2',
    'pre_marshall_3',
    'marshall_1',
    'marshall_2',
    'marshall_3',
  ];

  it('has exactly 21 ordered levels', () => {
    assert.equal(sequence.length, 21);
  });

  it('only opens Pre-Marshall club-role request when entering Pre-Marshall 1', () => {
    const triggers = sequence.filter((c) => clubRoleForLevelCode(c) === 'pre_marshall');
    assert.deepEqual(triggers, ['pre_marshall_1']);
  });

  it('only opens Marshall club-role request when entering Marshall 1', () => {
    const triggers = sequence.filter((c) => clubRoleForLevelCode(c) === 'marshall');
    assert.deepEqual(triggers, ['marshall_1']);
  });

  it('never treats Intermediate+/Advanced+ as club roles', () => {
    for (const code of sequence) {
      if (code.startsWith('intermediate_plus') || code.startsWith('advanced_plus')) {
        assert.equal(clubRoleForLevelCode(code), null);
      }
    }
  });
});

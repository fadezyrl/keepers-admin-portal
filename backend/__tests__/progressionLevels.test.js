const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveLevelCode,
  clubRoleForLevelCode,
  formatLevel,
  RANK_GROUP_LABELS,
} = require('../src/services/progressionLevels');

describe('progressionLevels', () => {
  it('maps legacy aliases to level 1 codes', () => {
    assert.equal(resolveLevelCode('junior'), 'junior_1');
    assert.equal(resolveLevelCode('Intermediate'), 'intermediate_1');
    assert.equal(resolveLevelCode('ADVANCED'), 'advanced_1');
  });

  it('parses display names including plus ranks', () => {
    assert.equal(resolveLevelCode('Junior 2'), 'junior_2');
    assert.equal(resolveLevelCode('Intermediate+ 3'), 'intermediate_plus_3');
    assert.equal(resolveLevelCode('Advanced+ 1'), 'advanced_plus_1');
    assert.equal(resolveLevelCode('Pre-Marshall 2'), 'pre_marshall_2');
    assert.equal(resolveLevelCode('Marshall 3'), 'marshall_3');
  });

  it('triggers club-role requests only at Pre-Marshall 1 and Marshall 1', () => {
    assert.equal(clubRoleForLevelCode('pre_marshall_1'), 'pre_marshall');
    assert.equal(clubRoleForLevelCode('marshall_1'), 'marshall');
    assert.equal(clubRoleForLevelCode('pre_marshall_3'), null);
    assert.equal(clubRoleForLevelCode('advanced_plus_3'), null);
    assert.equal(clubRoleForLevelCode('junior_1'), null);
  });

  it('formats level rows with rank group labels', () => {
    const formatted = formatLevel({
      id: 'x',
      code: 'intermediate_plus_2',
      name: 'Intermediate+ 2',
      display_name: 'Intermediate+ 2',
      rank: 8,
      rank_group: 'intermediate_plus',
      level_number: 2,
      description: 'test',
      min_completed_trips: 0,
      min_average_rating: null,
      is_active: true,
    });
    assert.equal(formatted.rankGroupLabel, RANK_GROUP_LABELS.intermediate_plus);
    assert.equal(formatted.levelNumber, 2);
    assert.equal(formatted.rank, 8);
    assert.equal(formatted.displayName, 'Intermediate+ 2');
  });

  it('covers all seven rank groups', () => {
    assert.deepEqual(Object.keys(RANK_GROUP_LABELS), [
      'junior',
      'intermediate',
      'intermediate_plus',
      'advanced',
      'advanced_plus',
      'pre_marshall',
      'marshall',
    ]);
  });
});

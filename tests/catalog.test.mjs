import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, earnedBadges } from '../public/catalog.mjs';
test('theme catalog has unique stable IDs and nonnegative costs', () => {
  assert.equal(new Set(THEMES.map(t => t.id)).size, THEMES.length);
  assert.equal(THEMES[0].id, 'mint');
  assert.equal(THEMES[0].cost, 0);
  assert.ok(THEMES.every(t => Number.isInteger(t.cost) && t.cost >= 0));
});
test('achievements do not unlock without measured progress', () => {
  assert.equal(earnedBadges({}).filter(b => b.unlocked).length, 0);
  assert.equal(earnedBadges({ gamesPlayed: 1, bestScore: 2000 }).filter(b => b.unlocked).length, 1);
  assert.equal(earnedBadges({ gamesPlayed: 5, bestScore: 2050, bestTile: 512, streak: 3 }).filter(b => b.unlocked).length, 5);
});

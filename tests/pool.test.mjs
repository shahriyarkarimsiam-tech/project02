import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentWeekId,
  weekEndTimestamp,
  calcStarValue,
  calcUserShare,
  REVENUE_SHARE_RATIO,
  DAILY_AD_CAP,
  AD_COOLDOWN_SECONDS,
  MIN_WITHDRAWAL_USDT
} from '../src/pool.mjs';

test('currentWeekId calculates correct ISO week string', () => {
  // 2026-11-11 is a Wednesday in week 46 of 2026
  const dateWed = new Date('2026-11-11T12:00:00Z');
  assert.equal(currentWeekId(dateWed), '2026-W46');

  // 2026-11-15 is Sunday of that same week
  const dateSun = new Date('2026-11-15T20:00:00Z');
  assert.equal(currentWeekId(dateSun), '2026-W46');

  // 2026-11-16 is Monday of the next week (week 47)
  const dateNextMon = new Date('2026-11-16T01:00:00Z');
  assert.equal(currentWeekId(dateNextMon), '2026-W47');
});

test('weekEndTimestamp calculates Sunday 23:59:59 UTC of the week', () => {
  const dateWed = new Date('2026-11-11T12:00:00Z');
  const endSec = weekEndTimestamp(dateWed);
  const endDate = new Date(endSec * 1000);
  assert.equal(endDate.getUTCDay(), 0); // 0 is Sunday
  assert.equal(endDate.getUTCHours(), 23);
  assert.equal(endDate.getUTCMinutes(), 59);
  assert.equal(endDate.getUTCSeconds(), 59);
  assert.equal(endDate.toISOString().slice(0, 10), '2026-11-15');
});

test('calcStarValue and calcUserShare calculate 50/50 community pool distribution', () => {
  // Let total ad revenue be $100 -> community pool 50% = $50
  const totalRevenue = 100;
  const communityPool = totalRevenue * REVENUE_SHARE_RATIO;
  assert.equal(communityPool, 50);

  // Suppose 5,000 total stars were earned across all players
  const totalStars = 5000;
  const valuePerStar = calcStarValue(communityPool, totalStars);
  assert.equal(valuePerStar, 0.01); // $0.01 per star

  // User Alice watched 100 ads (= 100 stars)
  const aliceShare = calcUserShare(100, valuePerStar);
  assert.equal(aliceShare, 1.00); // exactly $1.00 USDT

  // User Bob watched 15 ads (= 15 stars)
  const bobShare = calcUserShare(15, valuePerStar);
  assert.equal(bobShare, 0.15); // $0.15 USDT

  // Zero stars guard
  assert.equal(calcStarValue(50, 0), 0);
  assert.equal(calcUserShare(0, 0.01), 0);
});

test('constants meet user specifications', () => {
  assert.equal(REVENUE_SHARE_RATIO, 0.50);
  assert.equal(DAILY_AD_CAP, 20);
  assert.equal(AD_COOLDOWN_SECONDS, 60);
  assert.equal(MIN_WITHDRAWAL_USDT, 1.00);
});

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
  MIN_WITHDRAWAL_USDT,
  SETTLEMENT_DAY_NAME,
  SETTLEMENT_DAY_INDEX
} from '../src/pool.mjs';

test('currentWeekId calculates correct ISO week string', () => {
  const dateWed = new Date('2026-11-11T12:00:00Z');
  assert.equal(currentWeekId(dateWed), '2026-W46');

  const dateFri = new Date('2026-11-13T20:00:00Z');
  assert.equal(currentWeekId(dateFri), '2026-W46');
});

test('weekEndTimestamp calculates Friday 23:59:59 UTC settlement time', () => {
  const dateWed = new Date('2026-11-11T12:00:00Z');
  const endSec = weekEndTimestamp(dateWed);
  const endDate = new Date(endSec * 1000);
  assert.equal(endDate.getUTCDay(), 5); // 5 is Friday
  assert.equal(endDate.getUTCHours(), 23);
  assert.equal(endDate.getUTCMinutes(), 59);
  assert.equal(endDate.getUTCSeconds(), 59);
  assert.equal(endDate.toISOString().slice(0, 10), '2026-11-13');

  // If today is Saturday 2026-11-14, targets next Friday 2026-11-20
  const dateSat = new Date('2026-11-14T10:00:00Z');
  const nextFriSec = weekEndTimestamp(dateSat);
  const nextFriDate = new Date(nextFriSec * 1000);
  assert.equal(nextFriDate.getUTCDay(), 5);
  assert.equal(nextFriDate.toISOString().slice(0, 10), '2026-11-20');
});

test('calcStarValue and calcUserShare calculate Friday 50/50 star to USDT conversion ratio', () => {
  // Total ad revenue is $200 -> 50% community pool = $100
  const totalRevenue = 200;
  const communityPool = totalRevenue * REVENUE_SHARE_RATIO;
  assert.equal(communityPool, 100);

  // Total community stars earned this week = 10,000 stars
  const totalStars = 10000;
  const valuePerStar = calcStarValue(communityPool, totalStars);
  assert.equal(valuePerStar, 0.01); // 1 Star = 0.01 USDT

  // User with 150 stars converts to 150 * 0.01 = $1.50 USDT
  const userShare = calcUserShare(150, valuePerStar);
  assert.equal(userShare, 1.50);

  // User with 0 stars gets $0.00
  assert.equal(calcUserShare(0, valuePerStar), 0.00);

  // 0 stars guard
  assert.equal(calcStarValue(100, 0), 0.0);
});

test('constants match Friday settlement specifications', () => {
  assert.equal(SETTLEMENT_DAY_NAME, 'Friday');
  assert.equal(SETTLEMENT_DAY_INDEX, 5);
  assert.equal(REVENUE_SHARE_RATIO, 0.50);
  assert.equal(DAILY_AD_CAP, 20);
  assert.equal(AD_COOLDOWN_SECONDS, 60);
  assert.equal(MIN_WITHDRAWAL_USDT, 1.00);
});

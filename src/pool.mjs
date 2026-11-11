export const DAY_SECONDS = 86400;
export const DAILY_AD_CAP = 20;
export const AD_COOLDOWN_SECONDS = 60;
export const MIN_WITHDRAWAL_USDT = 1.00;
export const REVENUE_SHARE_RATIO = 0.50; // 50% community, 50% developer

/**
 * Returns the ISO 8601 week ID in the format 'YYYY-Www' (e.g., '2026-W46').
 * Uses Monday as the start of the week.
 */
export function currentWeekId(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Returns the Unix timestamp (in seconds) for Sunday 23:59:59 UTC of the given date's week.
 */
export function weekEndTimestamp(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7; // Monday=1 ... Sunday=7
  const daysUntilSunday = 7 - dayNum;
  const sunday = new Date(date.getTime() + daysUntilSunday * DAY_SECONDS * 1000);
  sunday.setUTCHours(23, 59, 59, 999);
  return Math.floor(sunday.getTime() / 1000);
}

/**
 * Computes value per star given community pool and total stars.
 */
export function calcStarValue(communityPoolUsdt, totalStars) {
  const pool = Number(communityPoolUsdt) || 0;
  const stars = Number(totalStars) || 0;
  if (stars <= 0 || pool <= 0) return 0.0;
  return pool / stars;
}

/**
 * Computes user share in USDT given user's weekly stars and value per star.
 */
export function calcUserShare(userWeeklyStars, valuePerStar) {
  const stars = Number(userWeeklyStars) || 0;
  const rate = Number(valuePerStar) || 0;
  return Number((stars * rate).toFixed(6));
}

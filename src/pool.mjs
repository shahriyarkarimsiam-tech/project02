export const DAY_SECONDS = 86400;
export const DAILY_AD_CAP = 20;
export const AD_COOLDOWN_SECONDS = 60;
export const MIN_WITHDRAWAL_USDT = 1.00;
export const REVENUE_SHARE_RATIO = 0.50; // 50% community, 50% developer
export const SETTLEMENT_DAY_NAME = 'Friday';
export const SETTLEMENT_DAY_INDEX = 5; // 5 = Friday

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
 * Returns the Unix timestamp (in seconds) for Friday 23:59:59 UTC of the current weekly settlement round.
 * If the current moment has already passed Friday 23:59:59 UTC, targets the next Friday.
 */
export function weekEndTimestamp(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // 0 is Sun, 5 is Fri
  const daysUntilFriday = (5 - day + 7) % 7;
  const target = new Date(date.getTime() + daysUntilFriday * DAY_SECONDS * 1000);
  target.setUTCHours(23, 59, 59, 999);
  if (d.getTime() > target.getTime()) {
    target.setUTCDate(target.getUTCDate() + 7);
  }
  return Math.floor(target.getTime() / 1000);
}

/**
 * Computes Friday conversion ratio: amount of USDT for 1 Star.
 * Formula: Value Per Star = Community Pool (50%) / Total Community Stars.
 */
export function calcStarValue(communityPoolUsdt, totalStars) {
  const pool = Number(communityPoolUsdt) || 0;
  const stars = Number(totalStars) || 0;
  if (stars <= 0 || pool <= 0) return 0.0;
  return pool / stars;
}

/**
 * Computes user's earned USDT amount from their weekly stars based on the Friday ratio.
 * User Earn Amount = User Weekly Stars * Value Per Star.
 */
export function calcUserShare(userWeeklyStars, valuePerStar) {
  const stars = Number(userWeeklyStars) || 0;
  const rate = Number(valuePerStar) || 0;
  return Number((stars * rate).toFixed(6));
}

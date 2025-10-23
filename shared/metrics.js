/**
 * @typedef {number | string | boolean | null | undefined} NumericLike
 */

/**
 * Coerces a value to a finite number with a fallback.
 * @param {NumericLike} value
 * @param {number} fallback
 * @returns {number}
 */
function toFiniteNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * Clamp a value between the provided lower and upper bounds.
 * @param {NumericLike} n
 * @param {NumericLike} [lo=0]
 * @param {NumericLike} [hi=100]
 * @returns {number}
 */
export function clamp(n, lo = 0, hi = 100) {
  const lower = toFiniteNumber(lo, 0);
  const upper = toFiniteNumber(hi, 100);
  const value = toFiniteNumber(n, lower);

  const min = Math.min(lower, upper);
  const max = Math.max(lower, upper);

  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Clamp a percentage-like value between 0 and 100 (rounded to nearest int).
 * @param {NumericLike} n
 * @returns {number}
 */
export function clampPct(n) {
  const rounded = Math.round(toFiniteNumber(n, 0));
  return clamp(rounded, 0, 100);
}

/**
 * Compute the progress percentage towards the next arc threshold.
 * @param {NumericLike} arcPoints
 * @param {NumericLike} nextThreshold
 * @returns {number}
 */
export function progressPercent(arcPoints, nextThreshold) {
  const threshold = toFiniteNumber(nextThreshold, 0);
  if (threshold <= 0) return 0;

  const points = toFiniteNumber(arcPoints, 0);
  const rawPercent = Math.round((points / threshold) * 100);
  return clamp(rawPercent, 0, 100);
}

/**
 * Produce a human-friendly day label (e.g. "Day 2 of 5").
 * @param {NumericLike} day
 * @param {NumericLike} length
 * @returns {string}
 */
export function dayLabel(day, length) {
  const totalDays = Math.max(1, Math.round(toFiniteNumber(length, 1)));
  if (totalDays <= 0) {
    return 'Day 1';
  }

  const currentDay = Math.round(toFiniteNumber(day, 1));
  const boundedDay = clamp(currentDay, 1, totalDays);
  return `Day ${boundedDay} of ${totalDays}`;
}

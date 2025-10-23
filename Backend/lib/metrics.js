export const clampPct = (n) => {
  const x = Number.isFinite(n) ? Math.round(n) : 0;
  return Math.max(0, Math.min(100, x));
};

export const progressPercent = (arcPoints, nextThreshold) => {
  const a = Number.isFinite(arcPoints) ? arcPoints : 0;
  const t = Number.isFinite(nextThreshold) ? nextThreshold : 0;
  if (t <= 0) return 0;
  return clampPct((a / t) * 100);
};

export const dayLabel = (day, length) => {
  const d = Number.isFinite(day) ? day : 0;
  const L = Number.isFinite(length) ? length : 0;
  if (L > 0 && d > 0) return `Day ${Math.min(d, L)} of ${L}`;
  return d > 0 ? `Day ${d}` : 'Day 1';
};

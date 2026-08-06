// Shared number formatting helpers used across dashboard, market and detail views.

export function formatCurrency(value: number, opts: { compact?: boolean } = {}): string {
  const compact = opts.compact === true && Math.abs(value) >= 10000;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Signed percentage from a ratio (0.05 -> "+5.0%"). */
export const formatSignedPercent = (ratio: number, digits = 1) =>
  `${ratio >= 0 ? "+" : ""}${(ratio * 100).toFixed(digits)}%`;

/** Compact count with K/M/B suffixes, e.g. trading volume. */
export function formatCompactNumber(value: number, digits = 1): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(digits)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(digits)}M`;
  return `${(value / 1e3).toFixed(0)}K`;
}

/** Compact USD amount with T/B/M suffixes, e.g. market cap. */
export function formatCompactCurrency(value: number | null, digits = 2): string {
  if (value == null) return "—";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(digits)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(digits)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(digits)}M`;
  return `$${value.toFixed(0)}`;
}

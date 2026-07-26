import type { NumberSeries } from "./types";

/** Normalize Indian mobile to 10 digits when possible. */
export function normalizePhoneNumber(raw: string): string {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) {
    digits = digits.slice(2);
  }
  if (digits.startsWith("0") && digits.length === 11) {
    digits = digits.slice(1);
  }
  return digits;
}

export function isValidIndianMobile(phone: string): boolean {
  const n = normalizePhoneNumber(phone);
  return /^[6-9]\d{9}$/.test(n);
}

export function seriesStartNumber(series: NumberSeries): string {
  return `${series.prefix}${"0".repeat(10 - series.prefix.length)}`;
}

export function seriesEndNumber(series: NumberSeries): string {
  return `${series.prefix}${"9".repeat(10 - series.prefix.length)}`;
}

/**
 * Compute the planned number list for a job without materializing millions of entries.
 * Returns total planned count and helpers to get the Nth number.
 */
export function buildNumberPlan(opts: {
  series: NumberSeries;
  startNumber?: string;
  endNumber?: string;
  batchSize: number;
}): {
  first: string;
  last: string;
  total: number;
  numberAt: (index: number) => string;
} {
  const seriesFirst = BigInt(seriesStartNumber(opts.series));
  const seriesLast = BigInt(seriesEndNumber(opts.series));

  let first = opts.startNumber
    ? BigInt(normalizePhoneNumber(opts.startNumber))
    : seriesFirst;
  let last = opts.endNumber
    ? BigInt(normalizePhoneNumber(opts.endNumber))
    : seriesLast;

  if (first < seriesFirst) first = seriesFirst;
  if (last > seriesLast) last = seriesLast;
  if (last < first) last = first;

  const span = Number(last - first) + 1;
  const total = Math.min(Math.max(1, opts.batchSize), span);
  const effectiveLast = first + BigInt(total - 1);

  return {
    first: first.toString().padStart(10, "0"),
    last: effectiveLast.toString().padStart(10, "0"),
    total,
    numberAt: (index: number) => {
      if (index < 0 || index >= total) {
        throw new Error(`Index ${index} out of range 0..${total - 1}`);
      }
      return (first + BigInt(index)).toString().padStart(10, "0");
    },
  };
}

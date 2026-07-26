import type { NumberSeries } from "./types";

/**
 * Starter Jio MSC / number-series list for job configuration.
 * Prefixes are 5-digit MSC codes; each covers 100_000 numbers (xxxxx00000–xxxxx99999).
 * Expand from DoT allocation circulars as needed.
 */
export const JIO_NUMBER_SERIES: NumberSeries[] = [
  { id: "jio-92030", provider: "jio", prefix: "92030", label: "92030 — Madhya Pradesh", capacity: 100_000, circle: "Madhya Pradesh" },
  { id: "jio-92031", provider: "jio", prefix: "92031", label: "92031 — Madhya Pradesh", capacity: 100_000, circle: "Madhya Pradesh" },
  { id: "jio-92032", provider: "jio", prefix: "92032", label: "92032 — Madhya Pradesh", capacity: 100_000, circle: "Madhya Pradesh" },
  { id: "jio-92960", provider: "jio", prefix: "92960", label: "92960 — Bihar", capacity: 100_000, circle: "Bihar" },
  { id: "jio-92961", provider: "jio", prefix: "92961", label: "92961 — Bihar", capacity: 100_000, circle: "Bihar" },
  { id: "jio-70000", provider: "jio", prefix: "70000", label: "70000 — Sample series", capacity: 100_000 },
  { id: "jio-70001", provider: "jio", prefix: "70001", label: "70001 — Sample series", capacity: 100_000 },
  { id: "jio-98765", provider: "jio", prefix: "98765", label: "98765 — Sample series", capacity: 100_000 },
];

export const MOBILE_PROVIDERS = [
  { id: "jio", label: "Jio" },
] as const;

export function getSeriesForProvider(providerId: string): NumberSeries[] {
  if (providerId === "jio") return JIO_NUMBER_SERIES;
  return [];
}

export function findSeries(seriesId: string): NumberSeries | undefined {
  return JIO_NUMBER_SERIES.find((s) => s.id === seriesId);
}

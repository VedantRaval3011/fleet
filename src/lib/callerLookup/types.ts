export type LookupStatus = "found" | "not_found" | "error" | "skipped";

export interface PhoneLookupRequest {
  phoneNumber: string;
  mobileProvider?: string;
  seriesPrefix?: string;
}

export interface PhoneLookupResult {
  phoneNumber: string;
  status: LookupStatus;
  callerName?: string | null;
  /** Non-KYC metadata (operator, circle, etc.) */
  metadata?: Record<string, unknown>;
  /** Separate KYC / identity fields when the provider returns them */
  kyc?: Record<string, unknown> | null;
  rawResponse?: unknown;
  durationMs: number;
  error?: string;
  providerId: string;
  providerLabel: string;
}

export interface PhoneLookupProvider {
  id: string;
  label: string;
  description: string;
  /** Whether this provider can return personal names for arbitrary numbers */
  supportsNameLookup: boolean;
  lookup(request: PhoneLookupRequest): Promise<PhoneLookupResult>;
}

export type JobStatus = "idle" | "running" | "paused" | "stopped" | "completed";

export interface NumberSeries {
  id: string;
  provider: string;
  prefix: string;
  label: string;
  /** How many subscriber numbers this MSC/prefix covers (usually 100_000) */
  capacity: number;
  circle?: string;
}

import mongoose, { Schema, Document } from "mongoose";

export interface ICallerLookupResult extends Document {
  jobId: mongoose.Types.ObjectId;
  companyId?: mongoose.Types.ObjectId | null;
  deviceId: string;
  phoneNumber: string;
  callerName?: string | null;
  lookupStatus: "found" | "not_found" | "error" | "skipped";
  provider: string;
  lookupProviderId: string;
  mobileProvider: string;
  seriesPrefix?: string;
  kyc?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  rawResponse?: unknown;
  durationMs: number;
  retryCount: number;
  error?: string | null;
  lookedUpAt: Date;
}

const CallerLookupResultSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: "CallerLookupJob", required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", default: null },
    deviceId: { type: String, required: true, index: true },
    phoneNumber: { type: String, required: true, index: true },
    callerName: { type: String, default: null },
    lookupStatus: {
      type: String,
      enum: ["found", "not_found", "error", "skipped"],
      required: true,
      index: true,
    },
    provider: { type: String, required: true },
    lookupProviderId: { type: String, required: true },
    mobileProvider: { type: String, required: true },
    seriesPrefix: { type: String },
    kyc: { type: Schema.Types.Mixed, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
    rawResponse: { type: Schema.Types.Mixed, default: null },
    durationMs: { type: Number, default: 0 },
    retryCount: { type: Number, default: 0 },
    error: { type: String, default: null },
    lookedUpAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

CallerLookupResultSchema.index({ jobId: 1, phoneNumber: 1 }, { unique: true });
CallerLookupResultSchema.index({ jobId: 1, lookedUpAt: -1 });
CallerLookupResultSchema.index({ phoneNumber: 1, lookupStatus: 1 });

export default mongoose.models.CallerLookupResult ||
  mongoose.model<ICallerLookupResult>("CallerLookupResult", CallerLookupResultSchema);

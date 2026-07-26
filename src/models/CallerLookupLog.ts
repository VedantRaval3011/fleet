import mongoose, { Schema, Document } from "mongoose";

export type CallerLookupLogLevel = "info" | "success" | "failure" | "error" | "retry" | "api";

export interface ICallerLookupLog extends Document {
  jobId: mongoose.Types.ObjectId;
  deviceId: string;
  level: CallerLookupLogLevel;
  message: string;
  phoneNumber?: string | null;
  durationMs?: number | null;
  details?: Record<string, unknown> | null;
  occurredAt?: Date;
  createdAt: Date;
}

const CallerLookupLogSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: "CallerLookupJob", required: true, index: true },
    deviceId: { type: String, required: true },
    level: {
      type: String,
      enum: ["info", "success", "failure", "error", "retry", "api"],
      required: true,
    },
    message: { type: String, required: true },
    phoneNumber: { type: String, default: null },
    durationMs: { type: Number, default: null },
    details: { type: Schema.Types.Mixed, default: null },
    occurredAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

CallerLookupLogSchema.index({ jobId: 1, createdAt: -1 });

export default mongoose.models.CallerLookupLog ||
  mongoose.model<ICallerLookupLog>("CallerLookupLog", CallerLookupLogSchema);

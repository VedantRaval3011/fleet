import mongoose, { Schema, Document } from "mongoose";
export type CallerLookupJobStatus =
  | "requested"
  | "running"
  | "pausing"
  | "paused"
  | "stopping"
  | "stopped"
  | "completed"
  | "failed";

export interface ICallerLookupJob extends Document {
  companyId?: mongoose.Types.ObjectId | null;
  createdBy?: string;
  deviceId: string;
  employeeName?: string;
  status: CallerLookupJobStatus;
  requestedAction?: "start" | "pause" | "resume" | "stop" | null;
  mobileProvider: string;
  seriesId: string;
  seriesPrefix: string;
  seriesLabel: string;
  startNumber: string;
  endNumber: string;
  batchSize: number;
  delayMs: number;
  workers: number;
  lookupProviderId: string;
  maxRetries: number;
  cursorIndex: number;
  totalPlanned: number;
  processed: number;
  successful: number;
  failed: number;
  currentNumber?: string | null;
  totalLookupDurationMs: number;
  startedAt?: Date | null;
  pausedAt?: Date | null;
  completedAt?: Date | null;
  stoppedAt?: Date | null;
  lastHeartbeatAt?: Date | null;
  errorMessage?: string | null;
}

const CallerLookupJobSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", default: null },
    createdBy: { type: String },
    deviceId: { type: String, required: true, index: true },
    employeeName: { type: String },
    status: {
      type: String,
      enum: [
        "requested",
        "running",
        "pausing",
        "paused",
        "stopping",
        "stopped",
        "completed",
        "failed",
      ],
      default: "requested",
      index: true,
    },
    requestedAction: {
      type: String,
      enum: ["start", "pause", "resume", "stop", null],
      default: "start",
    },
    mobileProvider: { type: String, required: true },
    seriesId: { type: String, required: true },
    seriesPrefix: { type: String, required: true },
    seriesLabel: { type: String, required: true },
    startNumber: { type: String, required: true },
    endNumber: { type: String, required: true },
    batchSize: { type: Number, required: true },
    delayMs: { type: Number, default: 200 },
    workers: { type: Number, default: 1 },
    lookupProviderId: { type: String, required: true },
    maxRetries: { type: Number, default: 2 },
    cursorIndex: { type: Number, default: 0 },
    totalPlanned: { type: Number, required: true },
    processed: { type: Number, default: 0 },
    successful: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    currentNumber: { type: String, default: null },
    totalLookupDurationMs: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    pausedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    stoppedAt: { type: Date, default: null },
    lastHeartbeatAt: { type: Date, default: null },
    errorMessage: { type: String, default: null },
  },
  { timestamps: true }
);

CallerLookupJobSchema.index({ deviceId: 1, status: 1, updatedAt: -1 });

export default mongoose.models.CallerLookupJob ||
  mongoose.model<ICallerLookupJob>("CallerLookupJob", CallerLookupJobSchema);

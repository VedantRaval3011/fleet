import mongoose, { Schema, Document } from "mongoose";

/**
 * The current picture of a shift. Everything under "projection" is DERIVED from
 * the ShiftEvent log by lib/shiftEngine.ts and can be rebuilt at any time; it is
 * stored so the admin board can query and sort without replaying every shift.
 * Never edit it by hand - append an event instead.
 */
export interface IShiftSession extends Document {
  shiftId: string;

  // Identity, resolved server-side from the device's enrolment, never trusted from the device.
  companyId?: unknown;
  driverId?: mongoose.Types.ObjectId;
  userId?: string;
  employeeId?: string;
  driverName: string;
  deviceId: string;
  vehicle?: string;

  // Schedule
  shiftType: "MORNING" | "EVENING";
  scheduledStart: Date;
  scheduledEnd: Date;
  /** The shift was switched on outside its permitted window (still recorded, flagged). */
  outsideSchedule: boolean;

  // Projection
  status: "ACTIVE" | "INTERRUPTED" | "ENDED";
  actualStart?: Date;
  actualEnd?: Date;
  endedBy?: "driver" | "admin" | "system";
  endReason?: string;
  endEvidence?: string;
  trackingStartedAt?: Date;
  trackingStoppedAt?: Date;
  currentCause?: string;
  currentInterruptionStart?: Date;
  connectivityLost: boolean;
  openSilenceSince?: Date;
  interruptionCount: number;
  interruptions: {
    id: string;
    kind: "TRACKING" | "CONNECTIVITY";
    cause: string;
    source: string;
    startedAt: Date;
    endedAt?: Date | null;
    reason?: string;
    evidence?: string;
    closedBy?: string;
  }[];
  trackingInterruptedMs: number;
  connectivityMs: number;
  ignoredEventCount: number;

  // Liveness - written directly on device contact, not derived from events
  lastContactAt?: Date;
  lastLocation?: { lat: number; lng: number; accuracy?: number; recordedAt?: Date };
  lastLocationAt?: Date;

  /** Number of events folded into the projection; guards against a stale write overwriting a newer one. */
  eventCount: number;
  projectedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const InterruptionSchema = new Schema(
  {
    id: String,
    kind: { type: String, enum: ["TRACKING", "CONNECTIVITY"] },
    cause: String,
    source: String,
    startedAt: Date,
    endedAt: { type: Date, default: null },
    reason: String,
    evidence: String,
    closedBy: String,
  },
  { _id: false }
);

const ShiftSessionSchema = new Schema(
  {
    shiftId: { type: String, required: true, unique: true },
    companyId: { type: Schema.Types.Mixed },
    driverId: { type: Schema.Types.ObjectId, ref: "Driver" },
    userId: { type: String },
    employeeId: { type: String },
    driverName: { type: String, required: true },
    deviceId: { type: String, required: true },
    vehicle: { type: String },

    shiftType: { type: String, enum: ["MORNING", "EVENING"], required: true },
    scheduledStart: { type: Date, required: true },
    scheduledEnd: { type: Date, required: true },
    outsideSchedule: { type: Boolean, default: false },

    status: { type: String, enum: ["ACTIVE", "INTERRUPTED", "ENDED"], default: "ACTIVE" },
    actualStart: { type: Date },
    actualEnd: { type: Date },
    endedBy: { type: String, enum: ["driver", "admin", "system"] },
    endReason: { type: String },
    endEvidence: { type: String },
    trackingStartedAt: { type: Date },
    trackingStoppedAt: { type: Date },
    currentCause: { type: String },
    currentInterruptionStart: { type: Date },
    connectivityLost: { type: Boolean, default: false },
    openSilenceSince: { type: Date },
    interruptionCount: { type: Number, default: 0 },
    interruptions: { type: [InterruptionSchema], default: [] },
    trackingInterruptedMs: { type: Number, default: 0 },
    connectivityMs: { type: Number, default: 0 },
    ignoredEventCount: { type: Number, default: 0 },

    lastContactAt: { type: Date },
    lastLocation: {
      lat: Number,
      lng: Number,
      accuracy: Number,
      recordedAt: Date,
    },
    lastLocationAt: { type: Date },

    eventCount: { type: Number, default: 0 },
    projectedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "shiftsessions" }
);

ShiftSessionSchema.index({ deviceId: 1, status: 1 });
ShiftSessionSchema.index({ companyId: 1, status: 1, actualStart: -1 });
ShiftSessionSchema.index({ actualStart: -1 });
ShiftSessionSchema.index({ userId: 1, actualStart: -1 });

export default mongoose.models.ShiftSession ||
  mongoose.model<IShiftSession>("ShiftSession", ShiftSessionSchema);

import mongoose, { Schema, Document } from "mongoose";
import { SHIFT_EVENT_TYPES } from "@/lib/shiftVocabulary";

/**
 * One row per thing that happened during a shift. Append-only: nothing in the app
 * updates or deletes these, and the unique (shiftId, eventKey) index makes a retried
 * upload from a flaky connection a no-op rather than a duplicate. The shift's
 * status is recomputed from these rows (see lib/shiftEngine.ts), so this collection
 * IS the audit trail.
 */
export interface IShiftEvent extends Document {
  shiftId: string;
  /** Idempotency key. Device events: the device's event id. System events: derived, deterministic. */
  eventKey: string;
  type: (typeof SHIFT_EVENT_TYPES)[number];
  /** Effective time (device clock, clamped if it was in the future). */
  occurredAt: Date;
  /** What the device actually claimed, before any clamping. */
  reportedOccurredAt?: Date;
  /** When the server received it. */
  receivedAt: Date;
  clockAdjusted: boolean;
  actor: { kind: "driver" | "admin" | "system" | "device"; userId?: string; name?: string };
  source: "android" | "web" | "system";
  deviceId?: string;
  companyId?: unknown;
  payload: Record<string, unknown>;
  seq: number;
}

const ShiftEventSchema = new Schema(
  {
    shiftId: { type: String, required: true },
    eventKey: { type: String, required: true },
    type: { type: String, enum: SHIFT_EVENT_TYPES, required: true },
    occurredAt: { type: Date, required: true },
    reportedOccurredAt: { type: Date },
    receivedAt: { type: Date, required: true },
    clockAdjusted: { type: Boolean, default: false },
    actor: {
      kind: { type: String, enum: ["driver", "admin", "system", "device"], required: true },
      userId: { type: String },
      name: { type: String },
    },
    source: { type: String, enum: ["android", "web", "system"], required: true },
    deviceId: { type: String },
    companyId: { type: Schema.Types.Mixed },
    payload: { type: Schema.Types.Mixed, default: {} },
    seq: { type: Number, required: true },
  },
  { timestamps: false, collection: "shiftevents" }
);

ShiftEventSchema.index({ shiftId: 1, eventKey: 1 }, { unique: true });
ShiftEventSchema.index({ shiftId: 1, occurredAt: 1 });
// Tracking-alert feed: newest received events of the alerting types.
ShiftEventSchema.index({ type: 1, receivedAt: -1 });

export default mongoose.models.ShiftEvent || mongoose.model<IShiftEvent>("ShiftEvent", ShiftEventSchema);

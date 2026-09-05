import mongoose, { Schema, Document } from 'mongoose';

export type TrackerStatus = 'tracking' | 'awaiting_name' | 'awaiting_category' | 'identified';

export interface IUnknownNumberTracker extends Document {
  phoneNumber: string;
  employeeName: string;
  /** Canonical identity — last 10 digits. The real key; phoneNumber is for display. */
  phoneKey: string;
  /** Canonical identity — lowercased employee name. */
  employeeKey: string;
  deviceId: string;
  callCount: number;
  firstSeen: Date;
  lastSeen: Date;
  telegramMessageId?: number;
  /** Set when a name-request Telegram was successfully sent — prevents duplicate sends. */
  nameRequestSentAt?: Date;
  /** How many name prompts we have sent — capped so we never nag forever. */
  namePromptCount: number;
  status: TrackerStatus;
}

const UnknownNumberTrackerSchema = new Schema(
  {
    phoneNumber: { type: String, required: true, trim: true },
    employeeName: { type: String, required: true },
    phoneKey: { type: String, required: true, index: true },
    employeeKey: { type: String, required: true, index: true },
    deviceId: { type: String, default: '' },
    callCount: { type: Number, default: 1 },
    firstSeen: { type: Date, required: true },
    lastSeen: { type: Date, required: true },
    telegramMessageId: { type: Number, index: true },
    nameRequestSentAt: { type: Date },
    namePromptCount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['tracking', 'awaiting_name', 'awaiting_category', 'identified'],
      default: 'tracking',
    },
  },
  { timestamps: true }
);

// One tracker per (number, employee) regardless of how the number was formatted.
UnknownNumberTrackerSchema.index({ phoneKey: 1, employeeKey: 1 }, { unique: true });
UnknownNumberTrackerSchema.index({ employeeName: 1 });
UnknownNumberTrackerSchema.index({ callCount: -1 });

export default mongoose.models.UnknownNumberTracker ||
  mongoose.model<IUnknownNumberTracker>('UnknownNumberTracker', UnknownNumberTrackerSchema);

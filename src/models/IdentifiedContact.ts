import mongoose, { Schema, Document } from 'mongoose';

export type ContactCategory =
  | 'personal'
  | 'staff'
  | 'Existing Client'
  | 'New Client'
  | 'courier'
  | 'Family'
  | 'Colleague'
  | 'Other';

export interface IIdentifiedContact extends Document {
  phoneNumber: string;
  employeeName: string;
  /** Canonical identity — last 10 digits. The real key; phoneNumber is for display. */
  phoneKey: string;
  /** Canonical identity — lowercased employee name. */
  employeeKey: string;
  deviceId: string;
  contactName?: string;
  category?: ContactCategory;
  savedInPhone: boolean;
  remindLater: boolean;
  telegramChatId?: string;
  identifiedAt?: Date;
  /** When we first sent the "classify this contact" Telegram message; no repeat until category is set. */
  categoryRequestSentAt?: Date;
  /** How many category prompts we have sent — capped so we never nag forever. */
  categoryPromptCount: number;
  /** When we last sent a "confirm you've saved" reminder; used to avoid spam. */
  lastReminderSentAt?: Date;
  /** How many save reminders we have sent — capped so we never nag forever. */
  savePromptCount: number;
  /** When the contact reached its terminal state (classified + saved in phone). */
  completedAt?: Date;
}

const IdentifiedContactSchema = new Schema(
  {
    phoneNumber: { type: String, required: true, trim: true },
    employeeName: { type: String, required: true },
    phoneKey: { type: String, required: true, index: true },
    employeeKey: { type: String, required: true, index: true },
    deviceId: { type: String, default: '' },
    contactName: { type: String },
    category: {
      type: String,
      // Keep as string but restrict to known UI categories used across the dashboard.
      enum: [
        'personal',
        'staff',
        'Existing Client',
        'New Client',
        'courier',
        'Family',
        'Colleague',
        'Other',
      ],
    },
    savedInPhone: { type: Boolean, default: false },
    remindLater: { type: Boolean, default: false },
    telegramChatId: { type: String },
    identifiedAt: { type: Date },
    categoryRequestSentAt: { type: Date },
    categoryPromptCount: { type: Number, default: 0 },
    lastReminderSentAt: { type: Date },
    savePromptCount: { type: Number, default: 0 },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

// One record per (number, employee) regardless of how the number was formatted.
IdentifiedContactSchema.index({ phoneKey: 1, employeeKey: 1 }, { unique: true });
IdentifiedContactSchema.index({ employeeName: 1 });

export default mongoose.models.IdentifiedContact ||
  mongoose.model<IIdentifiedContact>('IdentifiedContact', IdentifiedContactSchema);

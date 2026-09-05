import mongoose, { Schema, Document } from 'mongoose';

export interface ICallLog extends Document {
  driverId: mongoose.Types.ObjectId;
  phoneNumber: string;
  callType: 'INCOMING' | 'OUTGOING' | 'MISSED' | 'UNKNOWN';
  duration: number;
  timestamp: Date;
  syncedAt: Date;
  companyId: mongoose.Types.ObjectId;
  employeeName?: string;
  contactName?: string;
}

const CallLogSchema = new Schema(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    phoneNumber: { type: String, required: true },
    callType: { type: String, enum: ['INCOMING', 'OUTGOING', 'MISSED', 'UNKNOWN'], required: true },
    duration: { type: Number, required: true },
    timestamp: { type: Date, required: true },
    syncedAt: { type: Date, required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    employeeName: { type: String },
    contactName: { type: String },
  },
  { timestamps: true }
);

// Compound index to prevent duplicates
CallLogSchema.index({ phoneNumber: 1, timestamp: 1, duration: 1 }, { unique: true });

// Read-path indexes. Every dashboard query matches on company + time window,
// and the analytics aggregations additionally group by employee or call type.
CallLogSchema.index({ companyId: 1, timestamp: -1 });
CallLogSchema.index({ employeeName: 1, timestamp: -1 });
CallLogSchema.index({ companyId: 1, callType: 1, timestamp: -1 });
CallLogSchema.index({ timestamp: -1 });
CallLogSchema.index({ syncedAt: -1 });

export default mongoose.models.CallLog || mongoose.model<ICallLog>('CallLog', CallLogSchema);

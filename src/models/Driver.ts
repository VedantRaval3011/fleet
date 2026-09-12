import mongoose, { Schema, Document } from 'mongoose';

export interface IDriver extends Document {
  userId: mongoose.Types.ObjectId;
  companyId: mongoose.Types.ObjectId;
  walletBalance: number;
  status: 'active' | 'inactive';
  createdAt: Date;
}

const DriverSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    walletBalance: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

// The dashboard counts active drivers per company and joins drivers to users.
DriverSchema.index({ companyId: 1, status: 1 });
DriverSchema.index({ userId: 1 });

export default mongoose.models.Driver || mongoose.model<IDriver>('Driver', DriverSchema);

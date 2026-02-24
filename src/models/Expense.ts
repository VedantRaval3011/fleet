import mongoose, { Schema, Document } from 'mongoose';

export interface IExpense extends Document {
  driverId: mongoose.Types.ObjectId;
  companyId: mongoose.Types.ObjectId;
  amount: number;
  category: 'Fuel' | 'Toll' | 'Food' | 'Other';
  note?: string;
  photoUrl: string;
  location: {
    lat: number;
    lng: number;
  };
  locationAccuracy?: number;
  timestamp: Date;
  status: 'pending' | 'approved' | 'rejected';
  adminApprovalBy?: mongoose.Types.ObjectId;
  receiptUrl?: string;
  walletBalanceAfter?: number;
}

const ExpenseSchema = new Schema(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    amount: { type: Number, required: true },
    category: { type: String, enum: ['Fuel', 'Toll', 'Food', 'Other'], required: true },
    note: { type: String },
    photoUrl: { type: String, required: true }, // For MVP, this might hold a large base64 string
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    locationAccuracy: { type: Number },
    timestamp: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    adminApprovalBy: { type: Schema.Types.ObjectId, ref: 'User' },
    receiptUrl: { type: String },
    walletBalanceAfter: { type: Number },
  },
  { timestamps: true }
);

export default mongoose.models.Expense || mongoose.model<IExpense>('Expense', ExpenseSchema);

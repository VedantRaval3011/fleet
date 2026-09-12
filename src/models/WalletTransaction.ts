import mongoose, { Schema, Document } from 'mongoose';

export interface IWalletTransaction extends Document {
  driverId: mongoose.Types.ObjectId;
  companyId: mongoose.Types.ObjectId;
  amount: number;
  type: 'addition' | 'deduction';
  relatedExpenseId?: mongoose.Types.ObjectId;
  note?: string;
  timestamp: Date;
}

const WalletTransactionSchema = new Schema(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    amount: { type: Number, required: true },
    type: { type: String, enum: ['addition', 'deduction'], required: true },
    relatedExpenseId: { type: Schema.Types.ObjectId, ref: 'Expense' },
    note: { type: String },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Wallet history is read per driver, newest first.
WalletTransactionSchema.index({ driverId: 1, timestamp: -1 });
WalletTransactionSchema.index({ companyId: 1, timestamp: -1 });

export default mongoose.models.WalletTransaction || mongoose.model<IWalletTransaction>('WalletTransaction', WalletTransactionSchema);

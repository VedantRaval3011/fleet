import mongoose, { Schema, Document } from 'mongoose';

export interface ICompany extends Document {
  name: string;
  createdAt: Date;
}

const CompanySchema = new Schema(
  {
    name: { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.models.Company || mongoose.model<ICompany>('Company', CompanySchema);

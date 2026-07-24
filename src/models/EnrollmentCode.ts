import mongoose, { Schema, Document } from 'mongoose';

export interface IEnrollmentCode extends Document {
  code: string;
  companyId: mongoose.Types.ObjectId;
  employeeId?: string;
  employeeName?: string;
  role: 'driver' | 'employee';
  capabilities?: string[];
  vehicle?: string;
  serverUrl?: string;
  apiKey?: string;
  usedAt?: Date;
  expiresAt?: Date;
  revoked: boolean;
  driverId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const EnrollmentCodeSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    employeeId: { type: String },
    employeeName: { type: String },
    role: { type: String, enum: ['driver', 'employee'], default: 'driver' },
    capabilities: [{ type: String }],
    vehicle: { type: String },
    serverUrl: { type: String },
    apiKey: { type: String },
    usedAt: { type: Date },
    expiresAt: { type: Date },
    revoked: { type: Boolean, default: false },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver' },
  },
  { timestamps: true }
);

export default mongoose.models.EnrollmentCode ||
  mongoose.model<IEnrollmentCode>('EnrollmentCode', EnrollmentCodeSchema);

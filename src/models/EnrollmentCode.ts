import mongoose, { Schema, Document } from 'mongoose';

export interface IEnrollmentCapabilities {
  callMonitoring: boolean;
  locationTracking: boolean;
  expenseManagement: boolean;
}

export interface IEnrollmentCode extends Document {
  code: string;
  companyId: mongoose.Types.ObjectId;
  employeeId?: string;
  employeeName?: string;
  role: 'driver' | 'employee';
  capabilities: IEnrollmentCapabilities;
  vehicle?: { id?: string; registration?: string };
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
    capabilities: {
      callMonitoring: { type: Boolean, default: true },
      locationTracking: { type: Boolean, default: false },
      expenseManagement: { type: Boolean, default: false },
    },
    vehicle: {
      id: { type: String },
      registration: { type: String },
    },
    serverUrl: { type: String },
    apiKey: { type: String },
    usedAt: { type: Date },
    expiresAt: { type: Date },
    revoked: { type: Boolean, default: false },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver' },
  },
  { timestamps: true, collection: 'enrollmentcodes' }
);

export default mongoose.models.EnrollmentCode ||
  mongoose.model<IEnrollmentCode>('EnrollmentCode', EnrollmentCodeSchema);

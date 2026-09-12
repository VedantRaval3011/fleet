import mongoose, { Schema, Document } from 'mongoose';

export interface ILocationSession extends Document {
  sessionId: string;
  deviceId: string;
  employeeId?: string;
  vehicleId?: string;
  companyId?: mongoose.Types.ObjectId;
  driverId?: mongoose.Types.ObjectId;
  startedAt: Date;
  stoppedAt?: Date;
  status: 'ACTIVE' | 'COMPLETED' | 'INTERRUPTED';
  totalPoints: number;
  firstPointAt?: Date;
  lastPointAt?: Date;
  lastUploadAt?: Date;
}

const LocationSessionSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true },
    deviceId: { type: String, required: true, index: true },
    employeeId: { type: String },
    vehicleId: { type: String },
    companyId: { type: Schema.Types.Mixed },
    driverId: { type: Schema.Types.Mixed },
    startedAt: { type: Date, required: true },
    stoppedAt: { type: Date },
    status: { type: String, enum: ['ACTIVE', 'COMPLETED', 'INTERRUPTED'], default: 'ACTIVE' },
    totalPoints: { type: Number, default: 0 },
    firstPointAt: { type: Date },
    lastPointAt: { type: Date },
    lastUploadAt: { type: Date },
  },
  { timestamps: false, collection: 'locationsessions' }
);

// Trip/route history pages page through sessions by device and start time.
LocationSessionSchema.index({ companyId: 1, startedAt: -1 });
LocationSessionSchema.index({ deviceId: 1, startedAt: -1 });
LocationSessionSchema.index({ status: 1, startedAt: -1 });

export default mongoose.models.LocationSession ||
  mongoose.model<ILocationSession>('LocationSession', LocationSessionSchema);

import mongoose, { Schema, Document } from 'mongoose';

export interface ILocationPoint extends Document {
  pointId: string;
  sessionId: string;
  deviceId: string;
  companyId?: mongoose.Types.ObjectId;
  driverId?: mongoose.Types.ObjectId;
  employeeId?: string;
  sequenceNumber: number;
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  speedMetersPerSecond?: number;
  bearingDegrees?: number;
  altitudeMeters?: number;
  recordedAt: Date;
  batteryPercent?: number;
  provider?: string;
  isMockLocation?: boolean;
}

const LocationPointSchema = new Schema(
  {
    pointId: { type: String, required: true, unique: true },
    sessionId: { type: String, required: true, index: true },
    deviceId: { type: String, required: true, index: true },
    companyId: { type: Schema.Types.Mixed },
    driverId: { type: Schema.Types.Mixed },
    employeeId: { type: String },
    sequenceNumber: { type: Number, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracyMeters: { type: Number },
    speedMetersPerSecond: { type: Number },
    bearingDegrees: { type: Number },
    altitudeMeters: { type: Number },
    recordedAt: { type: Date, required: true },
    batteryPercent: { type: Number },
    provider: { type: String },
    isMockLocation: { type: Boolean },
  },
  { timestamps: false, collection: 'locationpoints' }
);

// A route is replayed in sequence order for one session; the fleet map reads
// the newest points per device.
LocationPointSchema.index({ sessionId: 1, sequenceNumber: 1 });
LocationPointSchema.index({ deviceId: 1, recordedAt: -1 });

export default mongoose.models.LocationPoint ||
  mongoose.model<ILocationPoint>('LocationPoint', LocationPointSchema);

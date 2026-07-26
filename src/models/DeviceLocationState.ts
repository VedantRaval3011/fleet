import mongoose, { Schema, Document } from 'mongoose';

export interface IDeviceLocationState extends Document {
  deviceId: string;
  driverId?: mongoose.Types.ObjectId;
  companyId?: mongoose.Types.ObjectId | string;
  employeeId?: string;
  employeeName?: string;
  vehicle?: string | { id?: string; registration?: string };
  latestCoordinates: { lat: number; lng: number };
  latestAccuracy?: number;
  latestSpeed?: number;
  lastRecordedAt?: Date;
  lastReceivedAt?: Date;
  trackingStatus?: string;
  permissionStatus?: string;
  gpsEnabled?: boolean;
  batteryPercent?: number;
  pendingPoints?: number;
  lastUploadAt?: Date;
  appVersion?: string;
}

const DeviceLocationStateSchema = new Schema(
  {
    deviceId: { type: String, required: true, unique: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver' },
    companyId: { type: Schema.Types.Mixed },
    employeeId: { type: String },
    employeeName: { type: String },
    vehicle: { type: Schema.Types.Mixed },
    latestCoordinates: {
      lat: { type: Number },
      lng: { type: Number },
    },
    latestAccuracy: { type: Number },
    latestSpeed: { type: Number },
    lastRecordedAt: { type: Date },
    lastReceivedAt: { type: Date },
    trackingStatus: { type: String },
    permissionStatus: { type: String },
    gpsEnabled: { type: Boolean },
    batteryPercent: { type: Number },
    pendingPoints: { type: Number },
    lastUploadAt: { type: Date },
    appVersion: { type: String },
  },
  { timestamps: false, collection: 'devicelocationstates' }
);

export default mongoose.models.DeviceLocationState ||
  mongoose.model<IDeviceLocationState>('DeviceLocationState', DeviceLocationStateSchema);

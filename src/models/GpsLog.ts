import mongoose, { Schema, Document } from 'mongoose';

export interface IGpsLog extends Document {
  driverId: mongoose.Types.ObjectId;
  companyId: mongoose.Types.ObjectId;
  tripId?: mongoose.Types.ObjectId;
  lat: number;
  lng: number;
  timestamp: Date;
}

const GpsLogSchema = new Schema(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip' },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.models.GpsLog || mongoose.model<IGpsLog>('GpsLog', GpsLogSchema);

import mongoose, { Schema, Document } from 'mongoose';

export interface ILocationCommand extends Document {
  deviceId: string;
  type: 'location_upload' | 'location_latest' | 'location_live_mode' | 'location_stop_live_mode' | 'location_start_tracking' | 'location_stop_tracking';
  status: 'REQUESTED' | 'DELIVERED' | 'UPLOADING' | 'COMPLETED' | 'EXPIRED' | 'FAILED';
  sessionId?: string;
  fromTime?: Date;
  toTime?: Date;
  expiresAt?: Date;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const LocationCommandSchema = new Schema(
  {
    deviceId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ['location_upload', 'location_latest', 'location_live_mode', 'location_stop_live_mode', 'location_start_tracking', 'location_stop_tracking'],
      required: true,
    },
    status: {
      type: String,
      enum: ['REQUESTED', 'DELIVERED', 'UPLOADING', 'COMPLETED', 'EXPIRED', 'FAILED'],
      default: 'REQUESTED',
    },
    sessionId: { type: String },
    fromTime: { type: Date },
    toTime: { type: Date },
    expiresAt: { type: Date },
    error: { type: String },
  },
  { timestamps: true, collection: 'locationcommands' }
);

export default mongoose.models.LocationCommand ||
  mongoose.model<ILocationCommand>('LocationCommand', LocationCommandSchema);

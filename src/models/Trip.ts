import mongoose, { Schema, Document } from 'mongoose';

export interface ITrip extends Document {
  driverId: mongoose.Types.ObjectId;
  companyId: mongoose.Types.ObjectId;
  startLocation: string;
  endLocation?: string;
  startTime: Date;
  endTime?: Date;
  status: 'ongoing' | 'completed' | 'cancelled';
}

const TripSchema = new Schema(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    startLocation: { type: String, required: true },
    endLocation: { type: String },
    startTime: { type: Date, required: true, default: Date.now },
    endTime: { type: Date },
    status: { type: String, enum: ['ongoing', 'completed', 'cancelled'], default: 'ongoing' },
  },
  { timestamps: true }
);

export default mongoose.models.Trip || mongoose.model<ITrip>('Trip', TripSchema);

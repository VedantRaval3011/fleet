import mongoose, { Schema, models, model } from 'mongoose';

export interface IVehicle {
  _id: mongoose.Types.ObjectId;
  companyId: mongoose.Types.ObjectId;
  registration: string;
  make?: string;
  /** Vehicle model name (e.g. Innova). Named vehicleModel to avoid clashing with Document.model(). */
  vehicleModel?: string;
  status: 'active' | 'inactive';
  assignedDriverId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const VehicleSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    registration: { type: String, required: true },
    make: { type: String },
    vehicleModel: { type: String },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    assignedDriverId: { type: Schema.Types.ObjectId, ref: 'Driver' },
  },
  { timestamps: true, collection: 'vehicles' }
);

export default models.Vehicle || model<IVehicle>('Vehicle', VehicleSchema);

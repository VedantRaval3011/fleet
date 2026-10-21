import mongoose, { Schema, Document } from 'mongoose';

export interface IToggleLog extends Document {
  deviceId: string;
  employeeName: string;
  status:
    | 'ON'
    | 'OFF'
    | 'PERMISSION_DENIED'
    | 'PERMISSION_RESTORED'
    | 'ADMIN_DISABLED'
    | 'ADMIN_ENABLED'
    // The user's own shift switch. Distinct from ON/OFF, which is the
    // technician's monitoring switch: a shift is the window the employee agreed
    // to be tracked in, and these two events are its exact boundaries.
    | 'SHIFT_ON'
    | 'SHIFT_OFF'
    // Location lost/regained while tracking was owed (see LocationGate on the device).
    | 'LOCATION_DISABLED'
    | 'LOCATION_RESTORED';
  reason?: string;
  timestamp: Date;
  createdAt: Date;
}

const ToggleLogSchema = new Schema(
  {
    deviceId: { type: String, required: true },
    employeeName: { type: String, default: 'Unknown' },
    status: {
      type: String,
      enum: [
        'ON',
        'OFF',
        'PERMISSION_DENIED',
        'PERMISSION_RESTORED',
        'ADMIN_DISABLED',
        'ADMIN_ENABLED',
        'SHIFT_ON',
        'SHIFT_OFF',
        'LOCATION_DISABLED',
        'LOCATION_RESTORED',
      ],
      required: true,
    },
    reason: { type: String },
    timestamp: { type: Date, required: true }
  },
  { timestamps: true }
);

export default mongoose.models.ToggleLog || mongoose.model<IToggleLog>('ToggleLog', ToggleLogSchema);

import mongoose, { Schema } from "mongoose";

const DeviceEnrollmentSchema = new Schema(
  {
    deviceId: { type: String, required: true, index: true },
    employeeId: String,
    employeeName: String,
    role: String,
    companyId: Schema.Types.Mixed,
    vehicle: {
      id: String,
      registration: String,
    },
    revoked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

DeviceEnrollmentSchema.index({ deviceId: 1, revoked: 1 });

export default mongoose.models.DeviceEnrollment ||
  mongoose.model("DeviceEnrollment", DeviceEnrollmentSchema);


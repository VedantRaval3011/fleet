import mongoose, { Schema } from "mongoose";

/**
 * Handset row written by the Express enrollment service. The dashboard only
 * reads and links it to a Driver so an allocated advance reaches that phone.
 * `strict: false` keeps fields this process does not own.
 */
const DeviceEnrollmentSchema = new Schema(
  {
    deviceId: { type: String, required: true, index: true },
    employeeId: String,
    employeeName: String,
    role: String,
    companyId: Schema.Types.Mixed,
    driverId: Schema.Types.Mixed,
    deviceToken: String,
    vehicle: {
      id: String,
      registration: String,
    },
    revoked: { type: Boolean, default: false },
  },
  { strict: false, timestamps: true, collection: "deviceenrollments" }
);

DeviceEnrollmentSchema.index({ deviceId: 1, revoked: 1 });

export default mongoose.models.DeviceEnrollment ||
  mongoose.model("DeviceEnrollment", DeviceEnrollmentSchema);

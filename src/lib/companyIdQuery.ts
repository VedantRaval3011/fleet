import mongoose from "mongoose";

/** Match companyId whether Mongo stored it as string or ObjectId. */
export function companyIdIn(companyId: string) {
  const values: Array<string | mongoose.Types.ObjectId> = [String(companyId)];
  if (mongoose.Types.ObjectId.isValid(companyId)) {
    values.push(new mongoose.Types.ObjectId(companyId));
  }
  return { $in: values };
}

/** Normalize vehicle field from string or { registration } for UI. */
export function vehicleLabel(vehicle: unknown): string | undefined {
  if (!vehicle) return undefined;
  if (typeof vehicle === "string") return vehicle;
  if (typeof vehicle === "object" && vehicle !== null) {
    const v = vehicle as { registration?: string; id?: string };
    return v.registration || v.id || undefined;
  }
  return undefined;
}

import mongoose from "mongoose";

/** Match companyId whether Mongo stored it as string or ObjectId. */
export function companyIdIn(companyId: string) {
  const values: Array<string | mongoose.Types.ObjectId> = [String(companyId)];
  if (mongoose.Types.ObjectId.isValid(companyId)) {
    values.push(new mongoose.Types.ObjectId(companyId));
  }
  return { $in: values };
}

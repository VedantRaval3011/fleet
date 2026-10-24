import mongoose, { Schema } from "mongoose";

/** One-time sign-in for the Android expense portal. Consumed on first use. */
const PortalTicketSchema = new Schema(
  {
    ticket: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: "portaltickets" }
);

PortalTicketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.PortalTicket || mongoose.model("PortalTicket", PortalTicketSchema);

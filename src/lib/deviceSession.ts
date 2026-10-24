/**
 * The Android app knows a device token, not a website session. These helpers
 * turn that token into the Driver wallet the dashboard allocates to, and into
 * a one-time ticket that signs the expense portal in as that same person.
 */
import crypto from "node:crypto";
import mongoose from "mongoose";
import DeviceEnrollment from "@/models/DeviceEnrollment";
import Driver from "@/models/Driver";
import User from "@/models/User";
import PortalTicket from "@/models/PortalTicket";
import { ensureEnrollmentDriverAccounts } from "@/lib/enrollmentDrivers";
import { getDriverAccount } from "@/lib/expenseLedger";

/* eslint-disable @typescript-eslint/no-explicit-any */
const DeviceM = DeviceEnrollment as mongoose.Model<any>;
const DriverM = Driver as mongoose.Model<any>;
const UserM = User as mongoose.Model<any>;
const TicketM = PortalTicket as mongoose.Model<any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

const TICKET_TTL_MS = 2 * 60 * 1000;

export interface DeviceWallet {
  driverId: string;
  userId: string;
  name: string;
  balance: number;
}

function bearer(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

/**
 * The Driver this handset should see. Links the device first when an admin has
 * not opened the driver list yet, so a freshly enrolled phone still resolves.
 */
export async function walletForDeviceToken(token: string): Promise<DeviceWallet | null> {
  if (!token) return null;
  let device = await DeviceM.findOne({ deviceToken: token }).lean();
  if (!device || device.revoked) return null;

  let driver = device.driverId ? await DriverM.findById(device.driverId).populate("userId", "name role") : null;
  if (!driver) {
    const companyId = device.companyId ? String(device.companyId) : null;
    await ensureEnrollmentDriverAccounts(companyId);
    device = await DeviceM.findOne({ deviceToken: token }).lean();
    if (!device || device.revoked || !device.driverId) return null;
    driver = await DriverM.findById(device.driverId).populate("userId", "name role");
  }
  if (!driver) return null;

  const user = driver.userId;
  const userId = user?._id ? String(user._id) : String(driver.userId ?? "");
  if (!userId) return null;

  const account = await getDriverAccount(String(driver._id));
  const balance = account?.balance ?? (typeof driver.walletBalance === "number" ? driver.walletBalance : 0);

  return {
    driverId: String(driver._id),
    userId,
    name: user?.name || device.employeeName || "Driver",
    balance,
  };
}

export async function walletFromRequest(req: Request): Promise<DeviceWallet | null> {
  return walletForDeviceToken(bearer(req));
}

/** Short-lived ticket the phone puts in the expense-portal URL. Single use. */
export async function issuePortalTicket(userId: string): Promise<string> {
  const ticket = crypto.randomBytes(32).toString("hex");
  await TicketM.create({
    ticket,
    userId: new mongoose.Types.ObjectId(userId),
    expiresAt: new Date(Date.now() + TICKET_TTL_MS),
  });
  return ticket;
}

/** Consume a ticket and return the driver user it signs in, or null. */
export async function consumePortalTicket(ticket: string) {
  if (!ticket || ticket.length < 32) return null;
  const row = await TicketM.findOneAndDelete({
    ticket,
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!row?.userId) return null;
  const user = await UserM.findById(row.userId).lean();
  if (!user || user.role !== "driver") return null;
  return user;
}

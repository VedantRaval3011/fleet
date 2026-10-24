/**
 * Device Enrollment is the list of people who actually have a handset.
 * A code only gets a Driver (and therefore a wallet) when an admin also sets a
 * username. Everyone else — Vedant, Deepakbhai, and any later code — never
 * appears in Allocate advance, and money cannot reach their phone.
 *
 * This links every non-revoked driver code to a Driver, creating the account
 * when one does not already exist, and points the handset at that same Driver
 * so an allocation and the Android wallet are the same balance.
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import EnrollmentCode from "@/models/EnrollmentCode";
import DeviceEnrollment from "@/models/DeviceEnrollment";
import User from "@/models/User";
import Driver from "@/models/Driver";

/* eslint-disable @typescript-eslint/no-explicit-any */
const CodeM = EnrollmentCode as mongoose.Model<any>;
const DeviceM = DeviceEnrollment as mongoose.Model<any>;
const UserM = User as mongoose.Model<any>;
const DriverM = Driver as mongoose.Model<any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

type CodeDoc = {
  _id: mongoose.Types.ObjectId;
  code?: string;
  companyId?: unknown;
  employeeId?: string;
  employeeName?: string;
  departmentId?: unknown;
  capabilities?: {
    callMonitoring?: boolean;
    locationTracking?: boolean;
    expenseManagement?: boolean;
    shifts?: boolean | null;
  };
  driverId?: unknown;
};

function isObjectId(value: unknown): value is mongoose.Types.ObjectId {
  return (
    value instanceof mongoose.Types.ObjectId ||
    (typeof value === "object" &&
      value !== null &&
      (value as { _bsontype?: string })._bsontype === "ObjectId")
  );
}

/** ObjectId and its string form, so a value written by either process still matches. */
export function idVariants(value: unknown): Array<string | mongoose.Types.ObjectId> {
  if (value == null) return [];
  // ObjectId exposes `_id` as itself. Unwrap only plain documents, or this recurses forever.
  if (isObjectId(value)) {
    const hex = String(value);
    return mongoose.isValidObjectId(hex) ? [hex, new mongoose.Types.ObjectId(hex)] : [hex];
  }
  if (typeof value === "object" && "_id" in (value as object)) {
    return idVariants((value as { _id: unknown })._id);
  }
  const str = String(value);
  if (!str || str === "[object Object]") return [];
  const out: Array<string | mongoose.Types.ObjectId> = [str];
  if (mongoose.isValidObjectId(str)) out.push(new mongoose.Types.ObjectId(str));
  return out;
}

function asObjectId(value: unknown): mongoose.Types.ObjectId | null {
  const variants = idVariants(value);
  const oid = variants.find((v) => v instanceof mongoose.Types.ObjectId);
  return (oid as mongoose.Types.ObjectId) ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Same resolution the phone uses when it refreshes access: `shifts` follows
 * location tracking when the code never stored it. Copying this onto the user
 * matters because, once a handset has a driverId, the server trusts the user
 * record over the code.
 */
function capabilitiesFromCode(raw: CodeDoc["capabilities"]) {
  const c = raw ?? {};
  const locationTracking = Boolean(c.locationTracking);
  return {
    callMonitoring: Boolean(c.callMonitoring),
    locationTracking,
    expenseManagement: Boolean(c.expenseManagement),
    shifts: c.shifts === undefined || c.shifts === null ? locationTracking : Boolean(c.shifts),
  };
}

async function driverById(id: unknown) {
  const oid = asObjectId(id);
  if (!oid) return null;
  return DriverM.findById(oid);
}

/** A handset already enrolled for this code may already point at the right wallet. */
async function driverFromDevices(code: CodeDoc) {
  const keys = [code.employeeId, code.code].filter((v): v is string => Boolean(v && v.trim()));
  if (!keys.length) return null;
  const device = await DeviceM.findOne({
    revoked: { $ne: true },
    employeeId: { $in: keys },
    driverId: { $nin: [null, ""] },
  })
    .select("driverId")
    .lean();
  return device ? driverById(device.driverId) : null;
}

/** One driver in this company already has this exact name: that is the person on the code. */
async function driverByExactName(code: CodeDoc) {
  const name = code.employeeName?.trim();
  const company = idVariants(code.companyId);
  if (!name || !company.length) return null;
  const users = await UserM.find({
    role: "driver",
    companyId: { $in: company },
    name: new RegExp(`^${escapeRegExp(name)}$`, "i"),
  })
    .select("_id")
    .limit(2)
    .lean();
  if (users.length !== 1) return null;
  const existing = await DriverM.findOne({ userId: users[0]._id });
  if (existing) return existing;
  const companyId = asObjectId(code.companyId);
  if (!companyId) return null;
  return DriverM.create({
    userId: users[0]._id,
    companyId,
    walletBalance: 0,
    status: "active",
  });
}

async function createDriverForCode(code: CodeDoc) {
  const companyId = asObjectId(code.companyId);
  const name = code.employeeName?.trim();
  if (!companyId || !name) return null;

  const email = `enroll.${String(code._id)}@driver.local`;
  // A username is required in practice: the users collection has a unique index
  // on username, and a missing username collides with every other account that
  // also has none. The id keeps it unique without inventing a login the driver knows.
  const username = `enroll.${String(code._id)}`;
  let user = await UserM.findOne({ $or: [{ email }, { username }] });
  if (!user) {
    const departmentId = asObjectId(code.departmentId);
    try {
      user = await UserM.create({
        name,
        email,
        username,
        passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10),
        role: "driver",
        companyId,
        ...(departmentId ? { departmentId } : {}),
        capabilities: capabilitiesFromCode(code.capabilities),
      });
    } catch (e) {
      // A parallel page load created the same account. Use it.
      if (typeof e === "object" && e && (e as { code?: number }).code === 11000) {
        user = await UserM.findOne({ $or: [{ email }, { username }] });
      }
      if (!user) throw e;
    }
  }
  if (!user) return null;

  let driver = await DriverM.findOne({ userId: user._id });
  if (!driver) {
    driver = await DriverM.create({
      userId: user._id,
      companyId,
      walletBalance: 0,
      status: "active",
    });
  }
  return driver;
}

async function linkDevices(code: CodeDoc, driverId: mongoose.Types.ObjectId) {
  const keys = [code.employeeId, code.code].filter((v): v is string => Boolean(v && v.trim()));
  const company = idVariants(code.companyId);
  const name = code.employeeName?.trim();
  const or: Record<string, unknown>[] = [];
  if (keys.length) or.push({ employeeId: { $in: keys } });
  // A handset enrolled before this code had a wallet has no driverId. Claim it
  // by name only when it is still unlinked, so a different driver's phone is left alone.
  if (name && company.length) {
    or.push({ employeeName: name, companyId: { $in: company }, driverId: null });
    or.push({ employeeName: name, companyId: { $in: company }, driverId: "" });
  }
  if (!or.length) return;
  await DeviceM.updateMany({ revoked: { $ne: true }, $or: or }, { $set: { driverId } });
}

async function ensureOne(code: CodeDoc) {
  let driver = await driverById(code.driverId);
  if (!driver) driver = await driverFromDevices(code);
  if (!driver) driver = await driverByExactName(code);
  if (!driver) driver = await createDriverForCode(code);
  if (!driver) return;

  if (String(code.driverId ?? "") !== String(driver._id)) {
    await CodeM.updateOne({ _id: code._id }, { $set: { driverId: driver._id } });
  }
  await linkDevices(code, driver._id as mongoose.Types.ObjectId);
}

/**
 * Make sure every driver on Device Enrollment has a wallet in this company.
 * `companyId` null covers a super admin looking across companies.
 */
export async function ensureEnrollmentDriverAccounts(companyId?: string | null): Promise<void> {
  const filter: Record<string, unknown> = {
    revoked: { $ne: true },
    role: { $ne: "employee" },
  };
  if (companyId) filter.companyId = { $in: idVariants(companyId) };

  const codes = (await CodeM.find(filter).limit(500).lean()) as CodeDoc[];
  for (const code of codes) {
    try {
      await ensureOne(code);
    } catch (e) {
      console.error("enrollment driver sync failed", code.code ?? code._id, e);
    }
  }
}

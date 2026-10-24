/**
 * Income & Expense service: the ONLY place that moves driver money.
 *
 * Every operation runs in one MongoDB transaction that writes three things
 * together or not at all:
 *   1. the Expense (status change / creation),
 *   2. the Driver's cached `walletBalance`,
 *   3. an append-only LedgerEntry describing what happened and who did it.
 *
 * API routes and pages must go through here rather than touching
 * `walletBalance` directly, otherwise the ledger and the balance diverge.
 *
 * Callers must `await connectToDatabase()` first.
 */
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import Driver from "@/models/Driver";
import Expense from "@/models/Expense";
import LedgerEntry from "@/models/LedgerEntry";
// Legacy collection: only read, to detect drivers who still need migrating.
import WalletTransaction from "@/models/WalletTransaction";
import {
  EXPENSE_CATEGORIES,
  balanceEffectFor,
  buildAccountFigures,
  computeExcess,
  expenseSubmissionKey,
  parseAmount,
  parseExpenseDate,
  parseReceiptDataUrl,
  round2,
  type AccountFigures,
  type LedgerEntryType,
} from "@/lib/expenseMath";

// The models are exported as `Model<any> | Model<T>` unions, which TypeScript
// cannot call overloads on, and populate()/aggregate() results do not fit the
// document interfaces. We use them structurally, so widen once here; every value
// that leaves this file goes through a typed DTO mapper below.
/* eslint-disable @typescript-eslint/no-explicit-any */
const DriverM = Driver as mongoose.Model<any>;
const ExpenseM = Expense as mongoose.Model<any>;
const LedgerM = LedgerEntry as mongoose.Model<any>;
const WalletTransactionM = WalletTransaction as mongoose.Model<any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Errors & actors
// ---------------------------------------------------------------------------

export class LedgerError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

/** The authenticated user performing an operation (from the NextAuth session). */
export interface Actor {
  id: string;
  name: string;
  role: string;
  companyId?: string | null;
}

/**
 * Tenant scope for an actor: a company id, or null for a super admin (all
 * companies). Anyone else without a company is refused rather than given
 * unscoped access.
 */
export function companyScopeFor(actor: Actor): string | null {
  // Super admins see every company, same as Device Enrollment. A companyId on
  // their own user must not hide drivers who were enrolled under another company.
  if (actor.role === "super_admin") return null;
  if (!actor.companyId) throw new LedgerError(403, "NO_COMPANY", "Your account is not assigned to a company.");
  return actor.companyId;
}

function toObjectId(value: unknown, what: string): mongoose.Types.ObjectId {
  if (typeof value !== "string" || !mongoose.Types.ObjectId.isValid(value)) {
    throw new LedgerError(400, "INVALID_ID", `Invalid ${what}.`);
  }
  return new mongoose.Types.ObjectId(value);
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t ? t.slice(0, max) : undefined;
}

/** `$round(walletBalance + delta, 2)` as an update pipeline: atomic and float-noise free. */
function adjustBalance(delta: number) {
  return [
    {
      $set: {
        walletBalance: { $round: [{ $add: [{ $ifNull: ["$walletBalance", 0] }, delta] }, 2] },
      },
    },
  ];
}

function isDuplicateKey(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: number }).code === 11000;
}

/**
 * Guard for drivers whose history predates the ledger.
 *
 * Before the ledger, wallet balances and expenses lived only on the Driver and
 * Expense records. If we recorded a first ledger entry for such a driver, the
 * migration script would then see "already has ledger entries" and skip them,
 * permanently losing their earlier history. So until the migration has run we
 * refuse to change their account at all. A brand-new driver (zero balance, no
 * wallet transactions, no expenses) is fine.
 */
async function assertLedgerReady(driver: { _id: unknown; walletBalance?: number }, session: mongoose.ClientSession) {
  if (await LedgerM.exists({ driverId: driver._id }).session(session)) return;
  const hasLegacyHistory =
    (driver.walletBalance ?? 0) !== 0 ||
    !!(await WalletTransactionM.exists({ driverId: driver._id }).session(session)) ||
    !!(await ExpenseM.exists({ driverId: driver._id }).session(session));
  if (hasLegacyHistory) {
    throw new LedgerError(
      409,
      "LEDGER_MIGRATION_REQUIRED",
      "This account is being upgraded to the new expense ledger and cannot be changed yet. " +
        "An administrator needs to run scripts/migrate-expense-ledger.mjs. Nothing was changed."
    );
  }
}

async function inTransaction<T>(fn: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

// ---------------------------------------------------------------------------
// DTOs (plain, JSON-safe shapes shared with the UI)
// ---------------------------------------------------------------------------

export interface LedgerEntryDTO {
  id: string;
  driverId: string;
  driverName: string;
  type: LedgerEntryType;
  amount: number;
  balanceEffect: number;
  balanceAfter: number;
  expenseId: string | null;
  performedByName: string;
  performedByRole: string;
  note: string | null;
  isAdditionalAdvance: boolean;
  excessAmount: number;
  timestamp: string;
}

export interface ExpenseDTO {
  id: string;
  driverId: string;
  driverName: string;
  amount: number;
  category: string;
  description: string;
  /** Date the money was spent (YYYY-MM-DD semantics, stored 00:00 UTC). */
  expenseDate: string;
  submittedAt: string;
  status: "pending" | "approved" | "rejected";
  reviewedByName: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  excessAmount: number;
  balanceAfterApproval: number | null;
  /** Taken from the wallet at submission (refunded if rejected); false for legacy rows. */
  deductedOnSubmit: boolean;
  /** Wallet balance right after this expense was deducted, whenever that happened. */
  walletBalanceAfter: number | null;
  location: { lat: number; lng: number } | null;
  receiptUrl: string;
}

export interface AccountRow extends AccountFigures {
  driverId: string;
  userId: string | null;
  name: string;
  email: string;
  status: string;
  advanceCount: number;
  submittedCount: number;
  pendingCount: number;
  lastActivityAt: string | null;
  /** The cached wallet balance on the Driver document. */
  cachedBalance: number;
  /** True when the cached balance disagrees with the ledger (needs reconcile). */
  drifted: boolean;
}

export interface AccountTotals {
  driverCount: number;
  totalAdvance: number;
  totalSubmitted: number;
  totalApproved: number;
  totalPending: number;
  totalRejected: number;
  pendingCount: number;
  /** Sum of unspent advances across drivers who are in credit. */
  totalRemaining: number;
  /** Sum of outstanding amounts payable to overdrawn drivers. */
  totalExcess: number;
  overdrawnCount: number;
  /** advances - approved, across everyone (remaining - excess). */
  netBalance: number;
  driftedCount: number;
}

export const receiptUrlFor = (expenseId: string) =>
  `/api/income-expense/expenses/${expenseId}/receipt`;

/** An Expense as returned by `listExpenses` (lean, driver and reviewer populated). */
interface ExpenseRow {
  _id: unknown;
  driverId: { _id: unknown; userId?: { name?: string } | null } | null;
  amount: number;
  category: string;
  description?: string;
  note?: string;
  expenseDate?: Date;
  timestamp: Date;
  status: "pending" | "approved" | "rejected";
  adminApprovalBy?: { name?: string } | null;
  reviewedAt?: Date;
  rejectionReason?: string;
  excessAmount?: number;
  walletBalanceAfter?: number;
  deductedOnSubmit?: boolean;
  location?: { lat: number; lng: number };
}

/** A LedgerEntry as read from the database (lean) or just created. */
interface LedgerRow {
  _id: unknown;
  driverId: unknown;
  driverName?: string;
  type: LedgerEntryType;
  amount: number;
  balanceEffect: number;
  balanceAfter: number;
  expenseId?: unknown;
  performedByName?: string;
  performedByRole?: string;
  note?: string;
  isAdditionalAdvance?: boolean;
  excessAmount?: number;
  timestamp: Date;
}

/** A Driver with its user populated, as read by `getAccountSummaries`. */
interface DriverRow {
  _id: unknown;
  userId?: { _id?: unknown; name?: string; email?: string } | null;
  status: string;
  walletBalance?: number;
}

function toExpenseDTO(e: ExpenseRow): ExpenseDTO {
  const driverUser = e.driverId?.userId;
  return {
    id: String(e._id),
    driverId: String(e.driverId?._id),
    driverName: driverUser?.name ?? "Deleted driver",
    amount: e.amount,
    category: e.category,
    // Rows created before `description` existed carry their text in `note`.
    description: e.description ?? e.note ?? "",
    expenseDate: new Date(e.expenseDate ?? e.timestamp).toISOString(),
    submittedAt: new Date(e.timestamp).toISOString(),
    status: e.status,
    reviewedByName: e.adminApprovalBy?.name ?? null,
    reviewedAt: e.reviewedAt ? new Date(e.reviewedAt).toISOString() : null,
    rejectionReason: e.rejectionReason ?? null,
    excessAmount: e.excessAmount ?? 0,
    balanceAfterApproval: e.status === "approved" ? e.walletBalanceAfter ?? null : null,
    deductedOnSubmit: !!e.deductedOnSubmit,
    walletBalanceAfter: e.walletBalanceAfter ?? null,
    location: e.location ? { lat: e.location.lat, lng: e.location.lng } : null,
    receiptUrl: receiptUrlFor(String(e._id)),
  };
}

function toLedgerDTO(l: LedgerRow): LedgerEntryDTO {
  return {
    id: String(l._id),
    driverId: String(l.driverId),
    driverName: l.driverName ?? "Unknown driver",
    type: l.type,
    amount: l.amount,
    balanceEffect: l.balanceEffect,
    balanceAfter: l.balanceAfter,
    expenseId: l.expenseId ? String(l.expenseId) : null,
    performedByName: l.performedByName ?? "System",
    performedByRole: l.performedByRole ?? "",
    note: l.note ?? null,
    isAdditionalAdvance: !!l.isAdditionalAdvance,
    excessAmount: l.excessAmount ?? 0,
    timestamp: new Date(l.timestamp).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface AllocateAdvanceInput {
  driverId: unknown;
  amount: unknown;
  note?: unknown;
  /** Makes a retried/double-clicked request a no-op instead of a second advance. */
  idempotencyKey?: unknown;
  actor: Actor;
}

export async function allocateAdvance(input: AllocateAdvanceInput) {
  const driverId = toObjectId(input.driverId, "driver");
  const amount = parseAmount(input.amount);
  if (amount === null) {
    throw new LedgerError(400, "INVALID_AMOUNT", "Enter a valid positive amount.");
  }
  const note = cleanText(input.note, 500);
  const idempotencyKey = cleanText(input.idempotencyKey, 100);
  const scope = companyScopeFor(input.actor);

  try {
    return await inTransaction(async (session) => {
      const driver = await DriverM.findById(driverId).populate("userId", "name").session(session);
      if (!driver || (scope && String(driver.companyId) !== scope)) {
        throw new LedgerError(404, "DRIVER_NOT_FOUND", "Driver not found.");
      }
      await assertLedgerReady(driver, session);
      const priorAdvances = await LedgerM.countDocuments({ driverId, type: "advance" }).session(session);

      const updated = await DriverM.findOneAndUpdate({ _id: driverId }, adjustBalance(amount), {
        returnDocument: 'after',
        session,
        updatePipeline: true,
      });

      const [entry] = await LedgerM.create(
        [
          {
            driverId,
            companyId: driver.companyId,
            type: "advance",
            amount,
            balanceEffect: balanceEffectFor("advance", amount),
            balanceAfter: updated.walletBalance,
            driverName: driver.userId?.name,
            performedBy: new mongoose.Types.ObjectId(input.actor.id),
            performedByName: input.actor.name,
            performedByRole: input.actor.role,
            note,
            isAdditionalAdvance: priorAdvances > 0,
            idempotencyKey,
            timestamp: new Date(),
          },
        ],
        { session }
      );
      return { entry: toLedgerDTO(entry), balance: updated.walletBalance as number, duplicate: false };
    });
  } catch (e) {
    if (idempotencyKey && isDuplicateKey(e)) {
      // The earlier request already succeeded; report it instead of failing.
      const existing = await LedgerM.findOne({ idempotencyKey }).lean();
      if (existing && String(existing.driverId) === String(driverId)) {
        const driver = await DriverM.findById(driverId).lean();
        return { entry: toLedgerDTO(existing), balance: (driver?.walletBalance ?? 0) as number, duplicate: true };
      }
    }
    throw e;
  }
}

export interface SubmitExpenseInput {
  /** The driver's User id (from the session) - never taken from the request body. */
  userId: string;
  userName: string;
  amount: unknown;
  category: unknown;
  description: unknown;
  expenseDate: unknown;
  photoDataUrl: unknown;
  latitude: unknown;
  longitude: unknown;
  accuracy?: unknown;
  /** Per-attempt id from the client; a resend with the same id returns the original. */
  clientRequestId?: unknown;
}

export interface SubmitExpenseResult {
  id: string;
  status: "pending" | "approved" | "rejected";
  amount: number;
  /** Driver balance after this expense was deducted. */
  balance: number;
  /** Portion not covered by the balance the driver had before submitting. */
  excessAmount: number;
  /** True when this was a resend of an expense that was already recorded. */
  duplicate: boolean;
}

const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Record a new expense and deduct it from the driver's wallet in the same
 * transaction. It is never refused for exceeding the balance: the balance just
 * goes negative. It stays `pending` until HR approves (no further change) or
 * rejects it (refunded).
 */
export async function submitExpense(input: SubmitExpenseInput): Promise<SubmitExpenseResult> {
  const amount = parseAmount(input.amount);
  if (amount === null) throw new LedgerError(400, "INVALID_AMOUNT", "Enter a valid positive amount.");

  // Category and description are optional for the driver; an unrecognised category is still refused.
  const category = input.category == null || input.category === "" ? "Other" : input.category;
  if (typeof category !== "string" || !(EXPENSE_CATEGORIES as readonly string[]).includes(category)) {
    throw new LedgerError(400, "INVALID_CATEGORY", "Choose an expense category.");
  }

  const description = cleanText(input.description, 500);

  const expenseDate = parseExpenseDate(input.expenseDate);
  if (!expenseDate) {
    throw new LedgerError(400, "INVALID_DATE", "Enter a valid expense date that is not in the future.");
  }

  const receipt = parseReceiptDataUrl(input.photoDataUrl);
  if (!receipt) {
    throw new LedgerError(400, "RECEIPT_REQUIRED", "Attach a clear photo of the bill or receipt (JPEG, PNG or WebP, up to 5 MB).");
  }

  const lat = input.latitude;
  const lng = input.longitude;
  if (
    typeof lat !== "number" || typeof lng !== "number" ||
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    Math.abs(lat) > 90 || Math.abs(lng) > 180
  ) {
    throw new LedgerError(400, "LOCATION_REQUIRED", "A GPS location is required.");
  }
  const accuracy = typeof input.accuracy === "number" && Number.isFinite(input.accuracy) ? input.accuracy : undefined;

  const userId = toObjectId(input.userId, "user");
  const submissionKey = expenseSubmissionKey(
    input.clientRequestId,
    { amount, category, receiptBase64: receipt.base64 },
    sha256Hex
  );

  const driverRef = await DriverM.findOne({ userId }).select("_id").lean();
  if (!driverRef) throw new LedgerError(404, "DRIVER_NOT_FOUND", "Driver profile not found.");

  const findPrevious = async (): Promise<SubmitExpenseResult | null> => {
    const prev = await ExpenseM.findOne({ driverId: driverRef._id, submissionKey })
      .select("amount status walletBalanceAfter excessAmount")
      .lean();
    if (!prev) return null;
    return {
      id: String(prev._id),
      status: prev.status,
      amount: prev.amount,
      balance: round2(prev.walletBalanceAfter ?? 0),
      excessAmount: prev.excessAmount ?? 0,
      duplicate: true,
    };
  };

  // The common retry case, answered without opening a transaction.
  const earlier = await findPrevious();
  if (earlier) return earlier;
  // The unique (driverId, submissionKey) index is what stops two concurrent
  // requests both deducting; make sure it exists before relying on it.
  await ExpenseM.init();

  try {
    return await inTransaction(async (session) => {
      const current = await DriverM.findById(driverRef._id).session(session);
      if (!current) throw new LedgerError(404, "DRIVER_NOT_FOUND", "Driver profile not found.");
      await assertLedgerReady(current, session);

      const driver = await DriverM.findOneAndUpdate({ _id: current._id }, adjustBalance(-amount), {
        returnDocument: "after",
        session,
        updatePipeline: true,
      });
      const balanceAfter = round2(driver.walletBalance ?? 0);
      const excess = computeExcess(round2(balanceAfter + amount), amount);

      const now = new Date();
      const [expense] = await ExpenseM.create(
        [
          {
            driverId: driver._id,
            companyId: driver.companyId,
            amount,
            category,
            description: description || undefined,
            expenseDate,
            photoUrl: `data:${receipt.mime};base64,${receipt.base64}`,
            location: { lat, lng },
            locationAccuracy: accuracy,
            timestamp: now,
            status: "pending",
            deductedOnSubmit: true,
            walletBalanceAfter: balanceAfter,
            excessAmount: excess,
            submissionKey,
          },
        ],
        { session }
      );

      await LedgerM.create(
        [
          {
            driverId: driver._id,
            companyId: driver.companyId,
            type: "expense_submitted",
            amount,
            balanceEffect: balanceEffectFor("expense_submitted", amount, true),
            balanceAfter,
            expenseId: expense._id,
            driverName: input.userName,
            performedBy: userId,
            performedByName: input.userName,
            performedByRole: "driver",
            excessAmount: excess,
            timestamp: now,
          },
        ],
        { session }
      );

      return {
        id: String(expense._id),
        status: "pending" as const,
        amount,
        balance: balanceAfter,
        excessAmount: excess,
        duplicate: false,
      };
    });
  } catch (e) {
    // A concurrent identical request won the race; its transaction did the deduction.
    if (isDuplicateKey(e)) {
      const winner = await findPrevious();
      if (winner) return winner;
    }
    throw e;
  }
}

export interface ReviewExpenseInput {
  expenseId: unknown;
  decision: unknown; // "approve" | "reject"
  /** Required for rejections. */
  reason?: unknown;
  /** Must be true to approve an expense that exceeds the driver's available balance. */
  confirmExcess?: unknown;
  actor: Actor;
}

export async function reviewExpense(input: ReviewExpenseInput) {
  const expenseId = toObjectId(input.expenseId, "expense");
  if (input.decision !== "approve" && input.decision !== "reject") {
    throw new LedgerError(400, "INVALID_DECISION", "Decision must be 'approve' or 'reject'.");
  }
  const approve = input.decision === "approve";
  const reason = cleanText(input.reason, 500);
  if (!approve && (!reason || reason.length < 3)) {
    throw new LedgerError(400, "REASON_REQUIRED", "A reason is required to reject an expense.");
  }
  const scope = companyScopeFor(input.actor);
  const actorId = new mongoose.Types.ObjectId(input.actor.id);

  return inTransaction(async (session) => {
    const now = new Date();

    // Claim the expense. The `status: pending` condition makes this atomic, so
    // two reviewers (or a double-click) can never both act on the same expense.
    const claimed = await ExpenseM.findOneAndUpdate(
      { _id: expenseId, status: "pending", ...(scope ? { companyId: new mongoose.Types.ObjectId(scope) } : {}) },
      {
        $set: {
          status: approve ? "approved" : "rejected",
          adminApprovalBy: actorId,
          reviewedAt: now,
          ...(approve ? {} : { rejectionReason: reason }),
        },
      },
      { returnDocument: 'after', session }
    ).select("-photoUrl");

    if (!claimed) {
      const current = await ExpenseM.findOne({
        _id: expenseId,
        ...(scope ? { companyId: new mongoose.Types.ObjectId(scope) } : {}),
      })
        .select("status")
        .session(session);
      if (!current) throw new LedgerError(404, "EXPENSE_NOT_FOUND", "Expense not found.");
      throw new LedgerError(409, "ALREADY_REVIEWED", `This expense was already ${current.status}.`, {
        status: current.status,
      });
    }

    // Refuse (and roll back the claim) if this driver's older history is not migrated yet.
    const current = await DriverM.findById(claimed.driverId).select("walletBalance").session(session);
    if (current) await assertLedgerReady(current, session);

    // Already deducted on submit: approving changes nothing, rejecting refunds.
    // Legacy expenses: approving deducts, rejecting changes nothing.
    const deducted = claimed.deductedOnSubmit === true;
    const type: LedgerEntryType = approve ? "expense_approved" : "expense_rejected";
    const effect = balanceEffectFor(type, claimed.amount, deducted);

    const driver =
      effect !== 0
        ? await DriverM.findOneAndUpdate({ _id: claimed.driverId }, adjustBalance(effect), {
            returnDocument: "after",
            session,
            updatePipeline: true,
          }).populate("userId", "name")
        : await DriverM.findById(claimed.driverId).populate("userId", "name").session(session);
    if (!driver) throw new LedgerError(404, "DRIVER_NOT_FOUND", "Driver not found.");

    const balanceAfter = round2(driver.walletBalance ?? 0);
    let excess = 0;

    if (approve && deducted) {
      // Any excess was taken (and recorded) when the driver submitted.
      excess = claimed.excessAmount ?? 0;
    } else if (approve) {
      const balanceBefore = round2(balanceAfter + claimed.amount);
      excess = computeExcess(balanceBefore, claimed.amount);
      if (excess > 0 && input.confirmExcess !== true) {
        // Throwing aborts the transaction: the claim and balance change roll back.
        throw new LedgerError(
          409,
          "EXCESS_CONFIRMATION_REQUIRED",
          "This expense exceeds the driver's available balance. Confirm to approve the excess.",
          { balanceBefore, amount: claimed.amount, excessAmount: excess, balanceAfter }
        );
      }
      await ExpenseM.updateOne(
        { _id: expenseId },
        { $set: { excessAmount: excess, walletBalanceAfter: balanceAfter } },
        { session }
      );
    }

    const [entry] = await LedgerM.create(
      [
        {
          driverId: claimed.driverId,
          companyId: claimed.companyId,
          type,
          amount: claimed.amount,
          balanceEffect: effect,
          balanceAfter,
          expenseId,
          driverName: driver.userId?.name,
          performedBy: actorId,
          performedByName: input.actor.name,
          performedByRole: input.actor.role,
          note: approve ? undefined : reason,
          excessAmount: approve ? excess : undefined,
          timestamp: now,
        },
      ],
      { session }
    );

    return {
      expenseId: String(expenseId),
      status: claimed.status as "approved" | "rejected",
      excessAmount: excess,
      balance: balanceAfter,
      /** Signed change this decision made to the balance (refund > 0, legacy approval < 0). */
      balanceChange: effect,
      entry: toLedgerDTO(entry),
    };
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

interface AccountFilter {
  /** Restrict to one company (null/undefined = all companies, super admin only). */
  companyId?: string | null;
  driverId?: string;
}

const DRIFT_TOLERANCE = 0.005;

/** Per-driver accounts, computed from the ledger and expense records. */
export async function getAccountSummaries(filter: AccountFilter): Promise<{
  drivers: AccountRow[];
  totals: AccountTotals;
}> {
  const driverMatch: Record<string, unknown> = {};
  const rowMatch: Record<string, unknown> = {};
  if (filter.companyId) {
    const cid = new mongoose.Types.ObjectId(filter.companyId);
    driverMatch.companyId = cid;
    rowMatch.companyId = cid;
  }
  if (filter.driverId) {
    const did = new mongoose.Types.ObjectId(filter.driverId);
    driverMatch._id = did;
    rowMatch.driverId = did;
  }

  const [drivers, ledgerAgg, expenseAgg] = await Promise.all([
    DriverM.find(driverMatch).populate("userId", "name email").lean(),
    LedgerM.aggregate([
      { $match: rowMatch },
      {
        $group: {
          _id: { driverId: "$driverId", type: "$type" },
          amount: { $sum: "$amount" },
          count: { $sum: 1 },
          last: { $max: "$timestamp" },
        },
      },
    ]),
    ExpenseM.aggregate([
      { $match: rowMatch },
      {
        $group: {
          _id: { driverId: "$driverId", status: "$status" },
          amount: { $sum: "$amount" },
          deductedAmount: { $sum: { $cond: [{ $eq: ["$deductedOnSubmit", true] }, "$amount", 0] } },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  type Bucket = { amount: number; count: number; deductedAmount?: number };
  const ledger = new Map<string, { byType: Record<string, Bucket>; last: Date | null }>();
  for (const r of ledgerAgg) {
    const id = String(r._id.driverId);
    const slot = ledger.get(id) ?? { byType: {}, last: null };
    slot.byType[r._id.type] = { amount: r.amount, count: r.count };
    if (!slot.last || r.last > slot.last) slot.last = r.last;
    ledger.set(id, slot);
  }
  const expenses = new Map<string, Record<string, Bucket>>();
  for (const r of expenseAgg) {
    const id = String(r._id.driverId);
    const slot = expenses.get(id) ?? {};
    slot[r._id.status] = { amount: r.amount, count: r.count, deductedAmount: r.deductedAmount };
    expenses.set(id, slot);
  }

  const rows: AccountRow[] = (drivers as DriverRow[]).map((d) => {
    const id = String(d._id);
    const l = ledger.get(id);
    const e = expenses.get(id) ?? {};
    const sum = (o: Record<string, Bucket> | undefined, k: string) => o?.[k]?.amount ?? 0;
    const figures = buildAccountFigures({
      totalAdvance: sum(l?.byType, "advance"),
      totalApproved: sum(l?.byType, "expense_approved"),
      totalSubmitted: sum(e, "pending") + sum(e, "approved") + sum(e, "rejected"),
      totalPending: sum(e, "pending"),
      totalRejected: sum(e, "rejected"),
      totalPendingDeducted: e.pending?.deductedAmount ?? 0,
    });
    const cachedBalance = round2(d.walletBalance ?? 0);
    return {
      ...figures,
      driverId: id,
      userId: d.userId?._id ? String(d.userId._id) : null,
      name: d.userId?.name ?? "Unknown",
      email: d.userId?.email ?? "",
      status: d.status,
      advanceCount: l?.byType.advance?.count ?? 0,
      submittedCount: (e.pending?.count ?? 0) + (e.approved?.count ?? 0) + (e.rejected?.count ?? 0),
      pendingCount: e.pending?.count ?? 0,
      lastActivityAt: l?.last ? new Date(l.last).toISOString() : null,
      cachedBalance,
      drifted: Math.abs(cachedBalance - figures.balance) > DRIFT_TOLERANCE,
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));

  const totals = rows.reduce<AccountTotals>(
    (t, r) => ({
      driverCount: t.driverCount + 1,
      totalAdvance: t.totalAdvance + r.totalAdvance,
      totalSubmitted: t.totalSubmitted + r.totalSubmitted,
      totalApproved: t.totalApproved + r.totalApproved,
      totalPending: t.totalPending + r.totalPending,
      totalRejected: t.totalRejected + r.totalRejected,
      pendingCount: t.pendingCount + r.pendingCount,
      totalRemaining: t.totalRemaining + r.remainingBalance,
      totalExcess: t.totalExcess + r.excessAmount,
      overdrawnCount: t.overdrawnCount + (r.excessAmount > 0 ? 1 : 0),
      netBalance: t.netBalance + r.balance,
      driftedCount: t.driftedCount + (r.drifted ? 1 : 0),
    }),
    {
      driverCount: 0, totalAdvance: 0, totalSubmitted: 0, totalApproved: 0, totalPending: 0,
      totalRejected: 0, pendingCount: 0, totalRemaining: 0, totalExcess: 0, overdrawnCount: 0,
      netBalance: 0, driftedCount: 0,
    }
  );
  for (const k of Object.keys(totals) as (keyof AccountTotals)[]) {
    if (k.startsWith("total") || k === "netBalance") totals[k] = round2(totals[k]);
  }

  return { drivers: rows, totals };
}

export async function getDriverAccount(driverId: string): Promise<AccountRow | null> {
  const { drivers } = await getAccountSummaries({ driverId });
  return drivers[0] ?? null;
}

export interface PageOpts {
  page?: number;
  limit?: number;
}
function pageOf(opts: PageOpts) {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 25), 1), 100);
  const page = Math.max(Math.trunc(opts.page ?? 1), 1);
  return { limit, page, skip: (page - 1) * limit };
}

export interface LedgerQuery extends PageOpts {
  companyId?: string | null;
  driverId?: string;
  type?: LedgerEntryType;
  from?: Date;
  to?: Date;
}

export async function listLedger(q: LedgerQuery) {
  const { limit, page, skip } = pageOf(q);
  const match: Record<string, unknown> = {};
  if (q.companyId) match.companyId = new mongoose.Types.ObjectId(q.companyId);
  if (q.driverId) match.driverId = new mongoose.Types.ObjectId(q.driverId);
  if (q.type) match.type = q.type;
  if (q.from || q.to) {
    match.timestamp = {
      ...(q.from ? { $gte: q.from } : {}),
      ...(q.to ? { $lte: q.to } : {}),
    };
  }
  const [rows, total] = await Promise.all([
    // _id tiebreak keeps order stable for entries written in the same millisecond.
    LedgerM.find(match).sort({ timestamp: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    LedgerM.countDocuments(match),
  ]);
  return { items: rows.map(toLedgerDTO), total, page, limit };
}

/** Money added to a driver's wallet: advances, and refunds of rejected expenses. */
export async function listWalletCredits(driverId: string, limit = 50): Promise<LedgerEntryDTO[]> {
  const rows = await LedgerM.find({
    driverId: new mongoose.Types.ObjectId(driverId),
    $or: [{ type: "advance" }, { type: "expense_rejected", balanceEffect: { $gt: 0 } }],
  })
    .sort({ timestamp: -1, _id: -1 })
    .limit(Math.min(Math.max(Math.trunc(limit), 1), 200))
    .lean();
  return rows.map(toLedgerDTO);
}

/** One expense, only if it belongs to this driver. */
export async function getDriverExpense(driverId: string, expenseId: string): Promise<ExpenseDTO | null> {
  if (!mongoose.Types.ObjectId.isValid(expenseId)) return null;
  const row = await ExpenseM.findOne({
    _id: new mongoose.Types.ObjectId(expenseId),
    driverId: new mongoose.Types.ObjectId(driverId),
  })
    .select("-photoUrl")
    .populate({ path: "driverId", select: "userId", populate: { path: "userId", select: "name" } })
    .populate("adminApprovalBy", "name")
    .lean();
  return row ? toExpenseDTO(row as ExpenseRow) : null;
}

export interface ExpenseQuery extends PageOpts {
  companyId?: string | null;
  driverId?: string;
  status?: "pending" | "approved" | "rejected";
}

export async function listExpenses(q: ExpenseQuery) {
  const { limit, page, skip } = pageOf(q);
  const match: Record<string, unknown> = {};
  if (q.companyId) match.companyId = new mongoose.Types.ObjectId(q.companyId);
  if (q.driverId) match.driverId = new mongoose.Types.ObjectId(q.driverId);
  if (q.status) match.status = q.status;
  const [rows, total] = await Promise.all([
    ExpenseM.find(match)
      .select("-photoUrl") // receipts can be megabytes each; fetched on demand
      .sort({ timestamp: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: "driverId", select: "userId", populate: { path: "userId", select: "name" } })
      .populate("adminApprovalBy", "name")
      .lean(),
    ExpenseM.countDocuments(match),
  ]);
  return { items: rows.map(toExpenseDTO), total, page, limit };
}

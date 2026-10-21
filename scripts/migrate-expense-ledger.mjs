#!/usr/bin/env node
/**
 * One-off migration: move existing drivers onto the Income & Expense ledger.
 *
 * WHY: before the ledger, the app deducted an expense from the wallet when it
 * was SUBMITTED, deducted it AGAIN when it was approved, and never refunded a
 * rejection. Stored `walletBalance` values are therefore wrong, and there is no
 * ledger history. This script rebuilds each driver's account under the correct
 * rule:  balance = advances - APPROVED expenses.
 *
 * Per driver it:
 *   - turns each legacy wallet top-up ("addition" WalletTransaction) into an
 *     `advance` ledger entry,
 *   - turns each Expense into `expense_submitted` (+ `expense_approved` or
 *     `expense_rejected` for reviewed ones), keeping the original timestamps
 *     and the original approver,
 *   - recomputes `Driver.walletBalance` from those entries,
 *   - sets `walletBalanceAfter` on approved expenses to the corrected balance
 *     and clears the stale submit-time value on pending/rejected ones.
 * Nothing is deleted; legacy WalletTransaction rows are left untouched.
 *
 * It is idempotent: a driver who already has ledger entries is skipped.
 *
 * USAGE (from the web/ directory):
 *   node scripts/migrate-expense-ledger.mjs                 # dry run, prints a report, writes nothing
 *   node scripts/migrate-expense-ledger.mjs --apply         # perform the migration
 *   node scripts/migrate-expense-ledger.mjs --reconcile     # report drivers whose cached balance != ledger
 *   node scripts/migrate-expense-ledger.mjs --reconcile --apply   # ...and repair the cache from the ledger
 * Options:
 *   --uri=<mongodb uri>    override MONGODB_URI (default: from .env.local)
 *   --company=<id>         limit to one company
 *
 * BACK UP THE DATABASE BEFORE USING --apply.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

const APPLY = flag("apply");
const RECONCILE = flag("reconcile");
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const inr = (n) => (n < 0 ? "-" : "") + "₹" + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2 });

dotenv.config({ path: ".env.local" });
const uri = opt("uri") || process.env.MONGODB_URI;
if (!uri) {
  console.error("No MongoDB URI. Pass --uri=... or set MONGODB_URI in .env.local");
  process.exit(1);
}

const conn = await mongoose.createConnection(uri).asPromise();
const db = conn.db;
const C = {
  drivers: db.collection("drivers"),
  users: db.collection("users"),
  expenses: db.collection("expenses"),
  wallet: db.collection("wallettransactions"),
  ledger: db.collection("ledgerentries"),
};

console.log(`\n${RECONCILE ? "RECONCILE" : "MIGRATE"} - ${APPLY ? "APPLYING CHANGES" : "dry run (no writes)"}`);
console.log(`Database: ${db.databaseName}\n`);

const driverFilter = {};
const company = opt("company");
if (company) driverFilter.companyId = new mongoose.Types.ObjectId(company);

// The unique idempotency index must exist before the app starts writing; create it here too.
if (APPLY) {
  await C.ledger.createIndex({ driverId: 1, timestamp: -1 });
  await C.ledger.createIndex({ companyId: 1, timestamp: -1 });
  await C.ledger.createIndex({ expenseId: 1 });
  await C.ledger.createIndex(
    { idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
  );
  await C.expenses.createIndex(
    { driverId: 1, submissionKey: 1 },
    { unique: true, partialFilterExpression: { submissionKey: { $type: "string" } } }
  );
}

const userCache = new Map();
async function userInfo(id) {
  if (!id) return null;
  const key = String(id);
  if (!userCache.has(key)) userCache.set(key, await C.users.findOne({ _id: id }, { projection: { name: 1, role: 1 } }));
  return userCache.get(key);
}

const summary = { drivers: 0, migrated: 0, skipped: 0, entries: 0, warnings: 0, repaired: 0 };

for await (const driver of C.drivers.find(driverFilter)) {
  summary.drivers++;
  const driverUser = await userInfo(driver.userId);
  const name = driverUser?.name ?? String(driver._id);
  const existing = await C.ledger.countDocuments({ driverId: driver._id });

  // ----- reconcile mode: recompute the cache from an existing ledger ---------
  if (RECONCILE) {
    if (existing === 0) continue;
    const [agg] = await C.ledger
      .aggregate([{ $match: { driverId: driver._id } }, { $group: { _id: null, sum: { $sum: "$balanceEffect" } } }])
      .toArray();
    const ledgerBalance = round2(agg?.sum ?? 0);
    const cached = round2(driver.walletBalance ?? 0);
    if (Math.abs(ledgerBalance - cached) > 0.005) {
      console.log(`  DRIFT  ${name}: cached ${inr(cached)} vs ledger ${inr(ledgerBalance)}`);
      summary.warnings++;
      if (APPLY) {
        await C.drivers.updateOne({ _id: driver._id }, { $set: { walletBalance: ledgerBalance } });
        summary.repaired++;
      }
    }
    continue;
  }

  // ----- migrate mode -------------------------------------------------------
  if (existing > 0) {
    summary.skipped++;
    console.log(`  skip   ${name}: already has ${existing} ledger entries`);
    continue;
  }

  const tops = await C.wallet.find({ driverId: driver._id, type: "addition" }).sort({ timestamp: 1 }).toArray();
  const expenses = await C.expenses
    .find({ driverId: driver._id }, { projection: { photoUrl: 0 } })
    .sort({ timestamp: 1 })
    .toArray();

  // Build events, then order them in time. `seq` keeps an expense's own
  // submitted -> approved/rejected order when timestamps tie.
  const events = [];
  let seq = 0;
  for (const t of tops) {
    events.push({
      seq: seq++, at: t.timestamp ?? t.createdAt, type: "advance", amount: round2(t.amount),
      note: t.note || "Imported from legacy wallet top-up", legacy: true,
    });
  }
  for (const e of expenses) {
    const submittedAt = e.timestamp;
    events.push({ seq: seq++, at: submittedAt, type: "expense_submitted", amount: round2(e.amount), expense: e });
    if (e.status === "approved" || e.status === "rejected") {
      // Legacy rows have no review time; updatedAt is the best available, never before submission.
      const reviewed = e.reviewedAt ?? e.updatedAt ?? submittedAt;
      events.push({
        seq: seq++, at: reviewed < submittedAt ? submittedAt : reviewed,
        type: e.status === "approved" ? "expense_approved" : "expense_rejected",
        amount: round2(e.amount), expense: e, reviewerId: e.adminApprovalBy,
        note: e.status === "rejected" ? e.rejectionReason || "Rejected before rejection reasons were recorded" : undefined,
      });
    }
  }
  events.sort((a, b) => new Date(a.at) - new Date(b.at) || a.seq - b.seq);

  let running = 0;
  const docs = [];
  const expenseUpdates = [];
  let advanceCount = 0;
  for (const ev of events) {
    const effect = ev.type === "advance" ? ev.amount : ev.type === "expense_approved" ? -ev.amount : 0;
    running = round2(running + effect);
    const reviewer = ev.reviewerId ? await userInfo(ev.reviewerId) : null;
    const isSubmission = ev.type === "expense_submitted";
    docs.push({
      driverId: driver._id,
      companyId: driver.companyId,
      type: ev.type,
      amount: ev.amount,
      balanceEffect: effect,
      balanceAfter: running,
      expenseId: ev.expense?._id,
      driverName: name,
      performedBy: isSubmission ? driver.userId : ev.reviewerId ?? undefined,
      performedByName: isSubmission ? name : reviewer?.name ?? "Legacy import",
      performedByRole: isSubmission ? "driver" : reviewer?.role ?? "",
      note: ev.note,
      isAdditionalAdvance: ev.type === "advance" ? advanceCount++ > 0 : undefined,
      excessAmount: ev.type === "expense_approved" ? Math.max(0, round2(ev.amount - Math.max(0, running + ev.amount))) : undefined,
      timestamp: new Date(ev.at),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    if (ev.type === "expense_approved") {
      expenseUpdates.push({
        updateOne: {
          filter: { _id: ev.expense._id },
          update: {
            $set: {
              walletBalanceAfter: running,
              reviewedAt: new Date(ev.at),
              excessAmount: Math.max(0, round2(ev.amount - Math.max(0, running + ev.amount))),
            },
          },
        },
      });
    } else if (ev.type === "expense_rejected") {
      expenseUpdates.push({
        updateOne: {
          filter: { _id: ev.expense._id },
          update: { $set: { reviewedAt: new Date(ev.at) }, $unset: { walletBalanceAfter: "" } },
        },
      });
    } else if (isSubmission && ev.expense.status === "pending") {
      // Stale submit-time snapshot from the old deduct-on-submit behaviour.
      expenseUpdates.push({
        updateOne: { filter: { _id: ev.expense._id }, update: { $unset: { walletBalanceAfter: "" } } },
      });
    }
  }

  const sumAdv = round2(tops.reduce((s, t) => s + t.amount, 0));
  const sumAll = round2(expenses.reduce((s, e) => s + e.amount, 0));
  const sumApproved = round2(expenses.filter((e) => e.status === "approved").reduce((s, e) => s + e.amount, 0));
  const oldBalance = round2(driver.walletBalance ?? 0);
  const newBalance = round2(sumAdv - sumApproved);
  // What the buggy code would have left behind if its own rules had been followed.
  const legacyExpected = round2(sumAdv - sumAll - sumApproved);
  const unaccounted = round2(oldBalance - legacyExpected);

  let note = "";
  if (Math.abs(unaccounted) > 0.005) {
    note = `  ⚠ stored balance differs from its own history by ${inr(unaccounted)} (manual edits or pre-ledger data?)`;
    summary.warnings++;
  }
  console.log(
    `  ${APPLY ? "MIGRATE" : "would migrate"} ${name}: ${tops.length} top-ups, ${expenses.length} expenses -> ` +
      `${docs.length} entries, balance ${inr(oldBalance)} -> ${inr(newBalance)}${note}`
  );
  summary.entries += docs.length;
  summary.migrated++;

  if (APPLY) {
    const session = conn.getClient().startSession();
    try {
      await session.withTransaction(async () => {
        // Re-check inside the transaction so a concurrent run cannot double-migrate.
        if ((await C.ledger.countDocuments({ driverId: driver._id }, { session })) > 0) return;
        if (docs.length) await C.ledger.insertMany(docs, { session });
        if (expenseUpdates.length) await C.expenses.bulkWrite(expenseUpdates, { session });
        await C.drivers.updateOne({ _id: driver._id }, { $set: { walletBalance: newBalance } }, { session });
      });
    } finally {
      await session.endSession();
    }
  }
}

console.log("\nSummary");
console.log(`  drivers scanned : ${summary.drivers}`);
if (RECONCILE) {
  console.log(`  drifted         : ${summary.warnings}`);
  console.log(`  repaired        : ${summary.repaired}${APPLY ? "" : "  (dry run - use --apply)"}`);
} else {
  console.log(`  ${APPLY ? "migrated" : "to migrate"}      : ${summary.migrated}`);
  console.log(`  already done    : ${summary.skipped}`);
  console.log(`  ledger entries  : ${summary.entries}`);
  console.log(`  warnings        : ${summary.warnings}`);
  if (!APPLY) console.log("\nDry run only. Back up the database, then re-run with --apply.");
}

await conn.close();

/**
 * Demo data for running the web app locally against a THROWAWAY database.
 *
 *   npm run demo:seed            (see package.json; MONGODB_URI must point at localhost)
 *
 * Everything money- or shift-related goes through the real services (allocateAdvance,
 * submitExpense, reviewExpense, ingestDeviceBatch, sweepOpenShifts), so the demo shows
 * exactly what production would compute. Only `createdAt` is back-dated afterwards so
 * the history spans a few days.
 *
 * Refuses to run against anything but a local MongoDB, and only wipes a database
 * whose name contains "demo".
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const URI = process.env.MONGODB_URI ?? "";
const PASSWORD = "Demo@1234";

function assertLocal(uri: string): URL {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    throw new Error("MONGODB_URI is missing or not a URL.");
  }
  if (u.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(u.hostname)) {
    throw new Error(`Refusing to seed ${u.protocol}//${u.hostname}: demo data only goes into a local MongoDB.`);
  }
  const db = u.pathname.replace(/^\//, "");
  if (!/demo/i.test(db)) throw new Error(`Refusing to wipe database "${db}": its name must contain "demo".`);
  return u;
}

/** Transactions need a replica set; initiate a single-node one if this mongod has not been. */
async function ensureReplicaSet(u: URL) {
  const rs = u.searchParams.get("replicaSet");
  if (!rs) throw new Error("MONGODB_URI needs ?replicaSet=<name> (the ledger uses transactions).");
  const direct = await mongoose.createConnection(`mongodb://${u.host}/admin?directConnection=true`).asPromise();
  try {
    const admin = direct.db!.admin();
    try {
      await admin.command({ replSetGetStatus: 1 });
    } catch (e) {
      if ((e as { code?: number }).code !== 94) throw e;
      console.log(`[seed] initiating replica set ${rs} on ${u.host}`);
      await admin.command({ replSetInitiate: { _id: rs, members: [{ _id: 0, host: u.host }] } });
    }
    for (let i = 0; i < 60; i++) {
      const hello = await admin.command({ hello: 1 });
      if (hello.isWritablePrimary) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Replica set did not elect a primary in time.");
  } finally {
    await direct.close();
  }
}

// --- receipts ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function receipt(merchant: string, lines: [string, number][], when: Date): Promise<string> {
  const total = lines.reduce((s, [, v]) => s + v, 0);
  const rows = lines
    .map(
      ([label, v], i) =>
        `<text x="40" y="${300 + i * 44}" font-size="26">${esc(label)}</text><text x="560" y="${300 + i * 44}" font-size="26" text-anchor="end">${v.toFixed(2)}</text>`
    )
    .join("");
  const y = 300 + lines.length * 44 + 30;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${y + 220}" font-family="Courier New, monospace" fill="#222">
  <rect width="100%" height="100%" fill="#fbfaf5"/>
  <text x="300" y="80" font-size="34" font-weight="bold" text-anchor="middle">${esc(merchant)}</text>
  <text x="300" y="122" font-size="22" text-anchor="middle">GSTIN 29ABCDE1234F1Z5</text>
  <text x="300" y="170" font-size="22" text-anchor="middle">${when.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</text>
  <line x1="40" y1="230" x2="560" y2="230" stroke="#999" stroke-dasharray="8 6"/>
  ${rows}
  <line x1="40" y1="${y - 10}" x2="560" y2="${y - 10}" stroke="#999" stroke-dasharray="8 6"/>
  <text x="40" y="${y + 40}" font-size="32" font-weight="bold">TOTAL Rs</text>
  <text x="560" y="${y + 40}" font-size="32" font-weight="bold" text-anchor="end">${total.toFixed(2)}</text>
  <text x="300" y="${y + 130}" font-size="22" text-anchor="middle">Thank you. Drive safe!</text>
</svg>`;
  try {
    const sharp = (await import("sharp")).default;
    const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    // 1x1 grey PNG if sharp is unavailable; the flow still works, the picture is just blank.
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN89+7dfwAJfgPYKW+vNwAAAABJRU5ErkJggg==";
  }
}

// --- main -------------------------------------------------------------------------------

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

async function main() {
  const u = assertLocal(URI);
  await ensureReplicaSet(u);

  // App modules read MONGODB_URI at import time, so they are loaded after the checks.
  const { default: connectToDatabase } = await import("@/lib/db");
  const { default: Company } = await import("@/models/Company");
  const { default: User } = await import("@/models/User");
  const { default: Driver } = await import("@/models/Driver");
  const { default: EnrollmentCode } = await import("@/models/EnrollmentCode");
  const { default: DeviceEnrollment } = await import("@/models/DeviceEnrollment");
  const { default: Expense } = await import("@/models/Expense");
  const { default: LedgerEntry } = await import("@/models/LedgerEntry");
  const { allocateAdvance, submitExpense, reviewExpense } = await import("@/lib/expenseLedger");
  const { ingestDeviceBatch, sweepOpenShifts } = await import("@/lib/shiftService");
  const { eligibleShiftsAt, windowForStart } = await import("@/lib/shiftConfig");

  await connectToDatabase();
  const db = mongoose.connection.db!;
  console.log(`[seed] wiping ${db.databaseName}`);
  for (const c of await db.listCollections({}, { nameOnly: true }).toArray()) await db.dropCollection(c.name);
  await Promise.all([Expense.init(), LedgerEntry.init(), User.init()]);

  const now = Date.now();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const company = await Company.create({ name: "Sharma Logistics Pvt Ltd" });
  const companyId = company._id;

  const admin = await User.create({ name: "Anita Desai", email: "admin@demo.fleet", passwordHash, role: "admin", companyId });
  const hr = await User.create({ name: "Kavita Rao", email: "hr@demo.fleet", passwordHash, role: "hr", companyId });
  const hrActor = { id: String(hr._id), name: hr.name, role: "hr", companyId: String(companyId) };
  const adminActor = { id: String(admin._id), name: admin.name, role: "admin", companyId: String(companyId) };

  const people = [
    { key: "ravi", name: "Ravi Kumar", emp: "EMP-101", reg: "KA-01-AB-1234" },
    { key: "suresh", name: "Suresh Patel", emp: "EMP-102", reg: "KA-05-MN-4521" },
    { key: "anil", name: "Anil Sharma", emp: "EMP-103", reg: "KA-03-CD-7788" },
    { key: "manoj", name: "Manoj Singh", emp: "EMP-104", reg: "KA-51-EF-3090" },
    { key: "deepak", name: "Deepak Verma", emp: "EMP-105", reg: "KA-02-GH-6612" },
  ] as const;
  type Key = (typeof people)[number]["key"];

  const drivers = {} as Record<Key, { userId: string; driverId: string; name: string; deviceId: string }>;
  for (const p of people) {
    const user = await User.create({
      name: p.name,
      email: `${p.key}@demo.fleet`,
      username: p.key,
      passwordHash,
      role: "driver",
      companyId,
      capabilities: { callMonitoring: false, locationTracking: true, expenseManagement: true, shifts: true },
    });
    const driver = await Driver.create({ userId: user._id, companyId, walletBalance: 0 });
    const deviceId = `demo-device-${p.key}`;
    await EnrollmentCode.create({
      code: `DEMO-${p.emp}`,
      companyId,
      employeeId: p.emp,
      employeeName: p.name,
      role: "driver",
      capabilities: { callMonitoring: false, locationTracking: true, expenseManagement: true, shifts: true },
      vehicle: { id: p.reg, registration: p.reg },
      driverId: driver._id,
      usedAt: new Date(now - 30 * DAY),
      deviceSetupStatus: "installed",
    });
    await DeviceEnrollment.create({
      deviceId,
      employeeId: p.emp,
      employeeName: p.name,
      role: "driver",
      companyId,
      vehicle: { id: p.reg, registration: p.reg },
    });
    drivers[p.key] = { userId: String(user._id), driverId: String(driver._id), name: p.name, deviceId };
  }

  // --- wallet history (oldest first; each step back-dated to when it "happened") ---------

  const raw = { expenses: db.collection("expenses"), ledger: db.collection("ledgerentries") };
  const setTime = async (coll: typeof raw.expenses, filter: object, at: Date, extra: object = {}) =>
    coll.updateMany(filter, { $set: { createdAt: at, updatedAt: at, timestamp: at, ...extra } });

  const ymd = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const hoursAgo = (h: number) => now - h * HOUR;
  const BLR = { lat: 12.9716, lng: 77.5946 };

  async function advance(k: Key, amount: number, at: number, note: string, by = hrActor) {
    const r = await allocateAdvance({ driverId: drivers[k].driverId, amount, note, idempotencyKey: `seed-adv-${k}-${at}`, actor: by });
    await setTime(raw.ledger, { _id: new mongoose.Types.ObjectId(r.entry.id) }, new Date(at));
  }

  async function spend(
    k: Key,
    amount: number,
    category: string,
    description: string,
    at: number,
    merchant: string,
    lines: [string, number][]
  ): Promise<string> {
    const r = await submitExpense({
      userId: drivers[k].userId,
      userName: drivers[k].name,
      amount,
      category,
      description,
      expenseDate: ymd(at),
      photoDataUrl: await receipt(merchant, lines, new Date(at)),
      latitude: BLR.lat + (Math.random() - 0.5) * 0.2,
      longitude: BLR.lng + (Math.random() - 0.5) * 0.2,
      accuracy: 8 + Math.round(Math.random() * 20),
      clientRequestId: `seed-${k}-${at}`,
    });
    const id = new mongoose.Types.ObjectId(r.id);
    await setTime(raw.expenses, { _id: id }, new Date(at));
    await setTime(raw.ledger, { expenseId: id, type: "expense_submitted" }, new Date(at));
    return r.id;
  }

  async function review(expenseId: string, decision: "approve" | "reject", at: number, reason?: string) {
    await reviewExpense({ expenseId, decision, reason, actor: hrActor });
    const id = new mongoose.Types.ObjectId(expenseId);
    await raw.expenses.updateOne({ _id: id }, { $set: { reviewedAt: new Date(at), updatedAt: new Date(at) } });
    await setTime(raw.ledger, { expenseId: id, type: decision === "approve" ? "expense_approved" : "expense_rejected" }, new Date(at));
  }

  // Ravi: the worked example from the spec. 5000 -> 1200 -> 3800 -> 4000 -> -200.
  await advance("ravi", 5000, hoursAgo(76), "Monthly trip advance");
  const r1 = await spend("ravi", 1200, "Fuel", "Diesel fill-up, Indian Oil Hosur Road", hoursAgo(52), "INDIAN OIL - HOSUR RD", [["HSD 13.2 L @ 90.90", 1200]]);
  await review(r1, "approve", hoursAgo(49));
  await spend("ravi", 4000, "Maintenance", "Front tyre replacement after puncture", hoursAgo(20), "SRI BALAJI TYRES", [["Tyre 195/65 R15", 3600], ["Fitting + balancing", 400]]);

  // Suresh: an approval, a rejection (refunded), one pending.
  await advance("suresh", 3000, hoursAgo(74), "Weekly advance");
  const s1 = await spend("suresh", 250, "Toll", "Electronic City toll, both ways", hoursAgo(50), "NHAI TOLL PLAZA - ATTIBELE", [["Toll (car/jeep) x2", 250]]);
  await review(s1, "approve", hoursAgo(46));
  const s2 = await spend("suresh", 180, "Food", "Lunch", hoursAgo(28), "UDUPI GRAND", [["Meals", 140], ["Coffee", 40]]);
  await review(s2, "reject", hoursAgo(24), "Meals are covered by the daily allowance, not the trip wallet.");
  await spend("suresh", 60, "Parking", "", hoursAgo(5), "BBMP PAY & PARK", [["Parking 2 hrs", 60]]);

  // Anil: two pending, close to empty.
  await advance("anil", 2000, hoursAgo(70), "Weekly advance");
  await spend("anil", 1500, "Fuel", "Full tank before Mysuru run", hoursAgo(26), "HP PETROL PUMP - KENGERI", [["HSD 16.5 L @ 90.90", 1500]]);
  await spend("anil", 120, "Toll", "Mysuru expressway toll", hoursAgo(25), "NHAI TOLL - KANIMINIKE", [["Toll (car/jeep)", 120]]);

  // Manoj: a top-up from an admin, an approved repair, a pending fuel bill.
  await advance("manoj", 4000, hoursAgo(80), "Monthly trip advance");
  const m1 = await spend("manoj", 2200, "Maintenance", "Brake pads and labour", hoursAgo(60), "AUTO CARE CENTRE", [["Brake pad set", 1650], ["Labour", 550]]);
  await review(m1, "approve", hoursAgo(55));
  await advance("manoj", 1000, hoursAgo(30), "Top-up for long-haul week", adminActor);
  await spend("manoj", 900, "Fuel", "Diesel, Nelamangala", hoursAgo(3), "BHARAT PETROLEUM - NELAMANGALA", [["HSD 9.9 L @ 90.90", 900]]);

  // Deepak: just an advance, nothing spent yet.
  await advance("deepak", 1500, hoursAgo(10), "Weekly advance");

  // --- shifts ------------------------------------------------------------------------------

  // Events are uploaded on a 5-minute heartbeat clock, with the server-side sweep (the
  // cron) running at the same cadence, so silence and late delivery happen for real.
  type Ev = { at: number; type: string; payload?: Record<string, unknown> };
  interface Script {
    k: Key;
    shiftType: "MORNING" | "EVENING";
    start: number;
    end?: number;
    events: Ev[];
    /** Periods with no upload: [from, to). Buffered events arrive at `to`. */
    offline?: [number, number][];
    /** No uploads at all after this instant. */
    silentFrom?: number;
  }

  const pos = (k: Key, t: number) => {
    const i = people.findIndex((p) => p.key === k);
    const phase = (t / (30 * MIN)) % (2 * Math.PI);
    return {
      lat: +(BLR.lat + i * 0.03 + 0.02 * Math.sin(phase)).toFixed(6),
      lng: +(BLR.lng - 0.05 + i * 0.025 + 0.02 * Math.cos(phase)).toFixed(6),
      accuracy: 6 + (i % 3) * 4,
      recordedAt: t,
    };
  };

  function runShifts(scripts: Script[], from: number, to: number) {
    const sent = new Map<Script, number>();
    const seq = new Map<Script, number>();
    return (async () => {
      for (let t = from; t <= to; t += 5 * MIN) {
        for (const s of scripts) {
          if (t < s.start || (s.end != null && t > s.end + 5 * MIN)) continue;
          if (s.silentFrom != null && t >= s.silentFrom) continue;
          if (s.offline?.some(([a, b]) => t >= a && t < b)) continue;
          const after = sent.get(s) ?? -Infinity;
          const due = s.events.filter((e) => e.at > after && e.at <= t);
          const shiftId = `demo-${s.k}-${ymd(s.start)}-${s.shiftType.toLowerCase()}`;
          const d = drivers[s.k];
          const events = due.map((e) => {
            const n = (seq.get(s) ?? 0) + 1;
            seq.set(s, n);
            return {
              id: `${d.deviceId}:${shiftId}:${n}`,
              shiftId,
              type: e.type,
              occurredAt: e.at,
              payload: { location: pos(s.k, e.at), ...e.payload },
            };
          });
          const open = s.end == null || t <= s.end;
          await ingestDeviceBatch({ deviceId: d.deviceId, events, heartbeat: open ? { shiftId, location: pos(s.k, t) } : undefined }, t);
          sent.set(s, t);
        }
        await sweepOpenShifts(t);
      }
    })();
  }

  // Yesterday: a normal day for Ravi; Manoj's shift was closed by the system after his
  // location permission stayed off for an hour.
  const y = now - DAY;
  const yMorning = windowForStart("MORNING", y).window;
  const yEvening = windowForStart("EVENING", y).window;
  await runShifts(
    [
      {
        k: "ravi",
        shiftType: "MORNING",
        start: yMorning.start + 4 * MIN,
        end: yMorning.end - 6 * MIN,
        events: [
          { at: yMorning.start + 4 * MIN, type: "SHIFT_STARTED", payload: { shiftType: "MORNING" } },
          { at: yMorning.start + 5 * MIN, type: "TRACKING_STARTED" },
          { at: yMorning.end - 6 * MIN, type: "TRACKING_STOPPED", payload: { intentional: true } },
          { at: yMorning.end - 6 * MIN, type: "SHIFT_ENDED", payload: { endReason: "DRIVER_ENDED" } },
        ],
      },
    ],
    yMorning.start,
    yMorning.end
  );
  await runShifts(
    [
      {
        k: "manoj",
        shiftType: "EVENING",
        start: yEvening.start + 2 * MIN,
        events: [
          { at: yEvening.start + 2 * MIN, type: "SHIFT_STARTED", payload: { shiftType: "EVENING" } },
          { at: yEvening.start + 3 * MIN, type: "TRACKING_STARTED" },
          {
            at: yEvening.start + 3 * HOUR + 12 * MIN,
            type: "TRACKING_INTERRUPTED",
            payload: { cause: "GPS_PERMISSION_DENIED", reason: "Location permission for the Fleet app was turned off in Settings." },
          },
        ],
      },
    ],
    yEvening.start,
    yEvening.start + 4 * HOUR + 30 * MIN
  );

  // Today: whichever shift is on now (the demo is most realistic between 06:00 and 22:00 IST).
  const current = eligibleShiftsAt(now).at(-1) ?? windowForStart("EVENING", now).window;
  const type = current.type as "MORNING" | "EVENING";
  const start = Math.min(Math.max(current.start + 3 * MIN, now - 3 * HOUR), now - 70 * MIN);
  const ago = (m: number) => now - m * MIN;
  const startEv = (at: number) => [
    { at, type: "SHIFT_STARTED", payload: { shiftType: type } },
    { at: at + MIN, type: "TRACKING_STARTED" },
  ];

  await runShifts(
    [
      // Ravi: healthy all shift.
      { k: "ravi", shiftType: type, start, events: startEv(start) },
      // Suresh: revoked permission and fixed it; then switched Location off (still off).
      {
        k: "suresh",
        shiftType: type,
        start: start + 4 * MIN,
        events: [
          ...startEv(start + 4 * MIN),
          { at: ago(41), type: "TRACKING_INTERRUPTED", payload: { cause: "GPS_PERMISSION_DENIED", reason: "Location permission for the Fleet app was turned off." } },
          { at: ago(33), type: "TRACKING_RESUMED", payload: { reason: "Location permission granted again." } },
          { at: ago(12), type: "TRACKING_INTERRUPTED", payload: { cause: "LOCATION_SERVICES_OFF", reason: "The phone's Location (GPS) was switched off." } },
        ],
      },
      // Anil: lost internet for a while (events arrive late), now no GPS fix in a basement.
      {
        k: "anil",
        shiftType: type,
        start: start + 7 * MIN,
        offline: [[ago(38), ago(22)]],
        events: [
          ...startEv(start + 7 * MIN),
          { at: ago(37), type: "CONNECTIVITY_LOST" },
          { at: ago(23), type: "CONNECTIVITY_RESTORED" },
          {
            at: ago(9),
            type: "TRACKING_INTERRUPTED",
            payload: { cause: "NO_LOCATION_FIX", reason: "Location is on and allowed, but the phone is not getting a GPS fix.", evidence: "No location fix for 300s." },
          },
        ],
      },
      // Manoj: phone went quiet 25 minutes ago - the server cannot know why.
      { k: "manoj", shiftType: type, start: start + 2 * MIN, silentFrom: ago(25), events: startEv(start + 2 * MIN) },
      // Deepak: phone restarted mid-shift, tracking came back by itself.
      {
        k: "deepak",
        shiftType: type,
        start: start + 10 * MIN,
        offline: [[ago(29), ago(19)]],
        events: [
          ...startEv(start + 10 * MIN),
          { at: ago(19), type: "DEVICE_BOOTED", payload: { lastAliveAt: ago(28) } },
          { at: ago(18), type: "TRACKING_RESUMED", payload: { reason: "Tracking restarted after the phone booted." } },
        ],
      },
    ],
    start,
    now
  );

  console.log(`
[seed] done. Sign in at http://localhost:3000/login (password for every account: ${PASSWORD})

  HR / admin
    hr@demo.fleet       HR (wallets, approvals, shifts, tracking alerts)
    admin@demo.fleet    Admin (everything)

  Drivers (open /driver/dashboard after signing in)
    ravi@demo.fleet     balance -200 (the 5000 / 1200 / 4000 example), tracking healthy
    suresh@demo.fleet   one approved, one rejected+refunded, one pending; Location switched OFF now
    anil@demo.fleet     two pending; was offline earlier, no GPS fix right now
    manoj@demo.fleet    admin top-up; phone not reporting; yesterday's shift auto-ended
    deepak@demo.fleet   fresh advance; phone restarted mid-shift
`);
}

main()
  .then(() => mongoose.disconnect())
  .catch(async (e) => {
    console.error("[seed] failed:", e instanceof Error ? e.message : e);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });

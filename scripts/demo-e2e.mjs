// End-to-end checks against a running dev server on the seeded demo DB (npm run demo:seed).
// Usage: node scripts/demo-e2e.mjs [baseUrl]
// Changes the demo data (adds expenses, an advance, reviews); re-seed to reset.
import assert from "node:assert/strict";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PASSWORD = "Demo@1234";
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${e.message.split("\n").join("\n        ")}`);
  }
}

/** Minimal cookie-keeping client signed in through the real NextAuth credentials flow. */
async function login(email) {
  const jar = new Map();
  const keep = (res) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const req = async (path, init = {}) => {
    const res = await fetch(BASE + path, { ...init, redirect: "manual", headers: { cookie: cookie(), ...(init.headers ?? {}) } });
    keep(res);
    return res;
  };
  const { csrfToken } = await (await req("/api/auth/csrf")).json();
  const res = await req("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, email, password: PASSWORD, json: "true" }),
  });
  if (![...jar.keys()].some((k) => k.includes("session-token"))) throw new Error(`login failed for ${email} (${res.status})`);
  const json = async (path, init) => {
    const r = await req(path, init);
    const body = await r.json().catch(() => null);
    return { status: r.status, body };
  };
  const post = (path, data) => json(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  return { req, json, post };
}

// 1x1 PNG; distinct per test via the clientRequestId, not the image.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN89+7dfwAJfgPYKW+vNwAAAABJRU5ErkJggg==";
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const expense = (amount, id, extra = {}) => ({
  amount,
  category: "Fuel",
  description: "e2e test expense",
  expenseDate: today,
  photoBase64: PNG,
  latitude: 12.97,
  longitude: 77.59,
  accuracy: 10,
  clientRequestId: id,
  ...extra,
});
const rid = () => `e2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

const ravi = await login("ravi@demo.fleet");
const suresh = await login("suresh@demo.fleet");
const hr = await login("hr@demo.fleet");
console.log("signed in: ravi, suresh, hr");

const balance = async () => (await ravi.json("/api/driver/me/summary")).body.walletBalance;
const start = await balance();

console.log("\nDriver wallet");
await check("seeded example: Ravi is at -200 (5000 - 1200 - 4000)", () => assert.equal(start, -200));

let firstId;
await check("submit deducts immediately and may go further negative (201)", async () => {
  const r = await ravi.post("/api/driver/expenses", expense(300, (firstId = rid())));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.balance, start - 300);
  assert.equal(r.body.status, "pending");
  assert.equal(await balance(), start - 300);
  firstId = { req: firstId, id: r.body.id };
});

await check("resending the same request is not deducted again (200, duplicate)", async () => {
  const r = await ravi.post("/api/driver/expenses", expense(300, firstId.req));
  assert.equal(r.status, 200);
  assert.equal(r.body.duplicate, true);
  assert.equal(r.body.id, firstId.id);
  assert.equal(await balance(), start - 300);
});

await check("double tap: 5 concurrent identical submits deduct once", async () => {
  const id = rid();
  const rs = await Promise.all(Array.from({ length: 5 }, () => ravi.post("/api/driver/expenses", expense(50, id))));
  const created = rs.filter((r) => r.status === 201).length;
  assert.equal(created, 1, rs.map((r) => r.status).join(","));
  assert.equal(new Set(rs.map((r) => r.body.id)).size, 1);
  assert.equal(await balance(), start - 350);
});

await check("category and description are optional (stored as Other)", async () => {
  const r = await ravi.post("/api/driver/expenses", expense(10, rid(), { category: null, description: "" }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await balance(), start - 360);
});

await check("an unknown category, missing receipt or bad amount is refused and nothing is deducted", async () => {
  for (const bad of [{ category: "Casino" }, { photoBase64: "" }, { amount: -5 }, { photoBase64: "data:text/html;base64,PGgxPg==" }]) {
    const r = await ravi.post("/api/driver/expenses", expense(20, rid(), bad));
    assert.equal(r.status, 400, `${JSON.stringify(bad)} -> ${r.status}`);
  }
  assert.equal(await balance(), start - 360);
});

await check("a driver cannot use HR endpoints", async () => {
  assert.notEqual((await ravi.json("/api/income-expense/expenses")).status, 200);
  assert.notEqual((await ravi.json("/api/tracking-alerts")).status, 200);
});

console.log("\nReceipts");
await check("owner and HR can view the receipt; another driver and anonymous cannot", async () => {
  const url = `/api/income-expense/expenses/${firstId.id}/receipt`;
  const own = await ravi.req(url);
  assert.equal(own.status, 200);
  assert.match(own.headers.get("content-type"), /^image\//);
  assert.equal(own.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await hr.req(url)).status, 200);
  assert.equal((await suresh.req(url)).status, 404);
  const anon = await fetch(BASE + url, { redirect: "manual" });
  assert.ok([401, 404].includes(anon.status), String(anon.status));
});

console.log("\nHR wallet management");
const accounts = async () => (await hr.json("/api/income-expense/summary")).body;
const raviRow = async () => (await accounts()).drivers.find((d) => d.email === "ravi@demo.fleet");

await check("HR sees Ravi overdrawn with the pending amounts already deducted", async () => {
  const row = await raviRow();
  assert.equal(row.balance, start - 360);
  assert.ok(row.excessAmount > 0);
  assert.equal(row.drifted, false);
});

await check("allocating funds credits the wallet once even if the request is retried", async () => {
  const key = rid();
  const body = { driverId: (await raviRow()).driverId, amount: 1000, note: "e2e top-up", idempotencyKey: key };
  const a = await hr.post("/api/income-expense/advances", body);
  const b = await hr.post("/api/income-expense/advances", body);
  assert.ok([200, 201].includes(a.status), JSON.stringify(a.body));
  assert.ok([200, 201].includes(b.status));
  assert.equal(await balance(), start - 360 + 1000);
});

await check("approving does not change the balance; rejecting refunds it", async () => {
  const before = await balance();
  const ap = await hr.post(`/api/income-expense/expenses/${firstId.id}/review`, { decision: "approve" });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  assert.equal(await balance(), before);

  const pending = (await hr.json("/api/income-expense/expenses?status=pending&limit=100")).body.items.find(
    (e) => e.driverEmail === "ravi@demo.fleet" || e.driver?.email === "ravi@demo.fleet" || e.amount === 50
  );
  assert.ok(pending, "a pending expense to reject");
  const rj = await hr.post(`/api/income-expense/expenses/${pending.id}/review`, { decision: "reject", reason: "e2e: duplicate bill" });
  assert.equal(rj.status, 200, JSON.stringify(rj.body));
  assert.equal(await balance(), before + pending.amount);

  const again = await hr.post(`/api/income-expense/expenses/${pending.id}/review`, { decision: "reject", reason: "again" });
  assert.notEqual(again.status, 200, "a second review must not refund twice");
  assert.equal(await balance(), before + pending.amount);
});

await check("every balance change is in the ledger and the cached balance matches it", async () => {
  const row = await raviRow();
  assert.equal(row.drifted, false);
  assert.equal(row.cachedBalance, row.balance);
  const ledger = (await hr.json(`/api/income-expense/ledger?driverId=${row.driverId}&limit=100`)).body;
  const items = ledger.items ?? ledger.entries ?? [];
  const sum = items.reduce((s, e) => s + e.balanceEffect, 0);
  assert.equal(Math.round(sum * 100) / 100, row.balance);
});

console.log("\nTracking alerts");
await check("HR gets the alert feed with driver, cause, time, last location and status", async () => {
  const r = await hr.json("/api/tracking-alerts");
  assert.equal(r.status, 200);
  const off = r.body.alerts.find((a) => a.title === "Location Services Disabled" && a.ongoing);
  assert.ok(off, "ongoing Location Services Disabled alert");
  assert.equal(off.driver.name, "Suresh Patel");
  assert.equal(off.driver.employeeId, "EMP-102");
  assert.ok(off.lastLocation?.lat && off.lastLocation?.recordedAt);
  assert.equal(off.current.status, "INTERRUPTED");
  assert.ok(r.body.alerts.some((a) => a.title === "Location Updates Interrupted"));
  assert.ok(r.body.alerts.some((a) => a.title === "Device Not Reporting"));
  assert.ok(r.body.alerts.some((a) => a.severity === "recovery"));
  assert.ok(r.body.alerts.some((a) => a.title === "Network Connectivity Lost" && a.severity === "info"));
});

await check("polling with ?since only returns newer alerts", async () => {
  const r = await hr.json(`/api/tracking-alerts?since=${encodeURIComponent(new Date().toISOString())}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.alerts.length, 0);
});

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);

// Dev-only: drives a headless Chrome over the DevTools protocol through the demo
// (real login form, driver and HR pages) and saves screenshots.
// Usage: node scripts/demo-screens.mjs <outDir> [baseUrl]
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "fleet-screens"));
const BASE = process.argv[3] ?? "http://localhost:3000";
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) =>
  fs.existsSync(p)
);
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-cdp-"));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, "--headless=new", `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"], {
  stdio: "ignore",
});

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  wsUrl = await fetch(`http://127.0.0.1:${PORT}/json/version`)
    .then((r) => r.json())
    .then((j) => j.webSocketDebuggerUrl)
    .catch(() => undefined);
}
if (!wsUrl) throw new Error("Chrome did not start");

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 1;
const pending = new Map();
const listeners = new Set();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  } else for (const l of listeners) l(msg);
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

async function newPage({ width, height, mobile }) {
  const { browserContextId } = await send("Target.createBrowserContext");
  const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method, params) => send(method, params, sessionId);
  await s("Page.enable");
  await s("Runtime.enable");
  await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await s("Emulation.setTimezoneOverride", { timezoneId: "Asia/Kolkata" });
  // Location for the add-expense form.
  await send("Browser.grantPermissions", { permissions: ["geolocation", "notifications"], origin: BASE, browserContextId });
  await s("Emulation.setGeolocationOverride", { latitude: 12.9716, longitude: 77.5946, accuracy: 15 });

  const evaluate = async (expression) => {
    const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expression, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await evaluate(expression).catch(() => false)) return;
      await sleep(250);
    }
    throw new Error(`timeout waiting for: ${expression}`);
  };
  const goto = async (p, ready = "document.readyState === 'complete'") => {
    await s("Page.navigate", { url: BASE + p });
    await sleep(300);
    await waitFor(ready, 60000);
    await sleep(1200);
  };
  const shot = async (name, full = true) => {
    const { cssContentSize } = await s("Page.getLayoutMetrics");
    const params = { format: "png", captureBeyondViewport: full };
    if (full) params.clip = { x: 0, y: 0, width: cssContentSize.width, height: Math.min(cssContentSize.height, 4000), scale: 1 };
    const { data } = await s("Page.captureScreenshot", params);
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    console.log("  saved", file);
  };
  const type = (selector, value) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
      set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
  const click = (expr) => evaluate(`(() => { const el = ${expr}; if (!el) throw new Error("not found: ${expr.replace(/"/g, "'")}"); el.click(); return true; })()`);
  const login = async (email) => {
    await goto("/login", "!!document.querySelector('#email')");
    await type("#email", email);
    await type("#password", "Demo@1234");
    await click("document.querySelector('form button[type=submit]')");
    await waitFor("!location.pathname.startsWith('/login')", 30000);
    await sleep(1500);
  };
  return { s, evaluate, waitFor, goto, shot, type, click, login };
}

try {
  console.log("driver (Ravi, phone-sized)");
  const d = await newPage({ width: 412, height: 915, mobile: true });
  await d.login("ravi@demo.fleet");
  await d.goto("/driver/dashboard", "document.body.innerText.includes('Recent')");
  await d.shot("01-driver-dashboard");
  await d.goto("/driver/history", "document.body.innerText.includes('All')");
  await d.shot("02-driver-history");
  const txn = await d.evaluate("[...document.querySelectorAll('a[href^=\"/driver/transactions/\"]')].map(a => a.getAttribute('href'))[0]");
  if (txn) {
    await d.goto(txn);
    await d.shot("03-driver-transaction");
  }
  await d.goto("/driver/add-expense", "!!document.querySelector('input[inputmode=decimal]')");
  await d.type("input[inputmode=decimal]", "450");
  await d.click("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Toll')");
  await sleep(800);
  await d.shot("04-driver-add-expense", false);

  console.log("driver (Suresh): rejected + refunded");
  const d2 = await newPage({ width: 412, height: 915, mobile: true });
  await d2.login("suresh@demo.fleet");
  await d2.goto("/driver/history", "document.body.innerText.includes('All')");
  await d2.shot("05-suresh-history");

  console.log("HR (desktop)");
  const h = await newPage({ width: 1440, height: 900, mobile: false });
  await h.login("hr@demo.fleet");
  await h.goto("/expenses", "document.body.innerText.includes('Ravi Kumar')");
  await h.shot("06-hr-wallets");
  await h.goto("/tracking-alerts", "document.body.innerText.includes('Live tracking status') && document.body.innerText.includes('Suresh Patel')");
  await h.shot("07-hr-tracking-alerts");

  await h.click("document.querySelector('button[aria-label^=\"Tracking alerts\"]')");
  await sleep(800);
  await h.shot("08-hr-alert-bell", false);
  await h.s("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" });

  console.log("live alert: Ravi revokes location permission");
  execFileSync(process.execPath, ["--experimental-transform-types", "--no-warnings", "--import", "./scripts/ts-alias-register.mjs", "scripts/demo-trigger-alert.ts", "ravi", "revoke"], {
    stdio: "inherit",
    env: process.env,
  });
  await h.waitFor("!!document.querySelector('[role=alert]') && document.querySelector('[role=alert]').innerText.includes('Ravi')", 45000);
  await h.shot("09-hr-live-alert-toast", false);
} finally {
  ws.close();
  chrome.kill();
}

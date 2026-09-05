/**
 * End-to-end test harness for the contact intelligence pipeline.
 *
 * Safety:
 *  - Runs against a SEPARATE database (…/fleet_test_harness), never the production
 *    one. The script aborts if it cannot prove the target DB differs from prod.
 *  - globalThis.fetch is intercepted, so not a single real Telegram message is sent.
 *    Every outbound message is captured and asserted on instead.
 *
 * Usage:  npx tsx scripts/test-contact-intelligence.ts
 */

import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// ── Redirect to an isolated test database BEFORE any module reads MONGODB_URI ──
const PROD_URI = process.env.MONGODB_URI;
if (!PROD_URI) throw new Error('MONGODB_URI is not set (expected in .env.local)');

const TEST_DB = 'fleet_test_harness';
function withDatabase(uri: string, dbName: string) {
  const [base, query] = uri.split('?');
  const trimmed = base.replace(/\/[^/]*$/, ''); // drop any existing db path segment
  return `${trimmed}/${dbName}${query ? `?${query}` : ''}`;
}
const TEST_URI = withDatabase(PROD_URI, TEST_DB);

const prodDbName = (PROD_URI.split('?')[0].match(/\/([^/]+)$/)?.[1] ?? 'test') || 'test';
if (prodDbName === TEST_DB) throw new Error('Refusing to run: test DB equals production DB');

process.env.MONGODB_URI = TEST_URI;
process.env.TELEGRAM_BOT_TOKEN = 'TEST-TOKEN-NOT-REAL';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret';
process.env.NEXTAUTH_URL = 'https://example.test';

// ── Intercept every Telegram API call ────────────────────────────────────────
type Sent = { method: string; chatId: string; text: string; buttons: string[] };
const sent: Sent[] = [];
let messageIdSeq = 5000;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === 'string' ? input : input?.url ?? '');
  if (!url.includes('api.telegram.org')) return realFetch(input, init);

  const method = url.split('/').pop() ?? '';
  const body = init?.body ? JSON.parse(init.body) : {};
  const buttons: string[] = (body.reply_markup?.inline_keyboard ?? [])
    .flat()
    .map((b: any) => b.text);

  if (method === 'sendMessage') {
    sent.push({ method, chatId: String(body.chat_id), text: String(body.text ?? ''), buttons });
    return new Response(
      JSON.stringify({ ok: true, result: { message_id: ++messageIdSeq, chat: { id: body.chat_id } } }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }
  // editMessageText / answerCallbackQuery — record but don't count as a new message
  sent.push({ method, chatId: String(body.chat_id ?? ''), text: String(body.text ?? ''), buttons });
  return new Response(JSON.stringify({ ok: true, result: {} }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

/** Messages actually delivered to the employee since the last reset. */
function outbox() {
  return sent.filter((s) => s.method === 'sendMessage');
}
function resetOutbox() {
  sent.length = 0;
}

// ── Assertions ───────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    say(`   ✅ ${label}`);
  } else {
    failed++;
    failures.push(label);
    say(`   ❌ ${label}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`);
  }
}

function section(title: string) {
  say(`\n\x1b[1m${title}\x1b[0m`);
}

// The engine logs every step to stdout; silence it so the report is readable.
const realLog = console.log;
const quiet = !process.argv.includes('--verbose');
function say(...args: unknown[]) {
  realLog(...args);
}
if (quiet) console.log = () => {};

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const mongoose = (await import('mongoose')).default;
  const { runContactIntelligence } = await import('../src/lib/contactIntelligence');
  const IdentifiedContact = (await import('../src/models/IdentifiedContact')).default;
  const UnknownNumberTracker = (await import('../src/models/UnknownNumberTracker')).default;
  const Contact = (await import('../src/models/Contact')).default;
  const EmployeeTelegram = (await import('../src/models/EmployeeTelegram')).default;
  const connectToDatabase = (await import('../src/lib/db')).default;
  const webhook = await import('../src/app/api/telegram/webhook/route');
  const submitName = await import('../src/app/api/telegram/submit-scenario-b-name/route');

  await connectToDatabase();
  const dbName = mongoose.connection.db!.databaseName;
  if (dbName !== TEST_DB) throw new Error(`Refusing to run: connected to "${dbName}", expected "${TEST_DB}"`);
  say(`\n🧪 Test database: "${dbName}"  (production "${prodDbName}" untouched)`);
  say(`📡 Telegram API intercepted — no real messages will be sent\n`);

  // Clean slate
  await Promise.all([
    IdentifiedContact.deleteMany({}),
    UnknownNumberTracker.deleteMany({}),
    Contact.deleteMany({}),
    EmployeeTelegram.deleteMany({}),
  ]);
  await Promise.all([
    IdentifiedContact.syncIndexes(),
    UnknownNumberTracker.syncIndexes(),
    Contact.syncIndexes(),
  ]);

  const EMP = 'Test Employee';
  const CHAT = '999000111';
  const DEVICE = 'testdevice01';

  await EmployeeTelegram.create({
    employeeName: EMP,
    phoneNumber: '9000000000',
    telegramChatId: CHAT,
  });

  /** Every shape the Android app has been seen to report the same number in. */
  const formats = (n: string) => [n, `+91${n}`, `0${n}`, `+91 ${n.slice(0, 5)} ${n.slice(5)}`, `091${n}`];

  const call = (raw: string, name?: string) => runContactIntelligence(raw, name, EMP, DEVICE);

  async function pressButton(callbackData: string, msgId = 4242) {
    const req = new Request('https://example.test/api/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'test-secret' },
      body: JSON.stringify({
        callback_query: {
          id: 'cb1',
          data: callbackData,
          message: { message_id: msgId, chat: { id: Number(CHAT) } },
        },
      }),
    });
    await webhook.POST(req);
  }

  async function replyWithName(replyToMessageId: number, text: string) {
    const req = new Request('https://example.test/api/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'test-secret' },
      body: JSON.stringify({
        message: { chat: { id: Number(CHAT) }, text, reply_to_message: { message_id: replyToMessageId } },
      }),
    });
    await webhook.POST(req);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('TEST 1 — Scenario A: number IS in phone contacts');
  // ═══════════════════════════════════════════════════════════════════════════
  const A = '9111100001';
  await Contact.create({
    deviceId: DEVICE,
    employeeName: EMP,
    contactName: 'Alice Sharma',
    phoneNumber: `+91${A}`,
    phoneKey: A,
    timestamp: new Date(),
  });

  resetOutbox();
  await call(A, 'Alice Sharma');
  check('1st call sends exactly one message', outbox().length, 1);
  check('…and it is the category prompt', outbox()[0]?.text.includes('Scenario A — Please classify'), true);
  check('…with the 5 category buttons', outbox()[0]?.buttons.length, 5);

  resetOutbox();
  for (const f of formats(A)) await call(f, 'Alice Sharma');
  check('4 repeat calls in every number format send NOTHING', outbox().length, 0);
  check('…and still only ONE database record exists', await IdentifiedContact.countDocuments({ phoneKey: A }), 1);

  // ═══════════════════════════════════════════════════════════════════════════
  section('TEST 2 — Employee answers, then the number goes terminal');
  // ═══════════════════════════════════════════════════════════════════════════
  resetOutbox();
  await pressButton(`cat:${encodeURIComponent(`+91${A}`)}:${encodeURIComponent(EMP)}:${encodeURIComponent('Existing Client')}`);
  check('tapping a category sends the "saved in phone?" prompt', outbox().length, 1);
  check('…asking to confirm it is saved', outbox()[0]?.text.includes("saved this contact in your phone"), true);
  const afterCat = await IdentifiedContact.findOne({ phoneKey: A });
  check('…category stored', afterCat?.category, 'Existing Client');
  check('…name preserved (not wiped by the callback upsert)', afterCat?.contactName, 'Alice Sharma');

  resetOutbox();
  await pressButton(`cat:${encodeURIComponent(A)}:${encodeURIComponent(EMP)}:${encodeURIComponent('personal')}`);
  check('tapping a category a SECOND time sends nothing', outbox().length, 0);
  check('…and does not overwrite the first answer', (await IdentifiedContact.findOne({ phoneKey: A }))?.category, 'Existing Client');

  resetOutbox();
  await pressButton(`saved:${encodeURIComponent(`0${A}`)}:${encodeURIComponent(EMP)}`);
  const done = await IdentifiedContact.findOne({ phoneKey: A });
  check('"Saved" (sent with a DIFFERENT number format) marks it saved', done?.savedInPhone, true);
  check('…and stamps completedAt', !!done?.completedAt, true);

  resetOutbox();
  for (let i = 0; i < 3; i++) for (const f of formats(A)) await call(f, 'Alice Sharma');
  check('15 further calls across all formats send NOTHING (terminal)', outbox().length, 0);

  // ═══════════════════════════════════════════════════════════════════════════
  section('TEST 3 — Scenario B: number is NOT in phone contacts');
  // ═══════════════════════════════════════════════════════════════════════════
  const B = '9222200002';
  resetOutbox();
  for (let i = 1; i <= 4; i++) await call(B);
  check('calls 1-4 stay silent (below the 5-call threshold)', outbox().length, 0);
  check('…but are being counted', (await UnknownNumberTracker.findOne({ phoneKey: B }))?.callCount, 4);

  resetOutbox();
  await call(`+91${B}`); // 5th call, different format
  check('the 5th call fires exactly one name request', outbox().length, 1);
  check('…and it is the Scenario B prompt', outbox()[0]?.text.includes('Scenario B — Contact Identification Needed'), true);
  check('…with the "Enter name" web-app button', outbox()[0]?.buttons, ['✏️ Enter name']);

  resetOutbox();
  for (const f of formats(B)) await call(f);
  check('calls 6-10 in mixed formats send NOTHING', outbox().length, 0);
  check('…and all counted on ONE tracker', await UnknownNumberTracker.countDocuments({ phoneKey: B }), 1);
  check('…with the calls accumulated', (await UnknownNumberTracker.findOne({ phoneKey: B }))?.callCount, 10);

  // ═══════════════════════════════════════════════════════════════════════════
  section('TEST 4 — Scenario B: name via the web-app form');
  // ═══════════════════════════════════════════════════════════════════════════
  resetOutbox();
  const submitReq = (num: string) =>
    new Request('https://example.test/api/telegram/submit-scenario-b-name', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contactName: 'Bob Kumar', phoneNumber: num, employeeName: EMP, chatId: CHAT }),
    });

  await submitName.POST(submitReq(`0${B}`)); // deliberately a different format
  check('submitting the name sends the category keyboard', outbox().length, 1);
  check('…showing the name that was entered', outbox()[0]?.text.includes('Bob Kumar'), true);
  check('…tracker moved to awaiting_category', (await UnknownNumberTracker.findOne({ phoneKey: B }))?.status, 'awaiting_category');

  resetOutbox();
  const dup = await submitName.POST(submitReq(B));
  check('submitting the SAME name twice sends nothing (idempotent)', outbox().length, 0);
  check('…and reports it was already submitted', (await dup.json()).alreadySubmitted, true);

  resetOutbox();
  await call(`+91${B}`);
  check('a new call while awaiting category does NOT re-prompt', outbox().length, 0);

  resetOutbox();
  await pressButton(`cat:${encodeURIComponent(B)}:${encodeURIComponent(EMP)}:${encodeURIComponent('New Client')}`);
  check('choosing the category sends the save prompt', outbox().length, 1);
  await pressButton(`saved:${encodeURIComponent(B)}:${encodeURIComponent(EMP)}`);

  resetOutbox();
  for (let i = 0; i < 3; i++) for (const f of formats(B)) await call(f);
  check('15 further calls send NOTHING (terminal)', outbox().length, 0);
  const bRec = await IdentifiedContact.findOne({ phoneKey: B });
  check('…final record is complete', { name: bRec?.contactName, cat: bRec?.category, saved: bRec?.savedInPhone }, { name: 'Bob Kumar', cat: 'New Client', saved: true });

  // ═══════════════════════════════════════════════════════════════════════════
  section('TEST 5 — Scenario B: name given by REPLYING to the bot');
  // ═══════════════════════════════════════════════════════════════════════════
  const C = '9333300003';
  resetOutbox();
  for (let i = 0; i < 5; i++) await call(C);
  const nameMsgId = messageIdSeq; // id of the name-request we just sent
  check('threshold reached, one name request sent', outbox().length, 1);

  resetOutbox();
  await replyWithName(nameMsgId, 'Chetan Patel');
  check('replying with a name sends the category keyboard', outbox().length, 1);
  check('…name stored', (await IdentifiedContact.findOne({ phoneKey: C }))?.contactName, 'Chetan Patel');
  check('…tracker moved on', (await UnknownNumberTracker.findOne({ phoneKey: C }))?.status, 'awaiting_category');

  // ═══════════════════════════════════════════════════════════════════════════
  section('TEST 6 — Concurrency: simultaneous calls must not double-send');
  // ═══════════════════════════════════════════════════════════════════════════
  const D = '9444400004';
  await UnknownNumberTracker.create({
    phoneNumber: D, employeeName: EMP, phoneKey: D, employeeKey: EMP.toLowerCase(),
    deviceId: DEVICE, callCount: 4, firstSeen: new Date(), lastSeen: new Date(),
    status: 'tracking', namePromptCount: 0,
  });

  resetOutbox();
  await Promise.all(formats(D).map((f) => call(f))); // 5 calls land at the same instant
  check('5 simultaneous calls crossing the threshold send exactly ONE prompt', outbox().length, 1);

  // Scenario A under the same race: /api/calls and the 10s AutoProcessor can both
  // reach the same brand-new contact at once.
  const D2 = '9444400042';
  await Contact.create({
    deviceId: DEVICE, employeeName: EMP, contactName: 'Gita Nair',
    phoneNumber: `+91${D2}`, phoneKey: D2, timestamp: new Date(),
  });
  resetOutbox();
  await Promise.all(formats(D2).map((f) => call(f, 'Gita Nair')));
  check('5 simultaneous Scenario A calls send exactly ONE category prompt', outbox().length, 1);
  check('…and create exactly ONE record', await IdentifiedContact.countDocuments({ phoneKey: D2 }), 1);

  // The upsert race: simultaneous FIRST-ever calls for an unknown number. Three, so
  // the run stays below the 5-call threshold and isolates the upsert from the prompt.
  const D3 = '9444400043';
  resetOutbox();
  await Promise.all(formats(D3).slice(0, 3).map((f) => call(f)));
  check('3 simultaneous first-ever calls create exactly ONE tracker', await UnknownNumberTracker.countDocuments({ phoneKey: D3 }), 1);
  check('…counting all 3 calls on it', (await UnknownNumberTracker.findOne({ phoneKey: D3 }))?.callCount, 3);
  check('…and staying silent (below threshold)', outbox().length, 0);

  // ═══════════════════════════════════════════════════════════════════════════
  section('TEST 7 — Regression: the exact bug that was reported');
  // ═══════════════════════════════════════════════════════════════════════════
  // A contact already classified and saved, stored under ONE format — then the
  // device reports the same number in every other format. Before the fix each
  // format created its own record and started a fresh round of prompts.
  const E = '9555500005';
  await IdentifiedContact.create({
    phoneNumber: `+91${E}`, employeeName: EMP, phoneKey: E, employeeKey: EMP.toLowerCase(),
    deviceId: DEVICE, contactName: 'Dev Shah', category: 'staff',
    savedInPhone: true, remindLater: false, completedAt: new Date(),
  });

  resetOutbox();
  for (let i = 0; i < 4; i++) for (const f of formats(E)) await call(f, 'Dev Shah');
  check('20 calls across 5 formats on a completed contact send NOTHING', outbox().length, 0);
  check('…and no duplicate record was created', await IdentifiedContact.countDocuments({ phoneKey: E }), 1);

  // Employee-name casing/spacing drift must not fork the record either.
  resetOutbox();
  await runContactIntelligence(`0${E}`, 'Dev Shah', '  TEST   employee ', DEVICE);
  check('a call under a differently-cased employee name sends NOTHING', outbox().length, 0);
  check('…and still resolves to the same single record', await IdentifiedContact.countDocuments({ phoneKey: E }), 1);

  // ═══════════════════════════════════════════════════════════════════════════
  section('TEST 8 — Save reminders are capped, not endless');
  // ═══════════════════════════════════════════════════════════════════════════
  const F = '9666600006';
  await IdentifiedContact.create({
    phoneNumber: F, employeeName: EMP, phoneKey: F, employeeKey: EMP.toLowerCase(),
    deviceId: DEVICE, contactName: 'Esha Rao', category: 'courier',
    savedInPhone: false, remindLater: false, telegramChatId: CHAT,
  });

  resetOutbox();
  await call(F, 'Esha Rao');
  check('classified-but-unsaved contact gets a reminder', outbox().length, 1);

  resetOutbox();
  await call(F, 'Esha Rao');
  check('…but not a second one within the 24h cooldown', outbox().length, 0);

  // Force past the cooldown repeatedly and confirm the cap holds.
  resetOutbox();
  for (let i = 0; i < 10; i++) {
    await IdentifiedContact.updateOne({ phoneKey: F }, { $set: { lastReminderSentAt: new Date(Date.now() - 48 * 3600 * 1000) } });
    await call(F, 'Esha Rao');
  }
  check('reminders stop at the cap even after 10 more days of calls', outbox().length, 4);
  check('…total reminders sent = MAX_SAVE_PROMPTS (5)', (await IdentifiedContact.findOne({ phoneKey: F }))?.savePromptCount, 5);

  // ═══════════════════════════════════════════════════════════════════════════
  section('TEST 9 — Withheld caller ID ("UNKNOWN") is ignored');
  // ═══════════════════════════════════════════════════════════════════════════
  resetOutbox();
  for (let i = 0; i < 10; i++) await call('UNKNOWN');
  check('10 calls from a withheld number send NOTHING', outbox().length, 0);
  check('…and create no tracker', await UnknownNumberTracker.countDocuments({ phoneNumber: 'UNKNOWN' }), 0);

  resetOutbox();
  for (let i = 0; i < 10; i++) await call('112');
  check('10 calls to the emergency short code send NOTHING', outbox().length, 0);

  // ═══════════════════════════════════════════════════════════════════════════
  section('TEST 10 — A number saved in the phone later is closed out silently');
  // ═══════════════════════════════════════════════════════════════════════════
  const G = '9777700007';
  await IdentifiedContact.create({
    phoneNumber: G, employeeName: EMP, phoneKey: G, employeeKey: EMP.toLowerCase(),
    deviceId: DEVICE, contactName: 'Farah Khan', category: 'staff',
    savedInPhone: false, remindLater: false, telegramChatId: CHAT,
  });
  // The employee saves the contact; the next contact sync brings it in.
  await Contact.create({
    deviceId: DEVICE, employeeName: EMP, contactName: 'Farah Khan',
    phoneNumber: `+91${G}`, phoneKey: G, timestamp: new Date(),
  });

  resetOutbox();
  await call(G, 'Farah Khan');
  check('no reminder once the number appears in phone contacts', outbox().length, 0);
  check('…it is auto-marked as saved', (await IdentifiedContact.findOne({ phoneKey: G }))?.savedInPhone, true);

  // ── Summary ────────────────────────────────────────────────────────────────
  say(`\n${'─'.repeat(64)}`);
  say(`\x1b[1mRESULT: ${passed} passed, ${failed} failed\x1b[0m`);
  if (failed) console.log(`\nFailed checks:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  say(`${'─'.repeat(64)}\n`);

  // Leave the test database clean.
  await mongoose.connection.db!.dropDatabase();
  say(`🧹 Dropped test database "${dbName}"\n`);
  await mongoose.disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\n💥 Harness crashed:', err);
  process.exit(1);
});

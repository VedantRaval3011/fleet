/**
 * Migration: canonical (phoneKey, employeeKey) identity for contact intelligence.
 *
 * The pipeline used to key IdentifiedContact / UnknownNumberTracker on the raw
 * phoneNumber string the Android app sent. The same contact arrives as
 * "9313450501", "+919313450501" and "09313450501", so each format produced its own
 * record — and its own round of Telegram prompts for a contact the employee had
 * already named and classified.
 *
 * This script:
 *   1. Backfills phoneKey/phoneKey+employeeKey on all three collections
 *   2. Merges duplicate records that differ only in number formatting or name casing
 *   3. Marks contacts that are already present in the employee's phone as savedInPhone
 *      (terminal state — the bot stops asking about them)
 *   4. Initialises the prompt counters
 *   5. Replaces the old unique index with the canonical one
 *
 * Usage:
 *   npx tsx scripts/migrate-contact-keys.ts             # dry run, changes nothing
 *   npx tsx scripts/migrate-contact-keys.ts --apply     # write changes
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');

const phoneKey = (raw: unknown): string => {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
};
const employeeKey = (raw: unknown): string =>
  String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const STATUS_RANK: Record<string, number> = {
  tracking: 0,
  awaiting_name: 1,
  awaiting_category: 2,
  identified: 3,
};

function newest(a: any, b: any) {
  const ta = new Date(a?.updatedAt ?? a?.createdAt ?? 0).getTime();
  const tb = new Date(b?.updatedAt ?? b?.createdAt ?? 0).getTime();
  return tb - ta;
}

function minDate(...ds: any[]) {
  const t = ds.filter(Boolean).map((d) => new Date(d).getTime());
  return t.length ? new Date(Math.min(...t)) : undefined;
}
function maxDate(...ds: any[]) {
  const t = ds.filter(Boolean).map((d) => new Date(d).getTime());
  return t.length ? new Date(Math.max(...t)) : undefined;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set (expected in .env.local)');

  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  console.log(`\n${APPLY ? '🔧 APPLYING CHANGES' : '🔍 DRY RUN — no writes'}\n`);

  const identified = db.collection('identifiedcontacts');
  const trackers = db.collection('unknownnumbertrackers');
  const contacts = db.collection('contacts');

  // ── 1. Contacts: backfill phoneKey ───────────────────────────────────────
  {
    const all = await contacts.find({}, { projection: { phoneNumber: 1, phoneKey: 1 } }).toArray();
    const ops = all
      .filter((c) => c.phoneKey !== phoneKey(c.phoneNumber))
      .map((c) => ({
        updateOne: { filter: { _id: c._id }, update: { $set: { phoneKey: phoneKey(c.phoneNumber) } } },
      }));
    console.log(`[contacts] ${all.length} rows, ${ops.length} need a phoneKey`);
    if (APPLY && ops.length) {
      for (let i = 0; i < ops.length; i += 1000) await contacts.bulkWrite(ops.slice(i, i + 1000));
      console.log(`[contacts] ✅ backfilled`);
    }
  }

  // Employee -> set of phoneKeys saved in that employee's phone. Used to close out
  // contacts the employee demonstrably already has saved.
  const savedByEmployee = new Map<string, Set<string>>();
  for (const c of await contacts.find({}, { projection: { phoneNumber: 1, employeeName: 1, contactName: 1 } }).toArray()) {
    if (!c.contactName || c.contactName === 'Unknown') continue;
    const ek = employeeKey(c.employeeName);
    if (!savedByEmployee.has(ek)) savedByEmployee.set(ek, new Set());
    savedByEmployee.get(ek)!.add(phoneKey(c.phoneNumber));
  }

  // ── 2. IdentifiedContact: merge duplicates + backfill ─────────────────────
  {
    const all = await identified.find({}).toArray();
    const groups = new Map<string, any[]>();
    for (const d of all) {
      const k = `${phoneKey(d.phoneNumber)}|${employeeKey(d.employeeName)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(d);
    }

    let merged = 0;
    let deleted = 0;
    let closedOut = 0;
    const ops: any[] = [];

    for (const [k, docs] of groups) {
      const [pk, ek] = k.split('|');

      // Winner = the most complete record; ties broken by recency.
      const ranked = [...docs].sort((a, b) => {
        const score = (d: any) => (d.contactName ? 2 : 0) + (d.category ? 1 : 0);
        return score(b) - score(a) || newest(a, b);
      });
      const winner = ranked[0];
      const losers = ranked.slice(1);

      // Union the useful fields so a merge never loses a name or a category.
      const contactName = ranked.find((d) => d.contactName)?.contactName;
      const category = ranked.find((d) => d.category)?.category;
      const telegramChatId = ranked.find((d) => d.telegramChatId)?.telegramChatId;
      const deviceId = ranked.find((d) => d.deviceId)?.deviceId ?? '';
      const savedInPhone =
        docs.some((d) => d.savedInPhone === true) || (savedByEmployee.get(ek)?.has(pk) ?? false);
      const alreadySaved = docs.some((d) => d.savedInPhone === true);
      if (savedInPhone && !alreadySaved) closedOut++;

      const set: any = {
        phoneKey: pk,
        employeeKey: ek,
        phoneNumber: winner.phoneNumber,
        employeeName: winner.employeeName,
        deviceId,
        savedInPhone,
        remindLater: docs.some((d) => d.remindLater === true) && !savedInPhone,
        categoryPromptCount: Math.max(0, ...docs.map((d) => d.categoryPromptCount ?? (d.categoryRequestSentAt ? 1 : 0))),
        savePromptCount: Math.max(0, ...docs.map((d) => d.savePromptCount ?? (d.lastReminderSentAt ? 1 : 0))),
      };
      if (contactName) set.contactName = contactName;
      if (category) set.category = category;
      if (telegramChatId) set.telegramChatId = telegramChatId;

      const catSent = minDate(...docs.map((d) => d.categoryRequestSentAt));
      if (catSent) set.categoryRequestSentAt = catSent;
      const lastRem = maxDate(...docs.map((d) => d.lastReminderSentAt));
      if (lastRem) set.lastReminderSentAt = lastRem;
      const idAt = minDate(...docs.map((d) => d.identifiedAt));
      if (idAt) set.identifiedAt = idAt;
      if (savedInPhone && contactName && category) {
        set.completedAt = maxDate(...docs.map((d) => d.completedAt), new Date());
      }

      ops.push({ updateOne: { filter: { _id: winner._id }, update: { $set: set } } });
      if (losers.length) {
        merged++;
        deleted += losers.length;
        ops.push({ deleteMany: { filter: { _id: { $in: losers.map((d) => d._id) } } } });
      }
    }

    console.log(
      `[identifiedcontacts] ${all.length} rows -> ${groups.size} canonical; ` +
        `${merged} groups merged, ${deleted} duplicate rows removed, ` +
        `${closedOut} newly marked savedInPhone (already in the employee's phone)`
    );
    if (APPLY) {
      for (let i = 0; i < ops.length; i += 500) await identified.bulkWrite(ops.slice(i, i + 500));
      console.log(`[identifiedcontacts] ✅ written`);
    }
  }

  // ── 3. UnknownNumberTracker: merge duplicates + backfill ──────────────────
  {
    const all = await trackers.find({}).toArray();
    const groups = new Map<string, any[]>();
    for (const d of all) {
      const k = `${phoneKey(d.phoneNumber)}|${employeeKey(d.employeeName)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(d);
    }

    let merged = 0;
    let deleted = 0;
    const ops: any[] = [];

    for (const [k, docs] of groups) {
      const [pk, ek] = k.split('|');

      // Furthest-along status wins; ties broken by recency.
      const ranked = [...docs].sort(
        (a, b) => (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0) || newest(a, b)
      );
      const winner = ranked[0];
      const losers = ranked.slice(1);

      const withMessage = ranked.find((d) => d.telegramMessageId != null);
      const set: any = {
        phoneKey: pk,
        employeeKey: ek,
        phoneNumber: winner.phoneNumber,
        employeeName: winner.employeeName,
        deviceId: ranked.find((d) => d.deviceId)?.deviceId ?? '',
        // The duplicates were counting the same real calls in parallel; summing keeps
        // the number at or above the threshold it had already reached.
        callCount: docs.reduce((n, d) => n + (d.callCount ?? 0), 0),
        status: winner.status ?? 'tracking',
        firstSeen: minDate(...docs.map((d) => d.firstSeen)) ?? new Date(),
        lastSeen: maxDate(...docs.map((d) => d.lastSeen)) ?? new Date(),
        namePromptCount: Math.max(0, ...docs.map((d) => d.namePromptCount ?? (d.nameRequestSentAt ? 1 : 0))),
      };
      if (withMessage?.telegramMessageId != null) set.telegramMessageId = withMessage.telegramMessageId;
      const nameSent = maxDate(...docs.map((d) => d.nameRequestSentAt));
      if (nameSent) set.nameRequestSentAt = nameSent;

      ops.push({ updateOne: { filter: { _id: winner._id }, update: { $set: set } } });
      if (losers.length) {
        merged++;
        deleted += losers.length;
        ops.push({ deleteMany: { filter: { _id: { $in: losers.map((d) => d._id) } } } });
      }
    }

    console.log(
      `[unknownnumbertrackers] ${all.length} rows -> ${groups.size} canonical; ` +
        `${merged} groups merged, ${deleted} duplicate rows removed`
    );
    if (APPLY) {
      for (let i = 0; i < ops.length; i += 500) await trackers.bulkWrite(ops.slice(i, i + 500));
      console.log(`[unknownnumbertrackers] ✅ written`);
    }
  }

  // ── 4. Indexes ────────────────────────────────────────────────────────────
  const indexPlan: Array<[string, any, any, any]> = [
    ['identifiedcontacts', identified, { phoneNumber: 1, employeeName: 1 }, { phoneKey: 1, employeeKey: 1 }],
    ['unknownnumbertrackers', trackers, { phoneNumber: 1, employeeName: 1 }, { phoneKey: 1, employeeKey: 1 }],
  ];

  for (const [name, coll, oldKey, newKey] of indexPlan) {
    const existing = await coll.indexes();
    const oldIdx = existing.find(
      (i: any) => JSON.stringify(i.key) === JSON.stringify(oldKey) && i.unique
    );
    const hasNew = existing.some((i: any) => JSON.stringify(i.key) === JSON.stringify(newKey));
    console.log(
      `[${name}] index: drop unique ${JSON.stringify(oldKey)} = ${!!oldIdx}, ` +
        `create unique ${JSON.stringify(newKey)} = ${!hasNew}`
    );
    if (APPLY) {
      if (oldIdx) await coll.dropIndex(oldIdx.name);
      if (!hasNew) await coll.createIndex(newKey, { unique: true });
      await coll.createIndex({ phoneKey: 1 });
      await coll.createIndex({ employeeKey: 1 });
      console.log(`[${name}] ✅ indexes updated`);
    }
  }

  if (APPLY) {
    await contacts.createIndex({ phoneKey: 1 });
    await contacts.createIndex({ phoneKey: 1, employeeName: 1 });
    console.log(`[contacts] ✅ indexes updated`);
  }

  console.log(
    `\n${APPLY ? '✅ Migration complete.' : 'ℹ️  Dry run finished — re-run with --apply to write.'}\n`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

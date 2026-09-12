/**
 * Contact Intelligence Engine
 * Called after every call log is saved from the Android app.
 *
 * Identity: every record is keyed on (phoneKey, employeeKey) — see @/lib/contactKey.
 * Never query these collections by the raw phoneNumber the device sent; the same
 * contact arrives as "9313450501", "+919313450501" and "09313450501", and keying on
 * the raw string is what caused a classified contact to be prompted a second time.
 *
 * Decision tree:
 * 1. Terminal check — classified AND saved in phone → never message again
 * 2. Already classified (name + category) → at most a capped save-in-phone reminder
 * 3. Number is in the employee's phone contacts (Scenario A) → ask for category once
 * 4. Number is unknown (Scenario B) → count calls; at the threshold ask for a name,
 *    then a category. Each prompt is claimed atomically, so concurrent calls, retries
 *    and duplicate call logs cannot produce a second message.
 */

import connectToDatabase from '@/lib/db';
import Contact from '@/models/Contact';
import IdentifiedContact from '@/models/IdentifiedContact';
import UnknownNumberTracker from '@/models/UnknownNumberTracker';
import EmployeeTelegram from '@/models/EmployeeTelegram';
import BotLog from '@/models/BotLog';
import { phoneKey, employeeKey, displayPhone, isUsablePhone } from '@/lib/contactKey';
import {
  sendInlineKeyboard,
  categoryKeyboard,
  saveContactKeyboard,
  nameRequestKeyboard,
} from '@/lib/telegram';

const CALL_THRESHOLD = 5;
/** Cooldown between "save contact in phone" reminders for the same contact. */
const CATEGORY_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** Hard caps — after this many unanswered prompts we stop asking about a contact. */
export const MAX_CATEGORY_PROMPTS = 4;
export const MAX_NAME_PROMPTS = 4;
export const MAX_SAVE_PROMPTS = 5;

type ContactRecordKey = { phoneKey: string; employeeKey: string };

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function log(
  level: 'info' | 'warn' | 'error' | 'success',
  step: string,
  message: string,
  data?: Record<string, any>,
  employeeName?: string,
  phoneNumber?: string
) {
  try {
    console.log(`[BotLog][${level.toUpperCase()}][${step}] ${message}`, data ?? '');
    await BotLog.create({ level, step, message, data: data ?? null, employeeName, phoneNumber });
  } catch {
    // Never let logging break the pipeline
  }
}

export async function runContactIntelligence(
  rawPhoneNumber: string,
  contactName: string | undefined,
  rawEmployeeName: string,
  deviceId: string
) {
  const pKey = phoneKey(rawPhoneNumber);
  const eKey = employeeKey(rawEmployeeName);
  const employeeName = String(rawEmployeeName ?? '').trim();
  const phoneNumber = displayPhone(rawPhoneNumber);

  try {
    await connectToDatabase();

    await log(
      'info',
      'START',
      `Intelligence triggered`,
      { rawPhoneNumber, phoneNumber, pKey, contactName, employeeName, deviceId },
      employeeName,
      phoneNumber
    );

    if (!isUsablePhone(rawPhoneNumber) || !eKey) {
      await log('warn', 'SKIP_UNUSABLE', `Skipping — unusable phone ("${rawPhoneNumber}") or employee ("${rawEmployeeName}")`, undefined, employeeName, phoneNumber);
      return;
    }

    const key: ContactRecordKey = { phoneKey: pKey, employeeKey: eKey };

    // ── Fetch the employee's Telegram chat ID (case-insensitive match) ───────
    const empTelegram = await EmployeeTelegram.findOne({
      employeeName: new RegExp(`^${escapeRegex(employeeName)}$`, 'i'),
    }).lean() as any;
    const chatId: string | null = empTelegram?.telegramChatId ?? null;

    await log(
      empTelegram ? (chatId ? 'success' : 'warn') : 'error',
      'LOOKUP_EMPLOYEE',
      empTelegram
        ? chatId
          ? `Employee "${employeeName}" found with chatId ${chatId}`
          : `Employee "${employeeName}" found in DB but Telegram NOT linked yet (no chatId) — employee must open bot and send /start + phone number`
        : `Employee "${employeeName}" NOT in EmployeeTelegram table — admin must add their phone number in Telegram Setup page first`,
      { empTelegramRecord: empTelegram ?? null },
      employeeName,
      phoneNumber
    );

    const identified = await IdentifiedContact.findOne(key);

    // ── 1. Terminal state — fully done, never message about this contact again ──
    if (identified?.contactName && identified?.category && identified.savedInPhone) {
      await log('info', 'SKIP_TERMINAL', `Contact complete — "${identified.contactName}" / "${identified.category}" / saved in phone. No further messages.`, undefined, employeeName, phoneNumber);
      return;
    }

    // ── 2. Already classified — only a capped save-in-phone reminder remains ──
    if (identified?.contactName && identified?.category) {
      await log('info', 'SKIP_FULLY_DONE', `Contact already fully classified — name: "${identified.contactName}", category: "${identified.category}"`, undefined, employeeName, phoneNumber);

      // If the number has since been saved in the phone, close it out silently.
      if (await isSavedInPhoneContacts(pKey, employeeName, deviceId)) {
        await markSavedInPhone(key);
        await log('success', 'AUTO_SAVED_DETECTED', `Number now present in phone contacts — marked savedInPhone, closing contact out`, undefined, employeeName, phoneNumber);
        return;
      }

      if ((identified.savePromptCount ?? 0) >= MAX_SAVE_PROMPTS) {
        await log('info', 'SAVE_PROMPTS_EXHAUSTED', `Already sent ${identified.savePromptCount} save reminders — not asking again`, undefined, employeeName, phoneNumber);
        return;
      }

      if (!identified.remindLater && chatId) {
        // Atomic claim so two concurrent calls cannot both send the reminder.
        const claimed = await IdentifiedContact.findOneAndUpdate(
          {
            ...key,
            savedInPhone: false,
            remindLater: { $ne: true },
            savePromptCount: { $lt: MAX_SAVE_PROMPTS },
            $or: [
              { lastReminderSentAt: null },
              { lastReminderSentAt: { $exists: false } },
              { lastReminderSentAt: { $lte: new Date(Date.now() - CATEGORY_REQUEST_COOLDOWN_MS) } },
            ],
          },
          { $set: { lastReminderSentAt: new Date() }, $inc: { savePromptCount: 1 } },
          { new: true }
        );
        if (claimed) {
          await log('info', 'REMINDER', `Sending save-to-phone reminder (#${claimed.savePromptCount})`, undefined, employeeName, phoneNumber);
          await sendSmartReminder(chatId, phoneNumber, employeeName, identified.contactName, identified.category);
        }
      }
      return;
    }

    // ── 3. Is the number in the employee's phone contacts? (Scenario A) ──────
    let phoneContactName = contactName && contactName !== 'Unknown' ? contactName : undefined;

    if (!phoneContactName) {
      const phoneContact = await findPhoneContact(pKey, employeeName, deviceId);
      if (phoneContact?.contactName && phoneContact.contactName !== 'Unknown') {
        phoneContactName = phoneContact.contactName;
        await log('info', 'CONTACT_DB_FALLBACK', `Found contact in DB: "${phoneContact.contactName}"`, undefined, employeeName, phoneNumber);
      }
    }

    // A name we already stored (e.g. supplied through Scenario B) still counts.
    if (!phoneContactName && identified?.contactName) {
      phoneContactName = identified.contactName;
    }

    if (phoneContactName && phoneContactName !== 'Unknown') {
      const name = phoneContactName;
      await log('info', 'SCENARIO_A', `Scenario A — known contact: "${name}"`, undefined, employeeName, phoneNumber);

      // Upsert on the canonical key — this can never create a second row for a
      // different formatting of the same number.
      await IdentifiedContact.updateOne(
        key,
        {
          $set: {
            contactName: name,
            phoneNumber,
            employeeName,
            deviceId: deviceId || identified?.deviceId || '',
            ...(chatId ? { telegramChatId: chatId } : {}),
          },
          $setOnInsert: {
            ...key,
            savedInPhone: false,
            remindLater: false,
            categoryPromptCount: 0,
            savePromptCount: 0,
          },
        },
        { upsert: true }
      );

      // Any tracker for this number is moot now that the contact is named.
      await UnknownNumberTracker.updateOne(
        { ...key, status: { $ne: 'identified' } },
        { $set: { status: 'awaiting_category' } }
      );

      if (!chatId) {
        await log('warn', 'NO_CHATID', `Cannot send Telegram — employee "${employeeName}" has no linked Telegram chatId. They need to open the bot, send /start, then send their 10-digit phone number.`, undefined, employeeName, phoneNumber);
        return;
      }

      await requestCategory(key, chatId, name, phoneNumber, employeeName);
      return;
    }

    // ── 4. Unknown number — track frequency ───────────────────────────────
    await log('info', 'SCENARIO_B', `Scenario B — unknown number (not in phone contacts)`, undefined, employeeName, phoneNumber);

    const now = new Date();

    const tracker = await UnknownNumberTracker.findOneAndUpdate(
      key,
      {
        $inc: { callCount: 1 },
        $set: { lastSeen: now, phoneNumber, employeeName },
        $setOnInsert: { ...key, firstSeen: now, status: 'tracking', deviceId, namePromptCount: 0 },
      },
      { upsert: true, new: true }
    );

    await log('info', 'TRACKER_UPDATED', `Call count: ${tracker.callCount}/${CALL_THRESHOLD}, status: "${tracker.status}"`, { tracker: { callCount: tracker.callCount, status: tracker.status } }, employeeName, phoneNumber);

    // The tracker is finished — the contact was named and classified already.
    if (tracker.status === 'identified') {
      await log('info', 'SKIP_TRACKER_IDENTIFIED', `Tracker already identified — no further prompts`, undefined, employeeName, phoneNumber);
      return;
    }

    if (!chatId) {
      if (tracker.callCount >= CALL_THRESHOLD) {
        await log('warn', 'THRESHOLD_NO_CHATID', `${CALL_THRESHOLD} calls reached but employee "${employeeName}" has no Telegram linked — cannot send name request`, undefined, employeeName, phoneNumber);
      }
      return;
    }

    // 4a. Name already given, category still missing — re-ask. This case used to
    // dead-end: no branch handled 'awaiting_category', so the contact was never
    // prompted again and stayed unclassified forever.
    if (tracker.status === 'awaiting_category') {
      const withName = identified ?? (await IdentifiedContact.findOne(key));
      if (withName?.contactName) {
        await requestCategory(key, chatId, withName.contactName, phoneNumber, employeeName);
      } else {
        // Name was lost somehow — fall back to asking for it again.
        await UnknownNumberTracker.updateOne(key, { $set: { status: 'tracking' } });
        await log('warn', 'AWAITING_CATEGORY_NO_NAME', `Tracker was awaiting_category but no name stored — reverted to tracking`, undefined, employeeName, phoneNumber);
      }
      return;
    }

    if (tracker.callCount < CALL_THRESHOLD) {
      await log('info', 'TRACKING', `Tracking ${tracker.callCount}/${CALL_THRESHOLD} calls — no action yet`, undefined, employeeName, phoneNumber);
      return;
    }

    // 4b. Threshold reached, or a previous name request never actually went out.
    // One atomic claim covers both, so only a single name request is ever in flight.
    //
    // nameRequestSentAt is stamped by the claim itself, BEFORE the Telegram call —
    // it marks "an attempt owns this tracker", not "a message was delivered". If it
    // were stamped after the send, concurrent calls would all still see it null and
    // all match the retry branch below, and every one of them would send.
    const claimed = await UnknownNumberTracker.findOneAndUpdate(
      {
        ...key,
        callCount: { $gte: CALL_THRESHOLD },
        namePromptCount: { $lt: MAX_NAME_PROMPTS },
        $or: [
          { status: 'tracking' },
          // awaiting_name where no attempt is in flight and none ever landed → retry
          { status: 'awaiting_name', telegramMessageId: null, nameRequestSentAt: null },
          { status: 'awaiting_name', telegramMessageId: null, nameRequestSentAt: { $exists: false } },
        ],
      },
      {
        $set: { status: 'awaiting_name', nameRequestSentAt: new Date() },
        $inc: { namePromptCount: 1 },
      },
      { new: true }
    );

    if (!claimed) {
      await log('info', 'SKIP_NAME_ALREADY_SENT', `Name request already sent or prompt cap reached for ${phoneNumber} — not sending again`, undefined, employeeName, phoneNumber);
      return;
    }

    await log('info', 'THRESHOLD_REACHED', `Threshold of ${CALL_THRESHOLD} calls reached — sending name request (#${claimed.namePromptCount}) to chatId ${chatId}`, undefined, employeeName, phoneNumber);

    const result = await sendNameRequest(chatId, phoneNumber, employeeName, claimed.callCount);
    const messageId = result?.result?.message_id;

    if (result?.ok === true) {
      if (messageId != null) {
        await UnknownNumberTracker.updateOne(key, { $set: { telegramMessageId: messageId } });
      }
      await log('success', 'NAME_REQUEST_SENT', `Name request sent — messageId: ${messageId}`, { telegramResult: result }, employeeName, phoneNumber);
    } else {
      // Release the claim (including its timestamp) so the next call retries.
      await UnknownNumberTracker.updateOne(key, {
        $set: { status: 'tracking' },
        $unset: { nameRequestSentAt: 1 },
        $inc: { namePromptCount: -1 },
      });
      await log('error', 'NAME_REQUEST_FAILED', `Failed to send Telegram name request (ok=${result?.ok}) — reverted to tracking for retry`, { telegramResult: result }, employeeName, phoneNumber);
    }
  } catch (err: any) {
    console.error('[ContactIntelligence] Error:', err);
    try {
      await BotLog.create({
        level: 'error',
        step: 'UNHANDLED_ERROR',
        message: err?.message ?? 'Unknown error in contactIntelligence',
        data: { stack: err?.stack },
        employeeName,
        phoneNumber,
      });
    } catch { /* ignore */ }
  }
}

// ── Shared helpers ─────────────────────────────────────────────────────────

/**
 * Look up the number in the employee's synced phone contacts. Matches on phoneKey so
 * a contact saved as "+91…" is still found when the call log reports "0…".
 * Legacy rows with no phoneKey yet are covered by the suffix-regex fallback.
 */
async function findPhoneContact(pKey: string, employeeName: string, deviceId: string) {
  if (!pKey) return null;

  const match: any[] = [{ phoneKey: pKey }];
  if (pKey.length >= 7) match.push({ phoneNumber: new RegExp(`${escapeRegex(pKey)}$`) });

  const scope: any[] = [];
  if (deviceId) scope.push({ deviceId });
  if (employeeName) scope.push({ employeeName: new RegExp(`^${escapeRegex(employeeName)}$`, 'i') });

  const query: any = scope.length ? { $and: [{ $or: match }, { $or: scope }] } : { $or: match };
  return Contact.findOne(query).lean() as any;
}

async function isSavedInPhoneContacts(pKey: string, employeeName: string, deviceId: string) {
  const c = await findPhoneContact(pKey, employeeName, deviceId);
  return !!(c?.contactName && c.contactName !== 'Unknown');
}

async function markSavedInPhone(key: ContactRecordKey) {
  await IdentifiedContact.updateOne(
    key,
    { $set: { savedInPhone: true, remindLater: false, completedAt: new Date() } }
  );
}

/**
 * Send the category keyboard at most once per contact until a category is chosen.
 * The atomic claim on categoryRequestSentAt is what guarantees "asked once" across
 * concurrent calls, duplicate call logs and process retries.
 */
async function requestCategory(
  key: ContactRecordKey,
  chatId: string,
  contactName: string,
  phoneNumber: string,
  employeeName: string
) {
  const claimed = await IdentifiedContact.findOneAndUpdate(
    {
      ...key,
      contactName: { $exists: true, $nin: [null, ''] },
      $and: [
        { $or: [{ category: null }, { category: { $exists: false } }] },
        { $or: [{ categoryRequestSentAt: null }, { categoryRequestSentAt: { $exists: false } }] },
      ],
      categoryPromptCount: { $lt: MAX_CATEGORY_PROMPTS },
    },
    { $set: { categoryRequestSentAt: new Date() }, $inc: { categoryPromptCount: 1 } },
    { new: true }
  );

  if (!claimed) {
    await log('info', 'SKIP_CATEGORY_ALREADY_SENT', `Category Telegram already sent (or cap reached) for "${contactName}" — not sending again until a category is chosen`, undefined, employeeName, phoneNumber);
    return false;
  }

  await log('info', 'SENDING_CATEGORY', `Sending category keyboard to chatId ${chatId} for "${contactName}" (#${claimed.categoryPromptCount})`, undefined, employeeName, phoneNumber);
  const result = await sendCategoryRequest(chatId, contactName, phoneNumber, employeeName);

  if (result?.ok === true) {
    await log('success', 'MESSAGE_SENT', `Category keyboard sent successfully`, { telegramResult: result }, employeeName, phoneNumber);
    return true;
  }

  // Release the claim so a later call retries.
  await IdentifiedContact.updateOne(key, {
    $unset: { categoryRequestSentAt: 1 },
    $inc: { categoryPromptCount: -1 },
  });
  await log('error', 'MESSAGE_SEND_FAILED', `Category keyboard failed — cleared claim for retry`, { telegramResult: result }, employeeName, phoneNumber);
  return false;
}

// ── Helper message senders ─────────────────────────────────────────────────

async function sendCategoryRequest(
  chatId: string,
  contactName: string,
  phoneNumber: string,
  employeeName: string
) {
  const text =
    `📞 <b>Scenario A — Please classify this contact</b>\n\n` +
    `Employee: <b>${employeeName}</b>\n` +
    `Contact Name: <b>${contactName}</b>\n` +
    `Number: <code>${phoneNumber}</code>\n\n` +
    `Who is this person?`;

  return sendInlineKeyboard(chatId, text, categoryKeyboard(phoneNumber, employeeName));
}

async function sendNameRequest(
  chatId: string,
  phoneNumber: string,
  employeeName: string,
  callCount: number
) {
  const text =
    `⚠️ <b>Scenario B — Contact Identification Needed</b>\n\n` +
    `Employee: <b>${employeeName}</b>\n` +
    `Number: <code>${phoneNumber}</code>\n` +
    `Call Count: <b>${callCount}</b>\n\n` +
    `This number has appeared <b>${callCount} times</b> in call logs.\n\n` +
    `Tap the button below to enter the contact name, or reply to this message with the name.`;

  return sendInlineKeyboard(chatId, text, nameRequestKeyboard(phoneNumber, employeeName, chatId));
}

async function sendSmartReminder(
  chatId: string,
  phoneNumber: string,
  employeeName: string,
  contactName: string | null,
  category: string
) {
  const displayName = contactName && contactName !== phoneNumber ? contactName : null;
  const detailLine = displayName
    ? `Name: <b>${displayName}</b>\nNumber: <code>${phoneNumber}</code>`
    : `Number: <code>${phoneNumber}</code>`;
  const text =
    `Confirm once you've saved this contact in your phone?\n\n` +
    detailLine;

  await sendInlineKeyboard(chatId, text, saveContactKeyboard(phoneNumber, employeeName));
}

/**
 * Daily 8 AM job: resend only stale pending prompts.
 * Rules:
 * - Do NOT spam daily.
 * - Re-send Scenario A / B only if the last successful prompt is older than 2 days,
 *   the item is still unresolved, and the per-contact prompt cap is not yet reached.
 */
export async function runDailyPendingReminders(): Promise<{ category: number; nameRequest: number; saveReminder: number }> {
  await connectToDatabase();
  const counts = { category: 0, nameRequest: 0, saveReminder: 0 };
  const now = new Date();
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

  // 1. Scenario A/B: unresolved category, last category prompt older than 2 days
  const pendingCategory = await IdentifiedContact.find({
    contactName: { $exists: true, $nin: [null, ''] },
    $or: [{ category: null }, { category: { $exists: false } }],
    telegramChatId: { $exists: true, $nin: [null, ''] },
    categoryRequestSentAt: { $lte: twoDaysAgo },
    categoryPromptCount: { $lt: MAX_CATEGORY_PROMPTS },
  }).lean() as any[];

  for (const c of pendingCategory) {
    try {
      const result = await sendCategoryRequest(c.telegramChatId, c.contactName, c.phoneNumber, c.employeeName);
      if (result?.ok === true) {
        await IdentifiedContact.updateOne(
          { _id: c._id },
          { $set: { categoryRequestSentAt: new Date() }, $inc: { categoryPromptCount: 1 } }
        );
        counts.category++;
      }
    } catch (err) {
      console.error(`[DailyReminder] Category send failed for ${c.phoneNumber}:`, err);
    }
  }

  // 2. Scenario B: awaiting name, last name-request prompt older than 2 days
  const pendingName = await UnknownNumberTracker.find({
    status: 'awaiting_name',
    nameRequestSentAt: { $lte: twoDaysAgo },
    namePromptCount: { $lt: MAX_NAME_PROMPTS },
  }).lean() as any[];

  for (const t of pendingName) {
    try {
      const emp = await EmployeeTelegram.findOne({
        employeeName: new RegExp(`^${escapeRegex(t.employeeName)}$`, 'i'),
      }).lean() as any;
      const chatId = emp?.telegramChatId;
      if (!chatId) continue;
      const result = await sendNameRequest(chatId, t.phoneNumber, t.employeeName, t.callCount ?? CALL_THRESHOLD);
      if (result?.ok === true) {
        const setFields: Record<string, unknown> = { nameRequestSentAt: new Date() };
        if (result?.result?.message_id != null) {
          setFields.telegramMessageId = result.result.message_id;
        }
        await UnknownNumberTracker.updateOne({ _id: t._id }, { $set: setFields, $inc: { namePromptCount: 1 } });
        counts.nameRequest++;
      }
    } catch (err) {
      console.error(`[DailyReminder] Name request send failed for ${t.phoneNumber}:`, err);
    }
  }

  // 3. Save reminder: classified but not yet saved in phone, still under the cap
  const pendingSave = await IdentifiedContact.find({
    contactName: { $exists: true, $ne: null },
    category: { $exists: true, $ne: null },
    savedInPhone: false,
    remindLater: { $ne: true },
    telegramChatId: { $exists: true, $nin: [null, ''] },
    savePromptCount: { $lt: MAX_SAVE_PROMPTS },
    $or: [
      { lastReminderSentAt: null },
      { lastReminderSentAt: { $exists: false } },
      { lastReminderSentAt: { $lte: twoDaysAgo } },
    ],
  }).lean() as any[];

  for (const c of pendingSave) {
    try {
      // The employee may have saved it since — close it out instead of nagging.
      if (await isSavedInPhoneContacts(c.phoneKey, c.employeeName, c.deviceId ?? '')) {
        await markSavedInPhone({ phoneKey: c.phoneKey, employeeKey: c.employeeKey });
        continue;
      }
      await sendSmartReminder(c.telegramChatId, c.phoneNumber, c.employeeName, c.contactName ?? null, c.category ?? '');
      await IdentifiedContact.updateOne(
        { _id: c._id },
        { $set: { lastReminderSentAt: now }, $inc: { savePromptCount: 1 } }
      );
      counts.saveReminder++;
    } catch (err) {
      console.error(`[DailyReminder] Save reminder failed for ${c.phoneNumber}:`, err);
    }
  }

  return counts;
}

/**
 * Persist a Scenario B name and move the tracker on to the category step.
 *
 * categoryRequestSentAt is stamped here because the category keyboard is sent right
 * after this call. Without the stamp, the next call log for the same number would
 * take the Scenario A branch, claim the prompt and send a duplicate keyboard.
 * Shared by the webhook reply handler and /api/telegram/submit-scenario-b-name so
 * both entry points store the name identically.
 */
export async function saveScenarioBName(args: {
  key: ContactRecordKey;
  contactName: string;
  phoneNumber: string;
  employeeName: string;
  chatId: string;
  deviceId: string;
}) {
  const { key, contactName, phoneNumber, employeeName, chatId, deviceId } = args;

  await IdentifiedContact.updateOne(
    key,
    {
      $set: {
        contactName: contactName.trim(),
        telegramChatId: chatId,
        phoneNumber,
        employeeName,
        deviceId,
        categoryRequestSentAt: new Date(),
      },
      $setOnInsert: {
        ...key,
        savedInPhone: false,
        remindLater: false,
        savePromptCount: 0,
      },
      $inc: { categoryPromptCount: 1 },
    },
    { upsert: true }
  );

  await UnknownNumberTracker.updateOne(key, { $set: { status: 'awaiting_category' } });
}

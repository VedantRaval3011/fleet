import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import IdentifiedContact from "@/models/IdentifiedContact";
import UnknownNumberTracker from "@/models/UnknownNumberTracker";
import EmployeeTelegram from "@/models/EmployeeTelegram";
import BotLog from "@/models/BotLog";
import { runContactIntelligence, saveScenarioBName } from "@/lib/contactIntelligence";
import DeviceCallLog from "@/models/DeviceCallLog";
import { phoneKey, employeeKey, displayPhone } from "@/lib/contactKey";
import {
  answerCallbackQuery,
  editMessageText,
  sendInlineKeyboard,
  categoryKeyboard,
  saveContactKeyboard,
  sendMessage,
} from "@/lib/telegram";

function isValidRequest(req: Request): boolean {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) return true; // If no secret configured, allow (for local dev)

  const providedSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (providedSecret !== expectedSecret) {
    console.warn(`[Webhook Auth] Token mismatch. Expected: '${expectedSecret}', got: '${providedSecret}'`);
    return false;
  }
  return true;
}

/** Canonical record key for the two intelligence collections. */
function recordKey(rawPhone: string, rawEmployee: string) {
  return { phoneKey: phoneKey(rawPhone), employeeKey: employeeKey(rawEmployee) };
}

/**
 * After an employee links their Telegram, process all their pending contacts
 * that couldn't be sent before (because chatId was null at the time).
 */
async function processPendingForEmployee(employeeName: string) {
  try {
    const eKey = employeeKey(employeeName);

    // 1. Scenario A: IdentifiedContacts with a name but no category (needs_category)
    const pendingIdentified = await IdentifiedContact.find({
      employeeKey: eKey,
      contactName: { $exists: true, $ne: null },
      $or: [{ category: null }, { category: { $exists: false } }],
    }).lean();

    for (const contact of pendingIdentified) {
      try {
        await runContactIntelligence(
          contact.phoneNumber,
          contact.contactName,
          employeeName,
          (contact as any).deviceId || ""
        );
      } catch (e) {
        console.error(`[PostRegistration] Failed for ${contact.phoneNumber}:`, e);
      }
    }

    // 2. Scenario B: trackers at threshold still waiting on a name or a category
    const pendingTrackers = await UnknownNumberTracker.find({
      employeeKey: eKey,
      $or: [
        { status: "tracking", callCount: { $gte: 5 } },
        { status: "awaiting_category" },
        { status: "awaiting_name", telegramMessageId: null, nameRequestSentAt: null },
      ],
    }).lean();

    for (const tracker of pendingTrackers) {
      try {
        // Find one call log for this phone+employee to get contactName/deviceId
        const callLog = await DeviceCallLog.findOne({
          phoneNumber: tracker.phoneNumber,
          employeeName,
        }).lean() as any;

        const resolvedName =
          callLog?.contactName && callLog.contactName !== "Unknown"
            ? callLog.contactName
            : undefined;

        await runContactIntelligence(
          tracker.phoneNumber,
          resolvedName,
          employeeName,
          tracker.deviceId || callLog?.deviceId || ""
        );
      } catch (e) {
        console.error(`[PostRegistration] Failed for tracker ${tracker.phoneNumber}:`, e);
      }
    }

    console.log(
      `[PostRegistration] Processed ${pendingIdentified.length} identified + ${pendingTrackers.length} tracked for "${employeeName}"`
    );
  } catch (err) {
    console.error("[PostRegistration] Error:", err);
  }
}

export async function POST(req: Request) {
  if (!isValidRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });
  }

  try {
    await connectToDatabase();

    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      return NextResponse.json({ ok: true });
    }

    if (update.message) {
      await handleMessage(update.message);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Telegram Webhook] Error:", err);
    return NextResponse.json({ ok: true });
  }
}

// ── Callback Query Handler ─────────────────────────────────────────────────

async function handleCallbackQuery(query: any) {
  const data: string = query.data ?? "";
  const chatId: number = query.message?.chat?.id;
  const messageId: number = query.message?.message_id;
  const callbackId: string = query.id;

  // Category selection: cat:<phone>:<employee>:<category>
  if (data.startsWith("cat:")) {
    const parts = data.split(":");
    const [, phonePart, empPart, ...catParts] = parts;
    const rawPhone = decodeURIComponent(phonePart);
    const employeeName = decodeURIComponent(empPart);
    const category = decodeURIComponent(catParts.join(":"));
    const key = recordKey(rawPhone, employeeName);
    const phoneNumber = displayPhone(rawPhone);

    await answerCallbackQuery(callbackId, `Category saved: ${category}`);

    const existing = await IdentifiedContact.findOne(key);

    // Tapping the same keyboard twice (or an old message resurfacing) must not
    // re-run the flow and send a second "did you save it?" prompt.
    if (existing?.category) {
      const already =
        `✅ <b>Contact Classified</b>\n\n` +
        (existing.contactName ? `Name: <b>${existing.contactName}</b>\n` : "") +
        `Category: <b>${existing.category}</b>\n` +
        `Number: <code>${existing.phoneNumber || phoneNumber}</code>`;
      await editMessageText(chatId, messageId, already);
      return;
    }

    // Recover the name from the tracker if the IdentifiedContact has none yet, so
    // we never persist a record that has a category but no name (such a record can
    // never reach the terminal state and would be prompted forever).
    const tracker = await UnknownNumberTracker.findOne(key);
    const resolvedName = existing?.contactName || undefined;

    const contact = await IdentifiedContact.findOneAndUpdate(
      key,
      {
        $set: {
          category,
          identifiedAt: new Date(),
          telegramChatId: String(chatId),
          phoneNumber: existing?.phoneNumber || phoneNumber,
          employeeName: existing?.employeeName || employeeName,
          ...(resolvedName ? { contactName: resolvedName } : {}),
        },
        $setOnInsert: {
          ...key,
          deviceId: tracker?.deviceId ?? "",
          savedInPhone: false,
          remindLater: false,
          categoryPromptCount: 0,
          savePromptCount: 0,
        },
      },
      { upsert: true, new: true }
    );

    await UnknownNumberTracker.updateOne(key, { $set: { status: "identified" } });

    if (!contact.contactName) {
      await BotLog.create({
        level: "warn",
        step: "CATEGORY_WITHOUT_NAME",
        message: `Category "${category}" recorded for ${phoneNumber} but no contact name is stored yet`,
        employeeName,
        phoneNumber,
      }).catch(() => {});
    }

    const displayName =
      contact.contactName && contact.contactName !== phoneNumber
        ? contact.contactName
        : null;
    const nameLine = displayName ? `Name: <b>${displayName}</b>\n` : "";
    await editMessageText(
      chatId,
      messageId,
      `✅ <b>Contact Classified</b>\n\n${nameLine}Category: <b>${category}</b>\nNumber: <code>${phoneNumber}</code>`
    );

    // Already saved in their phone? Then there is nothing left to ask.
    if (contact.savedInPhone) return;

    const confirmLine = displayName
      ? `Name: <b>${displayName}</b>\nNumber: <code>${phoneNumber}</code>`
      : `Number: <code>${phoneNumber}</code>`;
    const saveText =
      `✅ Contact classified.\n\n` +
      `Confirm once you've saved this contact in your phone?\n\n` +
      confirmLine;

    await sendInlineKeyboard(chatId, saveText, saveContactKeyboard(phoneNumber, employeeName));
    await IdentifiedContact.updateOne(
      key,
      { $set: { lastReminderSentAt: new Date() }, $inc: { savePromptCount: 1 } }
    );
    return;
  }

  // Saved confirmation: saved:<phone>:<employee>
  if (data.startsWith("saved:")) {
    const [, phonePart, empPart] = data.split(":");
    const rawPhone = decodeURIComponent(phonePart);
    const employeeName = decodeURIComponent(empPart);
    const key = recordKey(rawPhone, employeeName);

    await answerCallbackQuery(callbackId, "Great! Contact saved ✅");

    // Terminal: classified + saved in phone. runContactIntelligence checks exactly
    // this and returns immediately, so the number can never surface again.
    const res = await IdentifiedContact.updateOne(
      key,
      { $set: { savedInPhone: true, remindLater: false, completedAt: new Date() } }
    );
    await UnknownNumberTracker.updateOne(key, { $set: { status: "identified" } });

    if (res.matchedCount === 0) {
      await BotLog.create({
        level: "error",
        step: "SAVED_NO_MATCH",
        message: `"Saved" tapped but no IdentifiedContact matched key ${key.phoneKey}/${key.employeeKey}`,
        employeeName,
        phoneNumber: displayPhone(rawPhone),
      }).catch(() => {});
    }

    await editMessageText(chatId, messageId, `✅ Perfect! Contact has been saved in your phone.`);
    return;
  }

  // Remind Later: remind:<phone>:<employee>
  if (data.startsWith("remind:")) {
    const [, phonePart, empPart] = data.split(":");
    const rawPhone = decodeURIComponent(phonePart);
    const employeeName = decodeURIComponent(empPart);
    const key = recordKey(rawPhone, employeeName);

    await answerCallbackQuery(callbackId, "We'll remind you later ⏰");
    await IdentifiedContact.updateOne(key, { $set: { remindLater: true } });
    await editMessageText(
      chatId,
      messageId,
      `⏰ Reminder set. We'll remind you next time this number appears.`
    );
    return;
  }

  await answerCallbackQuery(callbackId);
}

// ── Message Handler ────────────────────────────────────────────────────────

async function handleMessage(message: any) {
  const chatId: number = message.chat?.id;
  const text: string = (message.text ?? "").trim();
  const replyToMessageId: number | undefined = message.reply_to_message?.message_id;

  // ── 1. /start command — begin self-registration ────────────────────────
  if (text === "/start") {
    const existing = await EmployeeTelegram.findOne({ telegramChatId: String(chatId) });
    if (existing) {
      await sendMessage(
        chatId,
        `👋 Welcome back, <b>${existing.employeeName}</b>!\n\nYou are already registered in the system.\n\nYour Telegram is connected to the call log intelligence system.`
      );
      return;
    }

    await sendMessage(
      chatId,
      `👋 <b>Welcome to the Call Log System</b>\n\n` +
        `To register, please send your <b>employee phone number</b> used in the call logs app.\n\n` +
        `Example:\n<code>9876543210</code>`
    );
    return;
  }

  // ── 2. Reply-based contact name identification ─────────────────────────
  if (replyToMessageId) {
    const tracker = await UnknownNumberTracker.findOne({
      telegramMessageId: replyToMessageId,
      status: "awaiting_name",
    });

    if (tracker) {
      const { employeeName } = tracker;
      const contactName = text;
      const key = { phoneKey: tracker.phoneKey, employeeKey: tracker.employeeKey };
      const phoneNumber = tracker.phoneNumber;

      await saveScenarioBName({
        key,
        contactName,
        phoneNumber,
        employeeName,
        chatId: String(chatId),
        deviceId: tracker.deviceId ?? "",
      });

      const categoryText =
        `✅ <b>Name saved!</b>\n\n` +
        `Name: <b>${contactName}</b>\n` +
        `Number: <code>${phoneNumber}</code>\n\n` +
        `Please select the category:`;

      await sendInlineKeyboard(chatId, categoryText, categoryKeyboard(phoneNumber, employeeName));
      return;
    }
    // Fall through to phone registration check
  }

  // ── 3. Phone number — self-registration verification ───────────────────
  const digitsOnly = text.replace(/[\s\-\+]/g, "");
  const isPhoneNumber = /^\d{10,13}$/.test(digitsOnly);

  if (isPhoneNumber) {
    const alreadyLinked = await EmployeeTelegram.findOne({ telegramChatId: String(chatId) });
    if (alreadyLinked) {
      await sendMessage(
        chatId,
        `✅ You are already registered as <b>${alreadyLinked.employeeName}</b>.`
      );
      return;
    }

    const last10 = digitsOnly.slice(-10);

    const employee = await EmployeeTelegram.findOne({
      $or: [
        { phoneNumber: digitsOnly },
        { phoneNumber: last10 },
        { phoneNumber: { $regex: `${last10}$` } },
      ],
      telegramChatId: null,
    });

    if (!employee) {
      const taken = await EmployeeTelegram.findOne({
        $or: [
          { phoneNumber: digitsOnly },
          { phoneNumber: last10 },
          { phoneNumber: { $regex: `${last10}$` } },
        ],
        telegramChatId: { $ne: null },
      });

      if (taken) {
        await sendMessage(
          chatId,
          `⚠️ This phone number is already linked to another Telegram account.\n\nPlease contact the administrator.`
        );
      } else {
        await sendMessage(
          chatId,
          `❌ <b>This phone number is not registered in the system.</b>\n\nPlease contact the administrator to be added.`
        );
      }
      return;
    }

    employee.telegramChatId = String(chatId);
    employee.registeredAt = new Date();
    await employee.save();

    await sendMessage(
      chatId,
      `✅ <b>Registration successful!</b>\n\n` +
        `Employee: <b>${employee.employeeName}</b>\n` +
        `Telegram connected successfully.\n\n` +
        `You will now receive contact classification requests from the call log system.`
    );

    // Immediately process all pending contacts that were waiting for Telegram to be linked
    await processPendingForEmployee(employee.employeeName);
    return;
  }

  // ── 4. Unknown message (only respond to unregistered users) ──────────────
  const isRegistered = await EmployeeTelegram.findOne({ telegramChatId: String(chatId) });
  if (!isRegistered) {
    await sendMessage(
      chatId,
      `❓ I didn't understand that.\n\nSend <code>/start</code> to begin registration.`
    );
  }
}

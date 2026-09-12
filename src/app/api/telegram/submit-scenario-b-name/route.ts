import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import UnknownNumberTracker from "@/models/UnknownNumberTracker";
import { saveScenarioBName } from "@/lib/contactIntelligence";
import { phoneKey, employeeKey } from "@/lib/contactKey";
import { sendInlineKeyboard, categoryKeyboard } from "@/lib/telegram";

/**
 * POST /api/telegram/submit-scenario-b-name
 *
 * Called from the Scenario B Web App (Enter name form).
 * Body: { contactName, phoneNumber, employeeName, chatId }
 * Stores the name against the canonical (phoneKey, employeeKey) record, moves the
 * tracker to awaiting_category and sends the category keyboard to the chat.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { contactName, phoneNumber, employeeName, chatId } = body;
    if (!contactName || !phoneNumber || !employeeName || !chatId) {
      return NextResponse.json(
        { error: "Missing contactName, phoneNumber, employeeName, or chatId" },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const key = { phoneKey: phoneKey(phoneNumber), employeeKey: employeeKey(employeeName) };

    const tracker = await UnknownNumberTracker.findOne(key);
    if (!tracker) {
      return NextResponse.json(
        { error: "No pending name request for this contact." },
        { status: 400 }
      );
    }

    // Idempotent: a double submit (double tap, form retry) must not send a second
    // category keyboard. Only 'awaiting_name' is a valid starting point.
    if (tracker.status !== "awaiting_name") {
      return NextResponse.json(
        { success: true, alreadySubmitted: true, status: tracker.status },
        { status: 200 }
      );
    }

    // Prefer the number exactly as we already display it for this contact.
    const displayNumber = tracker.phoneNumber || phoneNumber;

    await saveScenarioBName({
      key,
      contactName,
      phoneNumber: displayNumber,
      employeeName: tracker.employeeName || employeeName,
      chatId: String(chatId),
      deviceId: tracker.deviceId ?? "",
    });

    const categoryText =
      `✅ <b>Name saved!</b>\n\n` +
      `Name: <b>${contactName.trim()}</b>\n` +
      `Number: <code>${displayNumber}</code>\n\n` +
      `Please select the category:`;

    await sendInlineKeyboard(
      chatId,
      categoryText,
      categoryKeyboard(displayNumber, tracker.employeeName || employeeName)
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[submit-scenario-b-name]", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

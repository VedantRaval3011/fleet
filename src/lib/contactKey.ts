/**
 * Canonical identity keys for the contact-intelligence pipeline.
 *
 * The Android app sends the same number in several shapes ("9313450501",
 * "+919313450501", "09313450501", "093 1345 0501"), so keying records on the raw
 * string produced a separate IdentifiedContact / UnknownNumberTracker per shape —
 * and therefore a repeat Telegram prompt for a contact the employee had already
 * classified. Every read and write in the pipeline must key on these helpers.
 */

import { normalizePhoneNumber } from '@/lib/phone';

/**
 * Stable identity for a phone number: the last 10 digits (shorter numbers —
 * landlines, short codes — keep all their digits). Format-independent by design.
 */
export function phoneKey(raw: unknown): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Case- and spacing-insensitive identity for an employee name. */
export function employeeKey(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Display/storage form of a number: E.164 when parseable, else what we were given. */
export function displayPhone(raw: unknown): string {
  const input = String(raw ?? '');
  if (!input) return input;
  return normalizePhoneNumber(input) || input;
}

/** True when the number is long enough to key on with confidence. */
export function isUsablePhone(raw: unknown): boolean {
  return phoneKey(raw).length >= 7;
}

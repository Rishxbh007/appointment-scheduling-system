// Doctor payout details (weekly settlement): validation, storage,
// and display safety.
//
// What this is NOT: no money moves here. This only records where a
// doctor's weekly settlement should go — UPI, bank transfer, or
// both. Settlement itself (records, transfers) does not exist yet.
//
// Safety rules, enforced here rather than in callers:
//   * The full bank account number NEVER leaves this module. The
//     read path returns only its masked form (•••• + last 4); the
//     form never receives the full number, so it can never appear
//     in rendered HTML. UPI IDs are shown in full, but only to the
//     owning doctor on their own dashboard — a UPI ID is the
//     doctor's own payment handle, like an email address.
//   * No payout value is ever written to a log or echoed in an
//     error message. Error text names the field, never the value.
//   * A doctor's details are keyed by doctorId, which callers must
//     derive from the session — never from client input.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { doctors } from "@/lib/db/schema";

// UPI ID: local part (letters, digits, dot, underscore, hyphen,
// at least 2 characters) + "@" + bank handle (letters, at least 2).
// Covers name@okaxis, phone@paytm, name@upi and friends.
const UPI_RE = /^[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}$/;
// IFSC: 4 letters, then 0, then 6 letters or digits (RBI format).
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
// Bank account number: digits only, 9–18 (covers Indian banks).
const ACCOUNT_RE = /^\d{9,18}$/;

export type PayoutFieldErrors = {
  upiId?: string;
  accountNumber?: string;
  ifsc?: string;
  accountHolder?: string;
};

/** What the dashboard may display: masked account, never the full one. */
export type PayoutDetailsView = {
  upiId: string | null;
  accountHolder: string | null;
  ifsc: string | null;
  /** Masked account number (••••1234) or null when none is stored. */
  maskedAccountNumber: string | null;
  /** True when at least one complete payout method is stored. */
  hasDetails: boolean;
};

/** Mask a bank account number: only the last 4 digits ever show. */
export function maskAccountNumber(accountNumber: string): string {
  return `••••${accountNumber.slice(-4)}`;
}

/**
 * Load one doctor's payout details for display. Returns only the
 * masked account number — the full number stays in the database.
 * Returns nulls (hasDetails false) when nothing is stored yet.
 */
export async function getPayoutDetails(
  doctorId: number,
): Promise<PayoutDetailsView> {
  const [row] = await db
    .select({
      upiId: doctors.payoutUpiId,
      accountNumber: doctors.payoutAccountNumber,
      ifsc: doctors.payoutIfsc,
      accountHolder: doctors.payoutAccountHolder,
    })
    .from(doctors)
    .where(eq(doctors.doctorId, doctorId));
  if (!row) {
    return {
      upiId: null,
      accountHolder: null,
      ifsc: null,
      maskedAccountNumber: null,
      hasDetails: false,
    };
  }
  const bankComplete = Boolean(
    row.accountNumber && row.ifsc && row.accountHolder,
  );
  return {
    upiId: row.upiId,
    accountHolder: row.accountHolder,
    ifsc: row.ifsc,
    maskedAccountNumber: row.accountNumber
      ? maskAccountNumber(row.accountNumber)
      : null,
    hasDetails: Boolean(row.upiId) || bankComplete,
  };
}

export type SavePayoutInput = {
  upiId: string;
  accountNumber: string;
  ifsc: string;
  accountHolder: string;
};

export type SavePayoutResult =
  | { saved: true }
  | { fieldErrors: PayoutFieldErrors }
  | { error: string };

/**
 * Save one doctor's payout details. The doctorId comes from the
 * caller's session, never from the submitted form.
 *
 * Merge rules (so partial edits cannot corrupt a stored method):
 *   * An empty account-number field keeps the stored number; every
 *     other empty field clears that field. That is why the form
 *     never prefills the account number — blank means "keep", and
 *     the full number is never rendered.
 *   * A submission needs at least one complete method: a valid UPI
 *     ID, or a complete bank set (account + IFSC + holder). A
 *     submission with neither is rejected outright.
 *   * A bank set left incomplete while a UPI ID is present is
 *     cleared entirely (never stored half-finished) — e.g. a
 *     doctor switching from bank to UPI-only.
 * Field values are validated before anything is written; a failed
 * validation writes nothing.
 */
export async function savePayoutDetails(
  doctorId: number,
  input: SavePayoutInput,
): Promise<SavePayoutResult> {
  const [existing] = await db
    .select({
      accountNumber: doctors.payoutAccountNumber,
    })
    .from(doctors)
    .where(eq(doctors.doctorId, doctorId));
  if (!existing) return { error: "Doctor profile not found." };

  const upi = input.upiId.trim();
  const accountSubmitted = input.accountNumber.trim();
  const ifsc = input.ifsc.trim().toUpperCase();
  const holder = input.accountHolder.trim();

  const fieldErrors: PayoutFieldErrors = {};
  if (upi && !UPI_RE.test(upi)) {
    fieldErrors.upiId = "Enter a valid UPI ID, like name@okaxis.";
  }
  if (accountSubmitted && !ACCOUNT_RE.test(accountSubmitted)) {
    fieldErrors.accountNumber = "Account numbers are 9–18 digits.";
  }
  if (ifsc && !IFSC_RE.test(ifsc)) {
    fieldErrors.ifsc =
      "IFSC looks like ABCD0123456 — 4 letters, then 0, then 6 letters or digits.";
  }
  if (holder.length > 255) {
    fieldErrors.accountHolder =
      "Keep the account holder name under 255 characters.";
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  // Blank account number keeps the stored one; everything else is
  // taken exactly as submitted (blank = cleared).
  const account = accountSubmitted || existing.accountNumber;
  const bankComplete = Boolean(account && ifsc && holder);
  const upiPresent = upi.length > 0;
  if (!upiPresent && !bankComplete) {
    return {
      error:
        "Add a UPI ID, or your complete bank details (account number, IFSC, and account holder name).",
    };
  }

  await db
    .update(doctors)
    .set({
      payoutUpiId: upiPresent ? upi : null,
      // An incomplete bank set is cleared, never stored half-finished.
      payoutAccountNumber: bankComplete ? account : null,
      payoutIfsc: bankComplete ? ifsc : null,
      payoutAccountHolder: bankComplete ? holder : null,
    })
    .where(eq(doctors.doctorId, doctorId));
  return { saved: true };
}

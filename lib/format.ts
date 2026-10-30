// Small pure formatters shared by server pages and client
// components (no database or Node imports here, so client
// components can import this module safely).

/**
 * Remaining seats in a slot, in plain human wording — never a
 * "3 of 3 left" fraction. The count itself always comes from the
 * caller's real slot data; this only words it. 0 is "Fully booked"
 * (callers showing a bookable-only picker never hit that branch).
 */
export function formatSeatsLeft(remaining: number): string {
  if (remaining <= 0) return "Fully booked";
  if (remaining === 1) return "Last seat";
  return `${remaining} seats left`;
}

/** Integer paise → "₹500.00". Never invents amounts: the input is
 * always a real amount_paise from the payments table. */
export function formatPaise(amountPaise: number): string {
  return `₹${(amountPaise / 100).toFixed(2)}`;
}

/**
 * Doctor names always render with a "Dr." prefix. Seed doctors store
 * the prefix in their name, registered doctors do not, so normalize
 * at display time instead of trusting stored data. Already-prefixed
 * names pass through unchanged (no "Dr. Dr."), and names that merely
 * start with those letters (e.g. "Drake") are left alone.
 * Canonical home for this rule (pure, no imports): pages, services,
 * and mail code all import it from here so the rule cannot drift
 * between two copies. */
export function formatDoctorName(name: string): string {
  const trimmed = name.trim();
  const withoutPrefix = trimmed.replace(/^dr\.(\s*|$)|^dr(\s+|$)/i, "");
  return `Dr. ${withoutPrefix.trim()}`;
}

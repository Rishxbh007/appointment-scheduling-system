// Asia/Kolkata (IST) helpers.
//
// Why this file exists: the server (and later Vercel) may run in any
// timezone, but "today" and "is this slot in the past?" must be judged
// in IST, where the patients and doctors live. Every date comparison
// in the booking flow goes through these helpers — never through the
// server's local clock.

const IST = "Asia/Kolkata";

/** Today's date as YYYY-MM-DD in IST. */
export function todayIST(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Current time as HH:MM (24-hour) in IST. */
export function nowISTTime(now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

/** Add N days to a YYYY-MM-DD date string (pure calendar math). */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Normalise a Postgres DATE value to YYYY-MM-DD. node-postgres may
 * hand back a Date (midnight UTC) or a plain string, depending on
 * configuration — this accepts both so the rest of the app never has
 * to care.
 */
export function toISODate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** Normalise a Postgres TIME value to HH:MM. */
export function toHHMM(value: unknown): string {
  return String(value).slice(0, 5);
}

/**
 * Is this slot still bookable? A slot is bookable when it is active
 * and its start time has not yet passed in IST. (Capacity is checked
 * separately against max_appointments.)
 */
export function isSlotInFuture(
  slotDate: string,
  slotStartTime: string,
  now = new Date(),
): boolean {
  const today = todayIST(now);
  const date = toISODate(slotDate);
  if (date > today) return true;
  if (date < today) return false;
  return toHHMM(slotStartTime) > nowISTTime(now);
}

/** "2026-10-28" -> "Wed, 28 Oct 2026" (no timezone involved). */
export function formatDate(dateStr: string): string {
  const [y, m, d] = toISODate(dateStr).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${days[dt.getUTCDay()]}, ${d} ${months[m - 1]} ${y}`;
}

/** "09:00:00" -> "9:00 AM", "13:30:00" -> "1:30 PM". */
export function formatTime(timeStr: string): string {
  const [h, m] = toHHMM(timeStr).split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

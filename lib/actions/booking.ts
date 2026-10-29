// Booking server actions: thin wrappers around the service layer.
// Each one re-checks the session and ownership — the service layer
// enforces the same rules, so a forged request cannot bypass them.

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ensureDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  bookingSchema,
  slotSchema,
  appointmentStatusSchema,
  rescheduleSchema,
} from "@/lib/validation";
import {
  bookAppointment,
  changeAppointmentStatus,
  createSlot,
  rescheduleAppointment,
  setSlotActive,
} from "@/lib/services/booking";
import {
  getPatientIdByUser,
  getDoctorIdByUser,
} from "@/lib/services/accounts";
import type { ActionState } from "./auth";

function formValues(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    [...formData.entries()].map(([k, v]) => [k, String(v)]),
  );
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

/** Patient books one slot. On success, lands on their dashboard. */
export async function bookAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await ensureDb();
  const session = await getSession();
  if (!session || session.role !== "Patient") {
    return { error: "Sign in as a patient to book an appointment." };
  }
  const patientId = await getPatientIdByUser(session.userId);
  if (!patientId) return { error: "Patient profile not found." };

  const parsed = bookingSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await bookAppointment(patientId, parsed.data.slotId, parsed.data.reason);
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/dashboard");
  revalidatePath("/doctors");
  redirect("/dashboard");
}

/** Doctor confirms / cancels / completes one of their appointments. */
export async function doctorStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await ensureDb();
  const session = await getSession();
  if (!session || session.role !== "Doctor") {
    return { error: "Only doctors can update appointments." };
  }
  const doctorId = await getDoctorIdByUser(session.userId);
  if (!doctorId) return { error: "Doctor profile not found." };

  const values = formValues(formData);
  const appointmentId = Number(values.appointmentId);
  const status = appointmentStatusSchema.safeParse(values.status);
  if (!appointmentId || !status.success) {
    return { error: "Invalid appointment update." };
  }
  try {
    await changeAppointmentStatus(appointmentId, status.data, { doctorId });
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/dashboard");
  return {};
}

/** Patient cancels their own booking. */
export async function patientCancelAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await ensureDb();
  const session = await getSession();
  if (!session || session.role !== "Patient") {
    return { error: "Only patients can cancel bookings." };
  }
  const patientId = await getPatientIdByUser(session.userId);
  if (!patientId) return { error: "Patient profile not found." };

  const appointmentId = Number(formValues(formData).appointmentId);
  if (!appointmentId) return { error: "Invalid appointment." };
  try {
    await changeAppointmentStatus(appointmentId, "Cancelled", { patientId });
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/dashboard");
  return {};
}

/** Patient moves their own booking to another slot of the same
 * doctor. No redirect: the dashboard card revalidates and the UI
 * shows the success inline. */
export async function patientRescheduleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await ensureDb();
  const session = await getSession();
  if (!session || session.role !== "Patient") {
    return { error: "Only patients can reschedule bookings." };
  }
  const patientId = await getPatientIdByUser(session.userId);
  if (!patientId) return { error: "Patient profile not found." };

  const parsed = rescheduleSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await rescheduleAppointment(
      patientId,
      parsed.data.appointmentId,
      parsed.data.newSlotId,
    );
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/dashboard");
  return { success: true };
}

/** Doctor adds one availability window. */
export async function createSlotAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await ensureDb();
  const session = await getSession();
  if (!session || session.role !== "Doctor") {
    return { error: "Only doctors can manage availability." };
  }
  const doctorId = await getDoctorIdByUser(session.userId);
  if (!doctorId) return { error: "Doctor profile not found." };

  const parsed = slotSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await createSlot(doctorId, parsed.data);
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/dashboard");
  return {};
}

/** Doctor activates / deactivates one of their own windows. */
export async function toggleSlotAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await ensureDb();
  const session = await getSession();
  if (!session || session.role !== "Doctor") {
    return { error: "Only doctors can manage availability." };
  }
  const doctorId = await getDoctorIdByUser(session.userId);
  if (!doctorId) return { error: "Doctor profile not found." };

  const values = formValues(formData);
  const slotId = Number(values.slotId);
  const isActive = values.isActive === "true";
  if (!slotId) return { error: "Invalid slot." };
  try {
    await setSlotActive(doctorId, slotId, isActive);
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/dashboard");
  return {};
}

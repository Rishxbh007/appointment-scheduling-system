// Sign-in and registration forms (client components so validation
// errors from the server action can be shown without losing input).

"use client";

import { useActionState, useState } from "react";
import { loginAction, registerAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function ErrorNote({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
      {message}
    </p>
  );
}

export function LoginForm() {
  const [state, dispatch, pending] = useActionState(loginAction, {});
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Welcome back. Sign in to book appointments or manage your
          practice.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={dispatch} className="flex flex-col gap-4">
          <ErrorNote message={state.error} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <div className="mt-6 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
          <p className="font-medium text-slate-900">Demo accounts</p>
          <p>
            Patient: patient@demo.local / demo1234{" "}
            <button
              type="button"
              className="ml-1 cursor-pointer underline"
              onClick={() => {
                setEmail("patient@demo.local");
                setPassword("demo1234");
              }}
            >
              Fill
            </button>
          </p>
          <p>
            Doctor: doctor@demo.local / demo1234{" "}
            <button
              type="button"
              className="ml-1 cursor-pointer underline"
              onClick={() => {
                setEmail("doctor@demo.local");
                setPassword("demo1234");
              }}
            >
              Fill
            </button>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function RegisterForm() {
  const [state, dispatch, pending] = useActionState(registerAction, {});
  const [role, setRole] = useState<"Patient" | "Doctor">("Patient");

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>
          Register as a patient to book, or as a doctor to receive
          bookings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={dispatch} className="flex flex-col gap-4">
          <ErrorNote message={state.error} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" name="name" required placeholder="Your name" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              placeholder="you@example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">Phone (optional)</Label>
            <Input id="phone" name="phone" placeholder="9876543210" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              placeholder="At least 6 characters"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role">I am registering as</Label>
            <select
              id="role"
              name="role"
              value={role}
              onChange={(e) =>
                setRole(e.target.value as "Patient" | "Doctor")
              }
              className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="Patient">Patient</option>
              <option value="Doctor">Doctor</option>
            </select>
          </div>
          {role === "Doctor" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qualification">Qualification</Label>
                <Input
                  id="qualification"
                  name="qualification"
                  placeholder="MBBS, MD General Medicine"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="experienceYears">
                    Experience (years)
                  </Label>
                  <Input
                    id="experienceYears"
                    name="experienceYears"
                    type="number"
                    min={0}
                    placeholder="10"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="consultationFee">
                    Consultation fee (₹)
                  </Label>
                  <Input
                    id="consultationFee"
                    name="consultationFee"
                    type="number"
                    min={0}
                    placeholder="500"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="specialization">Specialization</Label>
                <Input
                  id="specialization"
                  name="specialization"
                  required
                  placeholder="General Physician"
                />
              </div>
              <p className="text-xs text-slate-500">
                New doctors get a default Mon–Fri 09:00–13:00 schedule on
                sign-up, so patients can book with you right away.
              </p>
            </>
          )}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Creating account…" : "Create account"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// Refund retry button (client component). One Failed refund, one
// button: it calls the session-patient retry action and reports
// the result inline. The button disables while the retry is
// pending, so a double click cannot submit twice; the service
// claims the row first, so even a forged double submit cannot
// double-pay.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { retryRefundAction } from "@/lib/actions/payments";
import { Button } from "@/components/ui/button";

export function RefundRetryButton({ refundId }: { refundId: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <p className="text-sm text-slate-600">
        Refund started again — the updated status is shown above.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const result = await retryRefundAction(refundId);
            if (result.ok) {
              setDone(true);
              // Re-read the dashboard from the server so the card
              // shows the refund's new status at once — without
              // this the card kept showing the old "Refund failed"
              // text until a manual reload.
              router.refresh();
            } else {
              setError(result.error ?? "Could not retry the refund.");
            }
          } catch {
            setError("Could not retry the refund.");
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Retrying…" : "Retry refund"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

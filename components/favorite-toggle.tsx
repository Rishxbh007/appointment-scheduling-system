// Favorite toggle for one doctor card (client component so the
// server-action result is visible inline instead of failing
// silently). Rendered only for signed-in patients — the pages that
// use it decide that server-side, so doctors and signed-out
// visitors never see the control at all.
//
// Wording is deliberately plain: "Save" / "Saved" is a bookmark,
// never an endorsement, recommendation, booking, or verification
// of the doctor. The button is disabled while the action runs, so
// a double click cannot double-submit; both server actions are
// idempotent anyway.

"use client";

import { useActionState } from "react";
import {
  addFavoriteAction,
  removeFavoriteAction,
} from "@/lib/actions/favorites";
import { Button } from "@/components/ui/button";

export function FavoriteToggle({
  doctorId,
  doctorName,
  isFavorite,
  savedLabel = "Saved",
}: {
  doctorId: number;
  doctorName: string;
  isFavorite: boolean;
  savedLabel?: string;
}) {
  const [state, dispatch, pending] = useActionState(
    isFavorite ? removeFavoriteAction : addFavoriteAction,
    {},
  );

  return (
    <form action={dispatch} className="flex flex-col items-start gap-1">
      <input type="hidden" name="doctorId" value={doctorId} />
      <Button
        type="submit"
        size="sm"
        variant={isFavorite ? "secondary" : "outline"}
        disabled={pending}
        aria-pressed={isFavorite}
        aria-label={
          isFavorite
            ? `Remove ${doctorName} from favorites`
            : `Save ${doctorName} to favorites`
        }
      >
        {pending
          ? isFavorite
            ? "Removing…"
            : "Saving…"
          : isFavorite
            ? savedLabel
            : "Save"}
      </Button>
      {state.error && (
        <p role="alert" className="text-xs text-red-700">
          {state.error}
        </p>
      )}
    </form>
  );
}

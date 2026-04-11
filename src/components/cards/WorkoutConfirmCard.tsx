"use client";

import { useState } from "react";
import type { SetsJson } from "@/db/schema";

type PRDetection = {
  is_pr: boolean;
  exercise: string;
  new_max_kg: number;
  prev_max_kg: number | null;
};

type ExerciseData = {
  exercise_name: string;
  sets: SetsJson;
  same_as_last_time?: boolean;
};

type ConfirmCardData = {
  exercises: ExerciseData[];
  pr_detections: PRDetection[];
  date: string;
};

type Props = {
  data: Record<string, unknown>;
  userId: number;
  userDate: string;
};

type CardState = "pending" | "saving" | "saved" | "cancelled";

export default function WorkoutConfirmCard({ data, userId, userDate }: Props) {
  const cardData = data as unknown as ConfirmCardData;
  const [state, setState] = useState<CardState>("pending");
  const [expanded, setExpanded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const prs = cardData.pr_detections?.filter((p) => p.is_pr) ?? [];

  async function handleConfirm() {
    if (state !== "pending") return;
    setState("saving");
    setSaveError(null);

    try {
      const res = await fetch("/api/workout/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Date": userDate,
        },
        body: JSON.stringify({ exercises: cardData.exercises, date: cardData.date }),
      });

      if (!res.ok) {
        const err = await res.json();
        setSaveError(err.error ?? "Couldn't save. Retry.");
        setState("pending");
        return;
      }

      setState("saved");
    } catch {
      setSaveError("Network error. Retry.");
      setState("pending");
    }
  }

  function handleCancel() {
    setState("cancelled");
  }

  // Collapsed saved state — 1-line summary
  if (state === "saved" && !expanded) {
    const summary = cardData.exercises
      .map((e) => {
        const sets = e.sets as { actual_reps?: number; actual_weight_kg?: number }[];
        const topSet = sets[0];
        if (!topSet) return e.exercise_name;
        return `${e.exercise_name} ${sets.length}×${topSet.actual_reps} @ ${topSet.actual_weight_kg}kg`;
      })
      .join(", ");

    return (
      <div
        className="rounded-xl bg-neutral-800 px-4 py-2.5 text-sm flex items-center justify-between gap-2 cursor-pointer hover:bg-neutral-700 transition-colors"
        onClick={() => setExpanded(true)}
      >
        <span className="text-neutral-300">✓ {summary}</span>
        <div className="flex gap-1">
          {prs.map((pr) => (
            <span key={pr.exercise} className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-400">
              🏆 PR
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (state === "cancelled") {
    return null;
  }

  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
        <span className="text-sm font-medium">Review session</span>
        <span className="text-xs text-neutral-400">{cardData.date}</span>
      </div>

      {/* Exercises */}
      <div className="divide-y divide-neutral-800">
        {cardData.exercises?.map((exercise, i) => {
          const pr = prs.find((p) => p.exercise === exercise.exercise_name);
          return (
            <div key={i} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium">{exercise.exercise_name}</span>
                {pr && (
                  <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-400">
                    🏆 {pr.prev_max_kg ? `PR! ${pr.new_max_kg}kg (was ${pr.prev_max_kg}kg)` : `First time! ${pr.new_max_kg}kg`}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {(exercise.sets as { actual_weight_kg?: number; actual_reps?: number; duration_min?: number; type: string }[])?.map((set, j) => (
                  <span key={j} className="rounded-lg bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300">
                    {set.type === "cardio"
                      ? `${set.duration_min}min`
                      : `${set.actual_weight_kg}kg × ${set.actual_reps}`}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      {state === "pending" || state === "saving" ? (
        <div className="flex gap-2 px-4 py-3 border-t border-neutral-800">
          <button
            onClick={handleConfirm}
            disabled={state === "saving"}
            className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white
              hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {state === "saving" ? "Saving..." : "Confirm & Save"}
          </button>
          <button
            onClick={handleCancel}
            disabled={state === "saving"}
            className="rounded-lg px-4 py-2 text-sm text-neutral-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {saveError && (
        <p className="px-4 pb-3 text-xs text-red-400">{saveError}</p>
      )}

      {state === "saved" && expanded && (
        <div
          className="px-4 py-3 border-t border-neutral-800 text-xs text-neutral-500 cursor-pointer hover:text-neutral-400"
          onClick={() => setExpanded(false)}
        >
          ✓ Saved — tap to collapse
        </div>
      )}
    </div>
  );
}

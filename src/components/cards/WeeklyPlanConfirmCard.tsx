"use client";

import { useState } from "react";

type Props = {
  data: Record<string, unknown>;
  userId: number;
  userDate: string;
};

export default function WeeklyPlanConfirmCard({ data, userId, userDate }: Props) {
  const [state, setState] = useState<"pending" | "saving" | "saved" | "cancelled">("pending");
  const [saveError, setSaveError] = useState<string | null>(null);

  const plan = data as { week_of: string; days: { day: string; exercises: string[] }[] };

  async function handleConfirm() {
    if (state !== "pending") return;
    setState("saving");
    try {
      const res = await fetch("/api/plan/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Date": userDate },
        body: JSON.stringify(plan),
      });
      if (!res.ok) {
        setSaveError("Couldn't save. Retry.");
        setState("pending");
        return;
      }
      setState("saved");
    } catch {
      setSaveError("Network error. Retry.");
      setState("pending");
    }
  }

  if (state === "cancelled") return null;
  if (state === "saved") {
    return (
      <div className="rounded-xl bg-neutral-800 px-4 py-2.5 text-sm text-neutral-300">
        ✓ Weekly plan saved — week of {plan.week_of}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-800">
        <span className="text-sm font-medium">Weekly training plan</span>
        <span className="ml-2 text-xs text-neutral-400">Week of {plan.week_of}</span>
      </div>

      <div className="divide-y divide-neutral-800">
        {plan.days?.map((day, i) => (
          <div key={i} className="px-4 py-2.5">
            <div className="text-xs font-medium text-neutral-400 mb-1">{day.day}</div>
            <div className="text-sm text-neutral-200">{day.exercises?.join(", ") ?? "Rest"}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 px-4 py-3 border-t border-neutral-800">
        <button
          onClick={handleConfirm}
          disabled={state === "saving"}
          className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
        >
          {state === "saving" ? "Saving..." : "Save Plan"}
        </button>
        <button
          onClick={() => setState("cancelled")}
          className="rounded-lg px-4 py-2 text-sm text-neutral-400 hover:text-white"
        >
          Discard
        </button>
      </div>

      {saveError && <p className="px-4 pb-3 text-xs text-red-400">{saveError}</p>}
    </div>
  );
}

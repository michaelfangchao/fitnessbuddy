"use client";

import { useState } from "react";

type WeightConfirmData = {
  value_kg: number;
  date: string;
  confidence: number;
};

type Props = {
  data: Record<string, unknown>;
  userId: number;
  userDate: string;
  onDismiss?: () => void;
};

export default function WeightConfirmCard({ data, userId, userDate, onDismiss }: Props) {
  const cardData = data as unknown as WeightConfirmData;
  const [date, setDate] = useState(cardData.date ?? userDate);
  const [state, setState] = useState<"pending" | "saving" | "saved" | "cancelled">("pending");
  const [saveError, setSaveError] = useState<string | null>(null);

  const lowConfidence = (cardData.confidence ?? 1) < 0.7;

  async function handleConfirm() {
    if (state !== "pending") return;
    setState("saving");
    try {
      const res = await fetch("/api/measurement/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Date": date,
        },
        body: JSON.stringify({ weight_kg: cardData.value_kg, date }),
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
        ✓ Weight logged — {cardData.value_kg}kg on {date}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-800">
        <span className="text-sm font-medium">Review weight measurement</span>
        {lowConfidence && (
          <span className="ml-2 text-xs text-amber-400">⚠ Low confidence — please verify</span>
        )}
      </div>

      <div className="px-4 py-3 space-y-3">
        <div className="text-2xl font-bold">{cardData.value_kg} kg</div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-400">Date:</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm text-white outline-none focus:ring-1 focus:ring-neutral-600"
          />
        </div>
      </div>

      <div className="flex gap-2 px-4 py-3 border-t border-neutral-800">
        <button
          onClick={handleConfirm}
          disabled={state === "saving"}
          className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
        >
          {state === "saving" ? "Saving..." : "Confirm & Save"}
        </button>
        <button
          onClick={() => { onDismiss ? onDismiss() : setState("cancelled"); }}
          className="rounded-lg px-4 py-2 text-sm text-neutral-400 hover:text-white"
        >
          Cancel
        </button>
      </div>

      {saveError && <p className="px-4 pb-3 text-xs text-red-400">{saveError}</p>}
    </div>
  );
}

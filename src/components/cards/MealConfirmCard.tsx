"use client";

import { useState } from "react";
import type { MealItem } from "@/db/schema";

type MealConfirmData = {
  items: MealItem[];
  total_calories: number;
  total_protein_g: number;
  total_carbs_g: number;
  total_fat_g: number;
  is_asian_cuisine: boolean;
  ai_confidence: number;
  meal_type?: string;
};

type Props = {
  data: Record<string, unknown>;
  userId: number;
  userDate: string;
  onDismiss?: () => void;
};

type CardState = "pending" | "saving" | "saved" | "cancelled";

export default function MealConfirmCard({ data, userId, userDate, onDismiss }: Props) {
  const cardData = data as unknown as MealConfirmData;
  const [state, setState] = useState<CardState>("pending");
  const [saveError, setSaveError] = useState<string | null>(null);

  const lowConfidence = (cardData.ai_confidence ?? 1) < 0.6;

  async function handleConfirm() {
    if (state !== "pending") return;
    setState("saving");
    setSaveError(null);

    try {
      const res = await fetch("/api/meal/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Date": userDate,
        },
        body: JSON.stringify(cardData),
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

  if (state === "cancelled") return null;

  if (state === "saved") {
    return (
      <div className="rounded-xl bg-neutral-800 px-4 py-2.5 text-sm text-neutral-300">
        ✓ Meal logged — {cardData.total_calories} kcal
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-800">
        <span className="text-sm font-medium">Review meal</span>
        {lowConfidence && (
          <span className="ml-2 text-xs text-amber-400">⚠ Low confidence — please verify</span>
        )}
        {cardData.is_asian_cuisine && (
          <span className="ml-2 text-xs text-neutral-400">Asian food — calories may be slightly underestimated</span>
        )}
      </div>

      <div className="px-4 py-3 space-y-1">
        {cardData.items?.map((item, i) => (
          <div key={i} className="flex items-center justify-between text-sm">
            <span className="text-neutral-200">{item.name}</span>
            <span className="text-neutral-400">{item.calories} kcal</span>
          </div>
        ))}
      </div>

      <div className="flex gap-4 px-4 py-2 border-t border-neutral-800 text-xs text-neutral-400">
        <span>Total: <strong className="text-white">{cardData.total_calories}</strong> kcal</span>
        <span>P: {Math.round(cardData.total_protein_g)}g</span>
        <span>C: {Math.round(cardData.total_carbs_g)}g</span>
        <span>F: {Math.round(cardData.total_fat_g)}g</span>
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

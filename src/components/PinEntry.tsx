"use client";

import { useState, useEffect, useRef } from "react";

type Props = {
  user: { id: number; name: string };
  onSuccess: () => void;
  onBack: () => void;
};

export default function PinEntry({ user, onSuccess, onBack }: Props) {
  const [digits, setDigits] = useState<string[]>(["", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState("");
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Countdown timer when locked
  useEffect(() => {
    if (!lockedUntil) return;
    const interval = setInterval(() => {
      const remaining = lockedUntil.getTime() - Date.now();
      if (remaining <= 0) {
        setLockedUntil(null);
        setError(null);
        clearInterval(interval);
        return;
      }
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setCountdown(`${mins}:${secs.toString().padStart(2, "0")}`);
    }, 500);
    return () => clearInterval(interval);
  }, [lockedUntil]);

  // Auto-focus first input
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  async function submitPin(pin: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, pin }),
      });
      if (res.ok) {
        onSuccess();
      } else if (res.status === 423) {
        const data = await res.json();
        setLockedUntil(new Date(data.lockedUntil));
        setError("Too many attempts.");
      } else {
        setError("Wrong PIN. Try again.");
        setDigits(["", "", "", ""]);
        inputRefs.current[0]?.focus();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleDigitChange(index: number, value: string) {
    if (!/^\d?$/.test(value)) return;
    const newDigits = [...digits];
    newDigits[index] = value;
    setDigits(newDigits);
    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }
    if (newDigits.every((d) => d !== "")) {
      submitPin(newDigits.join(""));
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  const isLocked = !!lockedUntil;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-6">
      <button
        onClick={onBack}
        className="absolute left-6 top-6 text-neutral-400 hover:text-white transition-colors"
      >
        ← Back
      </button>

      <div className="text-center">
        <div className="mb-4 text-5xl">{user.name === "FC" ? "👨" : "👩"}</div>
        <h2 className="text-xl font-semibold">{user.name}</h2>
        <p className="mt-1 text-sm text-neutral-400">Enter your 4-digit PIN</p>
      </div>

      <div className="flex gap-3">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { inputRefs.current[i] = el; }}
            type="tel"
            inputMode="numeric"
            maxLength={1}
            value={d}
            onChange={(e) => handleDigitChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            disabled={isLocked || submitting}
            className={`h-14 w-12 rounded-xl border text-center text-xl font-semibold transition-all
              bg-neutral-800 outline-none
              ${isLocked
                ? "border-red-800 text-red-400"
                : error
                ? "border-red-600"
                : "border-neutral-600 focus:border-white"
              }
              disabled:opacity-50`}
          />
        ))}
      </div>

      {isLocked && (
        <p className="text-center text-sm text-red-400">
          {error} Locked for {countdown}.
        </p>
      )}

      {error && !isLocked && (
        <p className="text-center text-sm text-red-400">{error}</p>
      )}

      {submitting && (
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-600 border-t-white" />
      )}
    </div>
  );
}

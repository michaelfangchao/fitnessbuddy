"use client";

import { useRef, useState, useCallback } from "react";
import type { FormEvent } from "react";

// SpeechRecognition is not yet in TypeScript's DOM lib
type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

type UploadResult = {
  type: "meal" | "weight" | "unknown";
  [key: string]: unknown;
};

type Props = {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onUploadResult: (result: UploadResult) => void;
  isLoading: boolean;
  userId: number;
  userDate: string;
};

export default function ChatInput({
  input,
  setInput,
  onSubmit,
  onUploadResult,
  isLoading,
  userId,
  userDate,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Auto-resize textarea
  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isLoading) {
        const form = e.currentTarget.closest("form");
        form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
    }
  }

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset file input so same file can be re-selected
    e.target.value = "";

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch("/api/upload", {
        method: "POST",
        headers: {
          "X-User-Date": userDate,
          // Note: do NOT set Content-Type — browser sets multipart boundary automatically
        },
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        alert(err.error ?? "Upload failed. Please try again.");
        return;
      }

      const result = await res.json() as UploadResult;
      onUploadResult(result);
    } catch {
      alert("Upload failed. Please check your connection and try again.");
    } finally {
      setIsUploading(false);
    }
  }

  const startVoice = useCallback(() => {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Voice input requires a modern browser with speech recognition support.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      setInput(transcript);
      setIsRecording(false);
    };

    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);

    recognition.start();
    recognitionRef.current = recognition;
    setIsRecording(true);
  }, [setInput]);

  function stopVoice() {
    recognitionRef.current?.stop();
    setIsRecording(false);
  }

  const hasSpeechSupport =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const isBusy = isLoading || isUploading;

  return (
    <form onSubmit={onSubmit} className="border-t border-neutral-800 px-4 py-3">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoSelect}
        disabled={isBusy}
      />

      <div className="flex items-end gap-2">
        {/* Photo upload button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isBusy}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-neutral-800
            text-neutral-400 transition-colors hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
          title="Upload a meal photo or Apple Health screenshot"
        >
          {isUploading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-600 border-t-white" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          )}
        </button>

        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Log a workout, meal, or ask anything..."
          rows={1}
          disabled={isBusy}
          className="flex-1 resize-none rounded-xl bg-neutral-800 px-4 py-2.5 text-sm text-neutral-100
            placeholder-neutral-500 outline-none focus:ring-1 focus:ring-neutral-600
            disabled:opacity-50 min-h-[40px] max-h-[140px] overflow-y-auto"
          style={{ height: "40px" }}
        />

        {hasSpeechSupport && (
          <button
            type="button"
            onClick={isRecording ? stopVoice : startVoice}
            disabled={isBusy && !isRecording}
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl transition-colors
              ${isRecording
                ? "bg-red-600 text-white animate-pulse"
                : "bg-neutral-800 text-neutral-400 hover:text-white disabled:opacity-40"
              }`}
          >
            🎤
          </button>
        )}

        <button
          type="submit"
          disabled={!input.trim() || isBusy}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-600
            text-white transition-all hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ↑
        </button>
      </div>
    </form>
  );
}

"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import ChatMessage from "./ChatMessage";
import ChatInput from "./ChatInput";
import MealConfirmCard from "./cards/MealConfirmCard";
import WeightConfirmCard from "./cards/WeightConfirmCard";

type User = {
  id: number;
  name: string;
  goal: string | null;
  gender: string | null;
  timezone: string;
};

type Props = {
  user: User;
  streak: number;
  pendingDigest?: string | null;
};

type UploadPending =
  | { type: "meal"; data: Record<string, unknown> }
  | { type: "weight"; data: Record<string, unknown> }
  | null;

export default function ChatInterface({ user, streak, pendingDigest }: Props) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [uploadPending, setUploadPending] = useState<UploadPending>(null);
  const [showDigest, setShowDigest] = useState(!!pendingDigest);

  // Client's local date for X-User-Date header
  const userDate = useMemo(() => new Date().toLocaleDateString("en-CA"), []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: { "X-User-Date": userDate },
      }),
    [userDate]
  );

  const { messages, sendMessage, status, error } = useChat({
    transport,
    onError: (err) => {
      if (err.message.includes("401")) {
        router.push("/");
      }
    },
  });

  const isLoading = status === "submitted" || status === "streaming";

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, uploadPending]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    await sendMessage({ text });
  }

  function handleUploadResult(result: { type: string; [key: string]: unknown }) {
    if (result.type === "meal") {
      setUploadPending({ type: "meal", data: result as Record<string, unknown> });
    } else if (result.type === "weight") {
      setUploadPending({ type: "weight", data: result as Record<string, unknown> });
    } else {
      // unknown image
      alert("I couldn't identify this image as a meal or health screenshot. Try a clearer photo.");
    }
  }

  async function dismissDigest() {
    setShowDigest(false);
    // Mark as shown
    await fetch("/api/digest/dismiss", { method: "POST" }).catch(() => {});
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="font-semibold">{user.name}</span>
          {streak > 0 && (
            <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-xs font-medium text-orange-400">
              🔥 {streak}w streak
            </span>
          )}
        </div>
        <button
          onClick={handleLogout}
          className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          Switch user
        </button>
      </header>

      {/* Weekly Digest Banner */}
      {showDigest && pendingDigest && (
        <div className="border-b border-neutral-800 bg-neutral-900 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="mb-1 text-xs font-medium text-neutral-400">Weekly Summary</p>
              <p className="text-sm text-neutral-200">{pendingDigest}</p>
            </div>
            <button
              onClick={dismissDigest}
              className="mt-0.5 flex-shrink-0 text-neutral-500 hover:text-neutral-300"
              aria-label="Dismiss digest"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="chat-scroll flex-1 overflow-y-auto px-4 py-4 space-y-4"
      >
        {messages.length === 0 && !uploadPending && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-neutral-500">
              Hey {user.name}! Ready to train? Tell me what you did or what you&apos;re planning.
            </p>
          </div>
        )}

        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            userId={user.id}
            userDate={userDate}
          />
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 text-neutral-400">
            <div className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:300ms]" />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
            {error.message.includes("busy")
              ? "Service busy — try again in a moment."
              : error.message.includes("credit") || error.message.includes("balance")
              ? "AI service unavailable — check your Anthropic API billing."
              : "Something went wrong. Please try again."}
          </div>
        )}

        {/* Photo upload confirm cards — shown inline after messages */}
        {uploadPending?.type === "meal" && (
          <MealConfirmCard
            data={uploadPending.data}
            userId={user.id}
            userDate={userDate}
            onDismiss={() => setUploadPending(null)}
          />
        )}
        {uploadPending?.type === "weight" && (
          <WeightConfirmCard
            data={uploadPending.data}
            userId={user.id}
            userDate={userDate}
            onDismiss={() => setUploadPending(null)}
          />
        )}
      </div>

      {/* Input */}
      <ChatInput
        input={input}
        setInput={setInput}
        onSubmit={handleSubmit}
        onUploadResult={handleUploadResult}
        isLoading={isLoading}
        userId={user.id}
        userDate={userDate}
      />
    </div>
  );
}

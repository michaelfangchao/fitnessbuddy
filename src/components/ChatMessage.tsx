"use client";

import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import WorkoutConfirmCard from "./cards/WorkoutConfirmCard";
import MealConfirmCard from "./cards/MealConfirmCard";
import WeightConfirmCard from "./cards/WeightConfirmCard";
import WeeklyPlanConfirmCard from "./cards/WeeklyPlanConfirmCard";
import ProgressionChart from "./cards/ProgressionChart";

type Props = {
  message: UIMessage;
  userId: number;
  userDate: string;
};

type DynamicToolPart = {
  type: "dynamic-tool";
  toolName: string;
  toolCallId: string;
  state: string;
  output?: unknown;
  input?: unknown;
};

export default function ChatMessage({ message, userId, userDate }: Props) {
  const isUser = message.role === "user";

  if (isUser) {
    const textPart = message.parts.find((p) => p.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-blue-600 px-4 py-2 text-sm">
          {textPart?.text ?? ""}
        </div>
      </div>
    );
  }

  // Assistant message — render parts
  return (
    <div className="flex flex-col gap-2">
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          const textPart = part as { type: "text"; text: string };
          if (!textPart.text) return null;
          return (
            <div key={i} className="max-w-[90%] text-sm leading-relaxed text-neutral-100">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => <p className="font-semibold text-white mb-1">{children}</p>,
                  h2: ({ children }) => <p className="font-semibold text-white mb-1">{children}</p>,
                  h3: ({ children }) => <p className="font-semibold text-white mb-1">{children}</p>,
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                  em: ({ children }) => <em className="italic text-neutral-300">{children}</em>,
                  ul: ({ children }) => <ul className="mb-2 space-y-1 pl-4">{children}</ul>,
                  ol: ({ children }) => <ol className="mb-2 space-y-1 pl-4 list-decimal">{children}</ol>,
                  li: ({ children }) => <li className="list-disc marker:text-neutral-500">{children}</li>,
                  hr: () => <hr className="my-3 border-neutral-700" />,
                  code: ({ children }) => <code className="rounded bg-neutral-800 px-1 py-0.5 text-xs font-mono text-neutral-200">{children}</code>,
                  pre: ({ children }) => <pre className="mb-2 overflow-x-auto rounded-lg bg-neutral-800 p-3 text-xs font-mono">{children}</pre>,
                }}
              >
                {textPart.text}
              </ReactMarkdown>
            </div>
          );
        }

        if (part.type === "dynamic-tool") {
          const toolPart = part as DynamicToolPart;
          if (toolPart.state !== "output-available" || !toolPart.output) return null;

          const result = toolPart.output as Record<string, unknown>;
          const key = `${message.id}-${i}`;

          switch (toolPart.toolName) {
            case "log_workout":
              if (result.type !== "workout_confirm") return null;
              return (
                <WorkoutConfirmCard key={key} data={result} userId={userId} userDate={userDate} />
              );
            case "log_meal":
              if (result.type !== "meal_confirm") return null;
              return (
                <MealConfirmCard key={key} data={result} userId={userId} userDate={userDate} />
              );
            case "log_body_measurement":
              // Auto-save — no confirm card
              return null;
            case "generate_weekly_plan":
              return (
                <WeeklyPlanConfirmCard key={key} data={result} userId={userId} userDate={userDate} />
              );
            case "query_progression":
            case "get_body_stats":
              return result.type === "chart" ? (
                <ProgressionChart key={key} data={result} />
              ) : null;
            default:
              return null;
          }
        }

        return null;
      })}
    </div>
  );
}

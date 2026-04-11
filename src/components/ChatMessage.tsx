"use client";

import type { UIMessage } from "ai";
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
              {textPart.text}
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
              return (
                <WorkoutConfirmCard key={key} data={result} userId={userId} userDate={userDate} />
              );
            case "log_meal":
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

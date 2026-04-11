"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type DataPoint = {
  date: string;
  peak_weight: number;
};

type ChartData = {
  type: "chart";
  exercise: string;
  unit: string;
  data: DataPoint[];
};

type Props = {
  data: Record<string, unknown>;
};

export default function ProgressionChart({ data }: Props) {
  const chart = data as unknown as ChartData;

  if (!chart.data?.length) return null;

  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-4">
      <div className="mb-3 text-sm font-medium">{chart.exercise} progression</div>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={chart.data} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "#737373" }}
            tickFormatter={(d) => d.slice(5)} // MM-DD
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#737373" }}
            unit={chart.unit === "kg" ? "kg" : ""}
          />
          <Tooltip
            contentStyle={{ background: "#171717", border: "1px solid #404040", borderRadius: 8 }}
            labelStyle={{ color: "#a3a3a3", fontSize: 11 }}
            itemStyle={{ color: "#e5e5e5", fontSize: 12 }}
            formatter={(v) => [`${v}${chart.unit}`, "Peak weight"]}
          />
          <Line
            type="monotone"
            dataKey="peak_weight"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 3, fill: "#3b82f6" }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

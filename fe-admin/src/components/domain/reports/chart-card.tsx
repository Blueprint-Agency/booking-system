"use client";

import { lazy, Suspense, type ReactNode } from "react";

const Chart = lazy(async () => {
  const recharts = await import("recharts");
  return {
    default: function ChartImpl({
      data,
      kind,
      yKey,
    }: {
      data: { x: string; y: number }[];
      kind: "line" | "bar";
      yKey?: string;
    }) {
      const { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } = recharts;
      const dataKey = yKey ?? "y";
      return (
        <ResponsiveContainer width="100%" height={180}>
          {kind === "line" ? (
            <LineChart data={data} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6dfd0" />
              <XAxis dataKey="x" tick={{ fontSize: 10, fill: "#7a6e58" }} />
              <YAxis tick={{ fontSize: 10, fill: "#7a6e58" }} />
              <Tooltip />
              <Line type="monotone" dataKey={dataKey} stroke="#c4673b" strokeWidth={2} dot={false} />
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6dfd0" />
              <XAxis dataKey="x" tick={{ fontSize: 10, fill: "#7a6e58" }} />
              <YAxis tick={{ fontSize: 10, fill: "#7a6e58" }} />
              <Tooltip />
              <Bar dataKey={dataKey} fill="#92ad7d" />
            </BarChart>
          )}
        </ResponsiveContainer>
      );
    },
  };
});

export interface ChartCardProps {
  title: string;
  description?: string;
  data: { x: string; y: number }[];
  kind?: "line" | "bar";
  footer?: ReactNode;
}

export function ChartCard({ title, description, data, kind = "line", footer }: ChartCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      <div className="mt-3">
        <Suspense fallback={<div className="h-[180px] animate-pulse rounded bg-paper/40" />}>
          <Chart data={data} kind={kind} />
        </Suspense>
      </div>
      {footer && <div className="mt-2 text-xs text-muted">{footer}</div>}
    </div>
  );
}

"use client";

import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { changeReason, fmtChange, fmtCompact, fmtMonth, fmtNumber } from "@/lib/format";
import type { SeriesResponse } from "@/lib/types";

// Fixed categorical order: colour follows the series' position in the user's selection.
export const SERIES_COLORS = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);

const axisStyle = { fontSize: 12, fill: "var(--text-muted)" };

type Mode = "value" | "yoy";

export function TrendChart({ data, unit }: { data: SeriesResponse; unit: string }) {
  const [mode, setMode] = useState<Mode>("value");
  const [showTable, setShowTable] = useState(false);

  const rows = data.months.map((month, i) => {
    const row: Record<string, number | string | null> = { month };
    for (const s of data.series) {
      const p = s.points[i];
      row[s.origin] = mode === "value" ? p.value : p.yoy.status === "ok" ? p.yoy.value : null;
      row[`${s.origin}__status`] = p.value_status;
    }
    return row;
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-line p-0.5 text-xs" role="radiogroup" aria-label="Chart measure">
          {([["value", `Monthly ${unit}`], ["yoy", "Change vs same month last year"]] as const).map(([m, label]) => (
            <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
              className={`rounded-md px-2.5 py-1 ${mode === m ? "bg-sunken font-medium text-ink" : "text-ink-2"}`}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => setShowTable((v) => !v)} className="text-xs text-accent underline">
          {showTable ? "Show chart" : "Show as table"}
        </button>
      </div>

      {showTable ? (
        <TrendTable data={data} />
      ) : (
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="month" tickFormatter={fmtMonth} tick={axisStyle} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={24} />
              <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={56}
                tickFormatter={(v: number) => (mode === "yoy" ? `${v}%` : fmtCompact(v))} />
              {mode === "yoy" && <ReferenceLine y={0} stroke="var(--text-muted)" />}
              <Tooltip
                contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                labelFormatter={(m) => fmtMonth(String(m))}
                formatter={(v, name, item) => {
                  const status = (item.payload as Record<string, string>)[`${name}__status`];
                  const text = v === null || v === undefined ? "missing" : mode === "yoy" ? `${Number(v).toFixed(1)}%` : fmtNumber(Number(v));
                  return [status && status !== "final" ? `${text} (${status})` : text, name];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {data.series.map((s, i) => (
                <Line key={s.origin} dataKey={s.origin} name={s.origin} type="linear"
                  stroke={SERIES_COLORS[i % 8]} strokeWidth={2} connectNulls={false} isAnimationActive={false}
                  dot={(props) => {
                    const { cx, cy, payload, index } = props as { cx: number; cy: number; payload: Record<string, unknown>; index: number };
                    const status = payload[`${s.origin}__status`];
                    if (cx == null || cy == null || payload[s.origin] == null) return <g key={index} />;
                    // Estimates / provisional values get a hollow marker.
                    return status && status !== "final"
                      ? <circle key={index} cx={cx} cy={cy} r={3.5} fill="var(--surface-raised)" stroke={SERIES_COLORS[i % 8]} strokeWidth={1.5} />
                      : <g key={index} />;
                  }}
                  activeDot={{ r: 4 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-2 text-xs text-ink-3">
        Gaps in a line are months with no published value (missing, not zero). Hollow markers are provisional or
        estimated figures. Year-over-year change is only shown when the same month a year earlier exists.
      </p>
    </div>
  );
}

function TrendTable({ data }: { data: SeriesResponse }) {
  return (
    <div className="max-h-96 overflow-auto rounded-lg border border-line">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-sunken text-ink-2">
          <tr>
            <th className="px-3 py-2 font-medium">Month</th>
            {data.series.map((s) => <th key={s.origin} className="px-3 py-2 font-medium" colSpan={2}>{s.origin}</th>)}
          </tr>
        </thead>
        <tbody className="num">
          {data.months.map((m, i) => (
            <tr key={m} className="border-t border-line">
              <td className="px-3 py-1.5 text-ink-2">{fmtMonth(m)}</td>
              {data.series.map((s) => {
                const p = s.points[i];
                return [
                  <td key={s.origin + "v"} className="px-3 py-1.5 text-right text-ink">
                    {fmtNumber(p.value)}{p.value_status && p.value_status !== "final" ? "*" : ""}
                  </td>,
                  <td key={s.origin + "y"} className="px-3 py-1.5 text-right text-ink-3" title={changeReason(p.yoy)}>{fmtChange(p.yoy)}</td>,
                ];
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-xs text-ink-3">* provisional or estimate. Second column per origin: change vs same month last year (— = not comparable).</p>
    </div>
  );
}

/** Horizontal bars for one measure across categories (single hue: magnitude, not identity). */
export function HBarChart({ rows, valueLabel, format = fmtNumber }: {
  rows: { label: string; value: number }[]; valueLabel: string; format?: (n: number) => string;
}) {
  return (
    <div style={{ height: Math.max(120, rows.length * 34 + 40) }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
          <CartesianGrid stroke="var(--grid)" horizontal={false} />
          <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} tickFormatter={(v: number) => format(v)} />
          <YAxis type="category" dataKey="label" tick={axisStyle} tickLine={false} axisLine={false} width={230} interval={0}
            tickFormatter={(l: string) => (l.length > 34 ? `${l.slice(0, 33)}…` : l)} />
          <Tooltip cursor={{ fill: "var(--surface-sunken)" }}
            contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            formatter={(v) => [format(Number(v)), valueLabel]} />
          <Bar dataKey="value" fill="var(--series-1)" radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

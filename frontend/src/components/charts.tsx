"use client";

import { useState, useSyncExternalStore } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { changeReason, fmtChange, fmtCompact, fmtMonth, fmtNumber } from "@/lib/format";
import type { SeriesResponse, SpendingHistory } from "@/lib/types";

// Fixed categorical order: colour follows the series' position in the user's selection.
export const SERIES_COLORS = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);

const axisStyle = { fontSize: 13, fill: "var(--ink-3)" };

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
        <div className="inline-flex rounded-lg border border-line bg-paper p-0.5 text-sm" role="radiogroup" aria-label="Chart measure">
          {([["value", unit === "persons" ? "Number of visitors" : `Monthly ${unit}`], ["yoy", "Change vs same month last year"]] as const).map(([m, label]) => (
            <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1 ${mode === m ? "bg-raised font-bold text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => setShowTable((v) => !v)} className="text-sm font-medium text-route underline underline-offset-2">
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
              {mode === "yoy" && <ReferenceLine y={0} stroke="var(--ink-3)" />}
              <Tooltip
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
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
                      ? <circle key={index} cx={cx} cy={cy} r={3.5} fill="var(--surface)" stroke={SERIES_COLORS[i % 8]} strokeWidth={1.5} />
                      : <g key={index} />;
                  }}
                  activeDot={{ r: 4 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <ul className="mt-3 space-y-0.5 text-xs text-ink-3">
        <li>A gap in a line means no figure was published that month. It is not zero.</li>
        <li>Hollow dots are early estimates that may change.</li>
      </ul>
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
      <p className="px-3 py-2 text-xs text-ink-3">* early estimate. The second column for each country is the change against the same month last year; “—” means there is nothing to compare with.</p>
    </div>
  );
}

const WIDE = "(min-width: 640px)";
function useWide() {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(WIDE); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia(WIDE).matches,
    () => true);
}

/** Horizontal bars for one measure across categories (single hue: magnitude, not identity). */
export function HBarChart({ rows, valueLabel, format = fmtNumber }: {
  rows: { label: string; value: number }[]; valueLabel: string; format?: (n: number) => string;
}) {
  // Phones get a narrower label column so the bars keep room to be compared.
  const wide = useWide();
  const maxChars = wide ? 34 : 18;
  return (
    <div style={{ height: Math.max(120, rows.length * 34 + 40) }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
          <CartesianGrid stroke="var(--grid)" horizontal={false} />
          <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} tickFormatter={(v: number) => format(v)} />
          <YAxis type="category" dataKey="label" tick={axisStyle} tickLine={false} axisLine={false} width={wide ? 230 : 130} interval={0}
            tickFormatter={(l: string) => (l.length > maxChars ? `${l.slice(0, maxChars - 1)}…` : l)} />
          <Tooltip cursor={{ fill: "var(--sunken)" }}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            formatter={(v) => [format(Number(v)), valueLabel]} />
          <Bar dataKey="value" fill="var(--route)" radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** "2026-Q2" -> "2026 Q2"; the axis shows the year at each first quarter. */
const quarterLabel = (p: string) => p.replace("-", " ");

function quarterGrid(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, q] = first.split("-Q").map(Number);
  const [ly, lq] = last.split("-Q").map(Number);
  while (y < ly || (y === ly && q <= lq)) {
    out.push(`${y}-Q${q}`);
    [y, q] = q === 4 ? [y + 1, 1] : [y, q + 1];
  }
  return out;
}

/**
 * Category spending per visitor over the long run. Each survey design is drawn as its own
 * line segment (same colour per category), so a line never joins figures from two designs,
 * and quarters without a survey stay empty.
 */
export function HistoryChart({ data, only }: { data: SpendingHistory; only: string | null }) {
  const all = data.designs.flatMap((d) => d.points.map((p) => p.period));
  if (all.length === 0) return null;
  const grid = quarterGrid(all.reduce((a, b) => (a < b ? a : b)), all.reduce((a, b) => (a > b ? a : b)));
  const cats = data.categories.filter((c) => !only || c.key === only);
  const rows = grid.map((period) => {
    const row: Record<string, string | number | null> = { period };
    data.designs.forEach((d, di) => {
      const point = d.points.find((p) => p.period === period);
      for (const c of cats) row[`${c.key}@${di}`] = point?.values[c.key] ?? null;
    });
    return row;
  });
  const breaks = data.designs.slice(1).map((d) => d.points[0]?.period).filter(Boolean) as string[];
  const last = data.designs.length - 1;
  return (
    <div className="h-96 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 24, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="period" tick={axisStyle} tickLine={false} axisLine={{ stroke: "var(--border)" }}
            interval={0} tickFormatter={(p: string) => (p.endsWith("Q1") ? p.slice(0, 4) : "")} />
          <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={64}
            tickFormatter={(v: number) => `¥${fmtCompact(v)}`} />
          {data.gaps.map((g) => (
            <ReferenceArea key={g.from} x1={g.from} x2={g.to} fill="var(--sunken)" fillOpacity={0.8}
              label={{ value: "No survey (COVID-19)", position: "insideTop", fontSize: 12, fill: "var(--ink-3)" }} />
          ))}
          {breaks.map((b) => (
            <ReferenceLine key={b} x={b} stroke="var(--ink-3)" strokeDasharray="4 4"
              label={{ value: "Survey changed", position: "top", fontSize: 12, fill: "var(--ink-3)" }} />
          ))}
          <Tooltip
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            labelFormatter={(p) => quarterLabel(String(p))}
            formatter={(v, name) => [v == null ? "no survey" : `¥${fmtNumber(Number(v))}`, String(name)]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {data.designs.flatMap((_, di) => cats.map((c) => (
            <Line key={`${c.key}@${di}`} dataKey={`${c.key}@${di}`} name={c.label} type="linear"
              stroke={SERIES_COLORS[data.categories.findIndex((x) => x.key === c.key) % 8]} strokeWidth={2}
              dot={false} connectNulls={false} isAnimationActive={false}
              legendType={di === last ? "line" : "none"} />
          )))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

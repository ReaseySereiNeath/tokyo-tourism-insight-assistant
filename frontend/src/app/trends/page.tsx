"use client";

import { useMemo, useState } from "react";
import { TrendChart } from "@/components/charts";
import { useScope } from "@/components/providers";
import { Badge, Card, EmptyState, ErrorState, EvidenceLink, inputClass, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { changeReason, fmtChange, fmtMonth, fmtNumber, humanize } from "@/lib/format";
import type { CatalogEntry, ComparisonRow, SeriesResponse } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const MAX_ORIGINS = 8;
const keyOf = (c: CatalogEntry) => [c.geography, c.metric, c.unit, c.source].join("|");

export default function TrendsPage() {
  const { scope } = useScope();
  return <TrendsContent key={scope} />;
}

function TrendsContent() {
  const { scope } = useScope();
  const catalog = useApi(() => api.get<CatalogEntry[]>("/api/visitor-stats/catalog", scope), [scope]);
  const [seriesKey, setSeriesKey] = useState<string>("");
  const selected = catalog.data?.find((c) => keyOf(c) === seriesKey) ?? catalog.data?.[0];

  return (
    <>
      <PageHeader title="Visitor trends"
        description="Monthly visitor statistics by origin. One series at a time: different geographies and sources are never combined." />
      {catalog.loading && <Loading />}
      {catalog.error && <ErrorState message={catalog.error} onRetry={catalog.reload} />}
      {catalog.data && catalog.data.length === 0 && (
        <EmptyState title="No visitor statistics imported">Import the JNTO workbook or a visitor-statistics CSV on Sources &amp; imports.</EmptyState>
      )}
      {selected && (
        <div className="space-y-6">
          <Card>
            <label className="block text-xs font-medium text-ink-2" htmlFor="series">Statistics series</label>
            <select id="series" className={`${inputClass} mt-1 w-full max-w-xl`} value={keyOf(selected)} onChange={(e) => setSeriesKey(e.target.value)}>
              {catalog.data!.map((c) => (
                <option key={keyOf(c)} value={keyOf(c)}>
                  {c.geography} · {humanize(c.metric)} ({c.unit}) · {c.source} · {c.first_month} to {c.last_month}
                </option>
              ))}
            </select>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Badge tone="info">Geography: {selected.geography}</Badge>
              {selected.non_final_records > 0 && <Badge tone="warn">{selected.non_final_records} provisional/estimated values</Badge>}
            </div>
            <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-ink-3">
              {selected.geography.toLowerCase().startsWith("japan") && <li>These are arrivals to all of Japan, not visitors to Tokyo.</li>}
              <li>Origin is nationality or residence as defined by the source. It does not tell you which tour language a visitor prefers.</li>
            </ul>
          </Card>
          <SeriesExplorer key={keyOf(selected) + scope} entry={selected} />
        </div>
      )}
    </>
  );
}

function SeriesExplorer({ entry }: { entry: CatalogEntry }) {
  const { scope } = useScope();
  const params = { geography: entry.geography, metric: entry.metric, unit: entry.unit, source: entry.source };
  const origins = useApi(
    () => api.get<{ visitor_origin: string; origin_level: string; months: number }[]>("/api/visitor-stats/origins", scope, params),
    [scope, entry.geography, entry.metric, entry.unit, entry.source]);
  const compare = useApi(
    () => api.get<{ month: string; comparison_month: string; total: number | null; rows: ComparisonRow[]; comparable_count: number }>(
      "/api/visitor-stats/compare", scope, { ...params, level: "country" }),
    [scope, entry.geography, entry.metric, entry.unit, entry.source]);

  const defaultStart = useMemo(() => {
    const [y, m] = entry.last_month.split("-").map(Number);
    const start = `${y - 3}-${String(m).padStart(2, "0")}`;
    return start < entry.first_month ? entry.first_month : start;
  }, [entry]);
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(entry.last_month);
  // null = the user has not picked yet: default to the five largest origins in the latest month.
  const [picked, setPicked] = useState<string[] | null>(null);
  const defaults = compare.data?.rows.length
    ? compare.data.rows.slice(0, 5).map((r) => r.visitor_origin)
    : (origins.data ?? []).slice(0, 3).map((o) => o.visitor_origin);
  const chosen = picked ?? defaults;

  const series = useApi(
    () => chosen.length ? api.get<SeriesResponse>("/api/visitor-stats/series", scope, { ...params, origins: chosen, start, end }) : Promise.resolve(null),
    [scope, chosen.join(","), start, end]);

  const toggle = (o: string) =>
    setPicked(chosen.includes(o) ? chosen.filter((x) => x !== o) : chosen.length >= MAX_ORIGINS ? chosen : [...chosen, o]);

  return (
    <>
      <Card title="Monthly trend" subtitle={`Up to ${MAX_ORIGINS} origins. Reporting period ${fmtMonth(start)} – ${fmtMonth(end)}.`}>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-ink-2">From
            <input type="month" className={`${inputClass} ml-2`} value={start} min={entry.first_month} max={end} onChange={(e) => e.target.value && setStart(e.target.value)} />
          </label>
          <label className="text-xs text-ink-2">To
            <input type="month" className={`${inputClass} ml-2`} value={end} min={start} max={entry.last_month} onChange={(e) => e.target.value && setEnd(e.target.value)} />
          </label>
        </div>
        {origins.data && (
          <div className="mb-4 flex flex-wrap gap-1.5" aria-label="Visitor origins">
            {origins.data.map((o) => {
              const idx = chosen.indexOf(o.visitor_origin);
              return (
                <button key={o.visitor_origin} onClick={() => toggle(o.visitor_origin)} aria-pressed={idx >= 0}
                  disabled={idx < 0 && chosen.length >= MAX_ORIGINS}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs disabled:opacity-40 ${idx >= 0 ? "border-ink-3 bg-sunken text-ink" : "border-line text-ink-2"}`}>
                  {idx >= 0 && <span className="h-2 w-2 rounded-full" style={{ background: `var(--series-${idx + 1})` }} />}
                  {o.visitor_origin}
                  {o.origin_level !== "country" && <span className="text-ink-3">({o.origin_level})</span>}
                </button>
              );
            })}
          </div>
        )}
        {series.loading && <Loading />}
        {series.error && <ErrorState message={series.error} onRetry={series.reload} />}
        {!series.loading && chosen.length === 0 && <EmptyState title="Select at least one origin" />}
        {series.data && series.data.series.length > 0 && <TrendChart data={series.data} unit={entry.unit} />}
        {series.data && series.data.series.some((s) => s.months_missing > 0) && (
          <p className="mt-2 text-xs text-ink-2">
            Missing months: {series.data.series.filter((s) => s.months_missing > 0).map((s) => `${s.origin} (${s.months_missing})`).join(", ")}.
          </p>
        )}
      </Card>

      <Card title="Compare origins" subtitle={compare.data ? `${fmtMonth(compare.data.month)} vs ${fmtMonth(compare.data.comparison_month)} · country level · ${compare.data.comparable_count} of ${compare.data.rows.length} comparable` : undefined}>
        {compare.loading && <Loading />}
        {compare.error && <ErrorState message={compare.error} onRetry={compare.reload} />}
        {compare.data && compare.data.rows.length === 0 && <EmptyState title="No country-level rows for the latest month" />}
        {compare.data && compare.data.rows.length > 0 && (
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-raised text-left text-xs text-ink-3">
                <tr>
                  <th className="py-2 font-medium">Origin</th>
                  <th className="py-2 text-right font-medium">{fmtMonth(compare.data.month)}</th>
                  <th className="py-2 text-right font-medium">Share of total</th>
                  <th className="py-2 text-right font-medium">{fmtMonth(compare.data.comparison_month)}</th>
                  <th className="py-2 text-right font-medium">YoY</th>
                  <th className="py-2 pl-3 font-medium">Status</th>
                  <th className="py-2 pl-3 font-medium">Evidence</th>
                </tr>
              </thead>
              <tbody className="num">
                {compare.data.rows.map((r) => (
                  <tr key={r.visitor_origin} className="border-t border-line">
                    <td className="py-1.5 text-ink">{r.visitor_origin}</td>
                    <td className="py-1.5 text-right text-ink">{fmtNumber(r.value)}</td>
                    <td className="py-1.5 text-right text-ink-2">{r.share_of_total_pct === null ? "—" : `${r.share_of_total_pct}%`}</td>
                    <td className="py-1.5 text-right text-ink-2">{fmtNumber(r.value_last_year)}</td>
                    <td className="py-1.5 text-right font-medium text-ink" title={changeReason(r.yoy)}>{fmtChange(r.yoy)}</td>
                    <td className="py-1.5 pl-3">{r.value_status !== "final" ? <Badge tone="warn">{r.value_status}</Badge> : <span className="text-xs text-ink-3">final</span>}</td>
                    <td className="py-1.5 pl-3"><EvidenceLink id={r.evidence_id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

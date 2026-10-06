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
      <PageHeader title="Visitors"
        description="Official monthly arrivals, broken down by the country visitors come from. Use it to see which markets are growing or shrinking." />
      {catalog.loading && <Loading />}
      {catalog.error && <ErrorState message={catalog.error} onRetry={catalog.reload} />}
      {catalog.data && catalog.data.length === 0 && (
        <EmptyState title="No visitor statistics yet" href="/sources" action="Add your data">
          Import the JNTO monthly workbook or a visitor-statistics CSV.
        </EmptyState>
      )}
      {selected && (
        <div className="space-y-6">
          <Card>
            <label className="block text-sm font-bold text-ink" htmlFor="series">Which statistics</label>
            <select id="series" className={`${inputClass} mt-1 w-full max-w-xl`} value={keyOf(selected)} onChange={(e) => setSeriesKey(e.target.value)}>
              {catalog.data!.map((c) => (
                <option key={keyOf(c)} value={keyOf(c)}>
                  {c.geography}: {humanize(c.metric).toLowerCase()} from {c.source}, {fmtMonth(c.first_month)} to {fmtMonth(c.last_month)}
                </option>
              ))}
            </select>
            <ul className="mt-4 max-w-2xl space-y-1.5 text-sm text-ink-2">
              {selected.geography.toLowerCase().startsWith("japan") && <li>These are arrivals to <strong className="text-ink">all of Japan</strong>, not only Tokyo.</li>}
              {selected.non_final_records > 0 && <li>{fmtNumber(selected.non_final_records)} figures are early estimates and may still change. They show as hollow dots on the chart.</li>}
              <li>“Country” is nationality or residence as the source defines it. It doesn&apos;t tell you which tour language someone prefers.</li>
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
      <Card title="Month by month" subtitle={`Pick up to ${MAX_ORIGINS} countries to compare. Showing ${fmtMonth(start)} to ${fmtMonth(end)}.`}>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="text-sm text-ink-2">From
            <input type="month" className={`${inputClass} ml-2`} value={start} min={entry.first_month} max={end} onChange={(e) => e.target.value && setStart(e.target.value)} />
          </label>
          <label className="text-sm text-ink-2">To
            <input type="month" className={`${inputClass} ml-2`} value={end} min={start} max={entry.last_month} onChange={(e) => e.target.value && setEnd(e.target.value)} />
          </label>
        </div>
        {origins.data && (
          <div className="mb-5 flex flex-wrap gap-1.5" aria-label="Countries">
            {origins.data.map((o) => {
              const idx = chosen.indexOf(o.visitor_origin);
              return (
                <button key={o.visitor_origin} onClick={() => toggle(o.visitor_origin)} aria-pressed={idx >= 0}
                  disabled={idx < 0 && chosen.length >= MAX_ORIGINS}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm disabled:opacity-40 ${idx >= 0 ? "border-ink bg-raised font-bold text-ink" : "border-line text-ink-2 hover:border-ink-3"}`}>
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
        {!series.loading && chosen.length === 0 && <EmptyState title="Pick at least one country above" />}
        {series.data && series.data.series.length > 0 && <TrendChart data={series.data} unit={entry.unit} />}
        {series.data && series.data.series.some((s) => s.months_missing > 0) && (
          <p className="mt-2 text-sm text-ink-2">
            Months with no published figure: {series.data.series.filter((s) => s.months_missing > 0).map((s) => `${s.origin} (${s.months_missing})`).join(", ")}.
          </p>
        )}
      </Card>

      <Card title="Every country, compared with last year"
        subtitle={compare.data ? `${fmtMonth(compare.data.month)} against ${fmtMonth(compare.data.comparison_month)}. ${compare.data.comparable_count} of ${compare.data.rows.length} countries have figures for both months.` : undefined}>
        {compare.loading && <Loading />}
        {compare.error && <ErrorState message={compare.error} onRetry={compare.reload} />}
        {compare.data && compare.data.rows.length === 0 && <EmptyState title="No country figures for the latest month" />}
        {compare.data && compare.data.rows.length > 0 && (
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-raised text-left text-sm text-ink-3">
                <tr>
                  <th className="py-2 font-normal">Country</th>
                  <th className="py-2 text-right font-normal">{fmtMonth(compare.data.month)}</th>
                  <th className="py-2 text-right font-normal">Share of all</th>
                  <th className="py-2 text-right font-normal">{fmtMonth(compare.data.comparison_month)}</th>
                  <th className="py-2 text-right font-normal">Change</th>
                  <th className="py-2 pl-4 font-normal">Figure</th>
                  <th className="py-2 pl-3 font-normal"><span className="sr-only">Source</span></th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {compare.data.rows.map((r) => (
                  <tr key={r.visitor_origin} className="border-t border-line">
                    <td className="py-2 text-ink">{r.visitor_origin}</td>
                    <td className="num py-2 text-right text-ink">{fmtNumber(r.value)}</td>
                    <td className="num py-2 text-right text-ink-2">{r.share_of_total_pct === null ? "—" : `${r.share_of_total_pct}%`}</td>
                    <td className="num py-2 text-right text-ink-2">{fmtNumber(r.value_last_year)}</td>
                    <td className={`num py-2 text-right font-bold ${r.yoy.status === "ok" && r.yoy.value! < 0 ? "text-down" : r.yoy.status === "ok" ? "text-route" : "text-ink-3"}`}
                      title={changeReason(r.yoy)}>{fmtChange(r.yoy)}</td>
                    <td className="py-2 pl-4">{r.value_status !== "final" ? <Badge tone="warn">Early estimate</Badge> : <span className="text-ink-3">Final</span>}</td>
                    <td className="py-2 pl-3"><EvidenceLink id={r.evidence_id} /></td>
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

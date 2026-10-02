"use client";

import Link from "next/link";
import { useScope } from "@/components/providers";
import { Badge, Card, DateLegend, EmptyState, ErrorState, EvidenceLink, Loading, PageHeader, Stat } from "@/components/ui";
import { api } from "@/lib/api";
import { changeReason, fmtChange, fmtDateTime, fmtMonth, fmtNumber, humanize } from "@/lib/format";
import type { CompetitorSummary, Coverage, KeyTrend, Theme } from "@/lib/types";
import { useApi } from "@/lib/useApi";

interface Overview {
  coverage: Coverage[];
  key_trends: KeyTrend[];
  competitors: CompetitorSummary;
  top_themes: Theme[];
  theme_method: string;
  feedback_classified: number;
  feedback_total: number;
  latest_report: { id: number; created_at: string; provider: string; is_example: number; status: string } | null;
}

const DATASET_LABELS: Record<string, string> = {
  visitor_stats: "Visitor statistics",
  competitor_offers: "Competitor offers",
  feedback: "Customer feedback",
  news: "News",
};

export default function OverviewPage() {
  const { scope, setScope } = useScope();
  const { data, error, loading, reload } = useApi(() => api.get<Overview>("/api/overview", scope), [scope]);

  return (
    <>
      <PageHeader title="Overview"
        description="What data you have, how fresh it is, and the headline trends calculated from it." />
      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <div className="space-y-6">
          {data.coverage.every((c) => c.records === 0) && (
            <EmptyState title="No data yet">
              Import files on <Link href="/sources" className="text-accent underline">Sources &amp; imports</Link>
              {scope === "real" && <> or <button onClick={() => setScope("demo")} className="text-accent underline">explore the demo</button></>}.
            </EmptyState>
          )}

          <Card title="Source coverage" subtitle={<DateLegend />}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {data.coverage.map((c) => (
                <div key={c.dataset} className="rounded-lg border border-line p-4">
                  <div className="text-sm font-medium text-ink">{DATASET_LABELS[c.dataset]}</div>
                  <div className="num mt-1 text-2xl font-semibold text-ink">{fmtNumber(c.records)}</div>
                  <div className="text-xs text-ink-3">records</div>
                  <dl className="mt-3 space-y-1 text-xs">
                    <div><dt className="inline text-ink-3">{humanize(c.date_field)}: </dt>
                      <dd className="inline text-ink-2">{c.from ? `${c.from} → ${c.to}` : "—"}</dd></div>
                    <div><dt className="inline text-ink-3">Last successful import: </dt>
                      <dd className="inline text-ink-2">{fmtDateTime(c.last_successful_import)}</dd></div>
                    {c.sources.length > 0 && <div><dt className="inline text-ink-3">Sources: </dt>
                      <dd className="inline text-ink-2">{c.sources.join(", ")}</dd></div>}
                  </dl>
                </div>
              ))}
            </div>
          </Card>

          {data.key_trends.map((t) => (
            <Card key={`${t.geography}${t.metric}${t.source}`}
              title={`Visitor trend: ${t.geography}`}
              subtitle={`${humanize(t.metric)} · source ${t.source} · latest reporting period ${fmtMonth(t.latest_month)}`}
              actions={<Link href="/trends" className="text-sm text-accent underline">Explore</Link>}>
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="space-y-4">
                  <Stat label={`All origins, ${fmtMonth(t.latest_month)}`} value={fmtNumber(t.total)} note={t.unit} />
                  <Stat label={`vs ${fmtMonth(t.comparison_month)}`} value={fmtChange(t.total_yoy)}
                    note={changeReason(t.total_yoy) ?? "same month, previous year"} />
                  {t.non_final_records > 0 && <Badge tone="warn">{t.non_final_records} provisional/estimated values in this series</Badge>}
                  {t.geography.toLowerCase().startsWith("japan") && (
                    <p className="text-xs text-ink-3">Japan-wide arrivals: not the number of visitors to Tokyo.</p>
                  )}
                </div>
                <MoversTable title="Fastest growing origins (YoY)" rows={t.top_growth} />
                <MoversTable title="Largest declines (YoY)" rows={t.top_decline} />
              </div>
              <p className="mt-3 text-xs text-ink-3">
                {t.comparable_origins} of {t.country_rows} country-level origins have a comparable month a year earlier.
              </p>
            </Card>
          ))}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Competitors" actions={<Link href="/competitors" className="text-sm text-accent underline">Compare</Link>}>
              {data.competitors.offers === 0 ? <EmptyState title="No competitor offers imported" /> : (
                <div className="grid grid-cols-2 gap-4">
                  <Stat label="Offers tracked" value={data.competitors.offers} note={`${data.competitors.businesses} businesses`} />
                  {data.competitors.by_currency.map((c) => (
                    <Stat key={c.currency} label={`Median price (${c.currency})`} value={fmtNumber(c.median)}
                      note={`n=${c.n}; ${data.competitors.missing_price} without a published price`} />
                  ))}
                </div>
              )}
            </Card>
            <Card title="Customer feedback themes"
              subtitle={data.feedback_total ? `${data.feedback_classified} of ${data.feedback_total} items classified · ${data.theme_method === "llm" ? "language-model labels" : "keyword-rule labels"}` : undefined}
              actions={<Link href="/needs" className="text-sm text-accent underline">Details</Link>}>
              {data.top_themes.length === 0 ? <EmptyState title="No classified feedback yet" /> : (
                <ul className="space-y-2">
                  {data.top_themes.map((t) => (
                    <li key={t.theme} className="flex items-center justify-between text-sm">
                      <span className="text-ink">{humanize(t.theme)}</span>
                      <span className="num text-ink-2">{t.count} <span className="text-ink-3">({t.share_pct ?? "—"}%)</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Latest report" actions={<Link href="/insights" className="text-sm text-accent underline">Insights</Link>}>
            {data.latest_report ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                Report #{data.latest_report.id} · {fmtDateTime(data.latest_report.created_at)}
                {data.latest_report.is_example ? <Badge tone="warn">EXAMPLE — not live AI</Badge> : <Badge tone="info">Live AI</Badge>}
                <Badge tone={data.latest_report.status === "success" ? "good" : data.latest_report.status === "partial" ? "warn" : "bad"}>{data.latest_report.status}</Badge>
              </div>
            ) : <p className="text-sm text-ink-3">No report generated yet.</p>}
          </Card>
        </div>
      )}
    </>
  );
}

function MoversTable({ title, rows }: { title: string; rows: KeyTrend["top_growth"] }) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-ink-2">{title}</div>
      {rows.length === 0 ? <p className="text-xs text-ink-3">Not enough comparable origins.</p> : (
        <table className="w-full text-sm">
          <tbody className="num">
            {rows.map((r) => (
              <tr key={r.visitor_origin} className="border-t border-line">
                <td className="py-1.5 text-ink">{r.visitor_origin}</td>
                <td className="py-1.5 text-right text-ink-2">{fmtNumber(r.value)}</td>
                <td className="py-1.5 text-right font-medium text-ink">{fmtChange(r.yoy)}</td>
                <td className="py-1.5 pl-2 text-right"><EvidenceLink id={r.evidence_id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

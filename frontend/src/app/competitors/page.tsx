"use client";

import { useState } from "react";
import { HBarChart } from "@/components/charts";
import { useScope } from "@/components/providers";
import { Badge, Card, EmptyState, ErrorState, EvidenceLink, inputClass, Loading, PageHeader, Stat } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDuration, fmtMoney, fmtNumber } from "@/lib/format";
import type { CompetitorSummary, Offer } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function CompetitorsPage() {
  const { scope } = useScope();
  const [q, setQ] = useState("");
  const [language, setLanguage] = useState("");
  const [sort, setSort] = useState("business");
  const [latestOnly, setLatestOnly] = useState(true);
  const { data, error, loading, reload } = useApi(
    () => api.get<{ offers: Offer[]; languages: string[]; summary: CompetitorSummary }>("/api/competitors", scope,
      { q, language, sort, latest_only: latestOnly }),
    [scope, q, language, sort, latestOnly]);

  const s = data?.summary;
  const priced = (data?.offers ?? []).filter((o) => o.price !== null && o.currency === "JPY");

  return (
    <>
      <PageHeader title="Competitors"
        description="Offers you have recorded. Listed prices are what was published on the observation date; they do not show discounts or actual bookings." />
      {error && <ErrorState message={error} onRetry={reload} />}
      {s && s.offers > 0 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card><Stat label="Offers (latest observation)" value={s.offers} note={`${s.businesses} businesses · ${s.observations} observations`} /></Card>
          {s.by_currency.map((c) => (
            <Card key={c.currency}><Stat label={`Price range (${c.currency})`} value={`${fmtNumber(c.min)}–${fmtNumber(c.max)}`}
              note={`median ${fmtNumber(c.median)} · n=${c.n} · ${s.missing_price} not published`} /></Card>
          ))}
          <Card><Stat label="Median duration" value={fmtDuration(s.duration_median_minutes)} note={`n=${s.duration_n} · ${s.missing_duration} unknown`} /></Card>
          <Card><Stat label="Languages" value={s.by_language.length}
            note={s.by_language.map((l) => `${l.language} ${l.offers}`).join(" · ")} /></Card>
        </div>
      )}

      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <input type="search" placeholder="Search business, tour, area, notes…" value={q} onChange={(e) => setQ(e.target.value)}
            className={`${inputClass} min-w-64 flex-1`} aria-label="Search offers" />
          <select className={inputClass} value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
            <option value="">All languages</option>
            {data?.languages.map((l) => <option key={l}>{l}</option>)}
          </select>
          <select className={inputClass} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="business">Sort: business</option>
            <option value="price">Sort: price (low → high)</option>
            <option value="price_desc">Sort: price (high → low)</option>
            <option value="duration">Sort: duration</option>
            <option value="observed">Sort: most recently observed</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={latestOnly} onChange={(e) => setLatestOnly(e.target.checked)} />
            Latest observation only
          </label>
        </div>
        {loading && <Loading />}
        {data && data.offers.length === 0 && (
          <EmptyState title={s?.offers ? "No offers match these filters" : "No competitor offers imported"}>
            {!s?.offers && "Use the competitor-offers template on Sources & imports."}
          </EmptyState>
        )}
        {data && data.offers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-3">
                <tr>
                  <th className="py-2 font-medium">Business / tour</th>
                  <th className="py-2 font-medium">Area</th>
                  <th className="py-2 text-right font-medium">Price</th>
                  <th className="py-2 text-right font-medium">Duration</th>
                  <th className="py-2 pl-3 font-medium">Language</th>
                  <th className="py-2 pl-3 font-medium">Observed</th>
                  <th className="py-2 pl-3 font-medium">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {data.offers.map((o) => (
                  <tr key={o.evidence_id} className="border-t border-line align-top">
                    <td className="py-2">
                      <div className="font-medium text-ink">{o.url ? <a href={o.url} target="_blank" rel="noreferrer" className="hover:underline">{o.tour_name}</a> : o.tour_name}</div>
                      <div className="text-xs text-ink-3">{o.business}{o.notes ? ` · ${o.notes}` : ""}</div>
                    </td>
                    <td className="py-2 text-ink-2">{o.area ?? "—"}</td>
                    <td className="num py-2 text-right text-ink">{o.price === null ? <span className="text-ink-3">Not published</span> : fmtMoney(o.price, o.currency)}</td>
                    <td className="num py-2 text-right text-ink-2">{fmtDuration(o.duration_minutes)}</td>
                    <td className="py-2 pl-3"><Badge>{o.language}</Badge></td>
                    <td className="num py-2 pl-3 text-xs text-ink-2">{o.date_observed}</td>
                    <td className="py-2 pl-3"><EvidenceLink id={o.evidence_id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {priced.length > 1 && (
        <Card title="Published price per offer (JPY)" subtitle={`n=${priced.length}; offers without a published price are not shown`} className="mt-6">
          <HBarChart rows={[...priced].sort((a, b) => b.price! - a.price!).map((o) => ({ label: `${o.tour_name.replace(" (sample)", "")} · ${o.language}`, value: o.price! }))}
            valueLabel="Price (JPY)" format={(n) => `¥${fmtNumber(n)}`} />
          <p className="mt-2 text-xs text-ink-3">Prices may include different things (drinks, group size, private vs shared). Check the notes before comparing.</p>
        </Card>
      )}
    </>
  );
}

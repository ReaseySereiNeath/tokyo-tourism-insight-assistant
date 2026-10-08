"use client";

import { useState } from "react";
import { HBarChart } from "@/components/charts";
import { useScope } from "@/components/providers";
import { Card, EmptyState, ErrorState, EvidenceLink, inputClass, Loading, PageHeader, Stat } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDuration, fmtMoney, fmtNumber, fmtPeriod, plural } from "@/lib/format";
import type { CompetitorSummary, Offer } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const SORTS = [
  ["business", "Business name"],
  ["price", "Cheapest first"],
  ["price_desc", "Most expensive first"],
  ["duration", "Shortest first"],
  ["observed", "Most recently checked"],
] as const;

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
  const nothingImported = data && !s?.offers;

  return (
    <>
      <PageHeader title="Competitors"
        description="Businesses already doing something like an idea you're considering. Record a few for any idea you're serious about. Prices are what was listed on the day you checked, so they don't show discounts or how well something sells." />
      {error && <ErrorState message={error} onRetry={reload} />}
      {loading && !data && <Loading />}

      {nothingImported && (
        <EmptyState title="No competitors recorded yet" href="/sources" action="Add your data">
          Pick your favourite idea from Business ideas, find five to ten businesses already offering something similar, and
          note each one&apos;s name, price, length, language and link in the competitor template.
        </EmptyState>
      )}

      {s && s.offers > 0 && (
        <Card className="mb-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Tours tracked" value={s.offers} note={`From ${plural(s.businesses, "business", "businesses")}`} />
            {s.by_currency.map((c) => (
              <Stat key={c.currency} label={`Typical price (${c.currency})`} value={fmtNumber(c.median)}
                note={`Ranges from ${fmtNumber(c.min)} to ${fmtNumber(c.max)}.${s.missing_price ? ` ${plural(s.missing_price, "tour")} ${s.missing_price === 1 ? "doesn't" : "don't"} list a price.` : ""}`} />
            ))}
            <Stat label="Typical length" value={fmtDuration(s.duration_median_minutes)}
              note={s.missing_duration ? `${plural(s.missing_duration, "tour")} ${s.missing_duration === 1 ? "doesn't" : "don't"} say how long ${s.missing_duration === 1 ? "it is" : "they are"}.` : undefined} />
            <Stat label="Languages offered" value={s.by_language.length}
              note={s.by_language.map((l) => `${l.language}: ${l.offers}`).join(", ")} />
          </div>
          <p className="mt-6 text-xs text-ink-3">“Typical” is the middle value: half the tours are above it and half below.</p>
        </Card>
      )}

      {s && s.offers > 0 && (
        <Card title="All tours">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <input type="search" placeholder="Search by business, tour, area or notes" value={q} onChange={(e) => setQ(e.target.value)}
              className={`${inputClass} min-w-64 flex-1`} aria-label="Search tours" />
            <select className={inputClass} value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
              <option value="">All languages</option>
              {data?.languages.map((l) => <option key={l}>{l}</option>)}
            </select>
            <select className={inputClass} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
              {SORTS.map(([value, label]) => <option key={value} value={value}>Sort: {label}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={latestOnly} onChange={(e) => setLatestOnly(e.target.checked)} className="accent-route" />
              Only the latest check of each tour
            </label>
          </div>
          {loading && <Loading />}
          {data && data.offers.length === 0 && <EmptyState title="No tours match these filters">Clear the search or pick another language.</EmptyState>}
          {data && data.offers.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-ink-3">
                  <tr>
                    <th className="py-2 font-normal">Tour</th>
                    <th className="py-2 font-normal">Area</th>
                    <th className="py-2 text-right font-normal">Price</th>
                    <th className="py-2 text-right font-normal">Length</th>
                    <th className="py-2 pl-4 font-normal">Language</th>
                    <th className="py-2 pl-4 font-normal">Checked</th>
                    <th className="py-2 pl-3 font-normal"><span className="sr-only">Source</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.offers.map((o) => (
                    <tr key={o.evidence_id} className="border-t border-line align-top">
                      <td className="py-2.5 pr-4">
                        <div className="font-bold text-ink">
                          {o.url ? <a href={o.url} target="_blank" rel="noreferrer" className="hover:underline">{o.tour_name}</a> : o.tour_name}
                        </div>
                        <div className="text-xs text-ink-3">{o.business}</div>
                        {o.notes && <div className="mt-0.5 text-xs text-ink-2">{o.notes}</div>}
                      </td>
                      <td className="py-2.5 text-ink-2">{o.area ?? "—"}</td>
                      <td className="num py-2.5 text-right text-ink">{o.price === null ? <span className="text-ink-3">Not listed</span> : fmtMoney(o.price, o.currency)}</td>
                      <td className="num py-2.5 text-right text-ink-2">{fmtDuration(o.duration_minutes)}</td>
                      <td className="py-2.5 pl-4 text-ink-2">{o.language}</td>
                      <td className="py-2.5 pl-4 text-ink-2">{fmtPeriod(o.date_observed)}</td>
                      <td className="py-2.5 pl-3"><EvidenceLink id={o.evidence_id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {priced.length > 1 && (
        <Card title="Listed prices, highest to lowest" subtitle={`${priced.length} tours in yen. Tours without a listed price are left out.`} className="mt-6">
          <HBarChart rows={[...priced].sort((a, b) => b.price! - a.price!).map((o) => ({ label: `${o.tour_name.replace(" (sample)", "")} (${o.language})`, value: o.price! }))}
            valueLabel="Price (JPY)" format={(n) => `¥${fmtNumber(n)}`} />
          <p className="mt-3 text-xs text-ink-3">Prices can include different things, like drinks, group size or a private guide. Read the notes before comparing.</p>
        </Card>
      )}
    </>
  );
}

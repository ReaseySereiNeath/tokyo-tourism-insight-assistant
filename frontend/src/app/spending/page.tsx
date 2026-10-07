"use client";

import { useEffect, useRef, useState } from "react";
import { HistoryChart } from "@/components/charts";
import { useScope } from "@/components/providers";
import { Badge, Callout, Card, EmptyState, ErrorState, EvidenceLink, inputClass, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtChange, fmtNumber, fmtQuarter, fmtYen } from "@/lib/format";
import type { Change, Market, SegmentRow, SpendingHistory, SpendingItem, SpendingItems } from "@/lib/types";
import { useApi } from "@/lib/useApi";

type Sort = "spend" | "growth";
const FIRST_ROWS = 15;

export default function SpendingPage() {
  const { scope } = useScope();
  return <SpendingContent key={scope} />;
}

function SpendingContent() {
  const { scope } = useScope();
  const [segment, setSegment] = useState("All nationalities");
  const [sort, setSort] = useState<Sort>("spend");
  const [category, setCategory] = useState<string | null>(null);
  const [picked, setPicked] = useState<SpendingItem | null>(null);
  const [showAll, setShowAll] = useState(false);
  const market = useApi(() => api.get<Market>("/api/spending/market", scope), [scope]);
  const names = useApi(() => api.get<string[]>("/api/spending/segment-names", scope), [scope]);
  const items = useApi(() => api.get<SpendingItems>("/api/spending/items", scope, { segment }), [scope, segment]);

  const noData = items.data && items.data.period === null && market.data && market.data.period === null;
  const rows = (items.data?.rows ?? []).filter((r) => r.item && (!category || r.category === category));
  const sorted = [...rows].sort((a, b) => sort === "spend"
    ? b.spend_per_person - a.spend_per_person
    : (b.spend_change.value ?? -Infinity) - (a.spend_change.value ?? -Infinity));
  const categories = [...new Map((items.data?.rows ?? []).filter((r) => r.item).map((r) => [r.category, r.category_label])).entries()];
  const preliminary = items.data?.rows.some((r) => r.value_status === "preliminary");

  return (
    <>
      <PageHeader title="Spending"
        description="What international visitors spend money on, from the Japan Tourism Agency's quarterly survey. It shows which kinds of business money is flowing to, and which are growing." />

      {(market.loading || items.loading) && !items.data && <Loading />}
      {items.error && <ErrorState message={items.error} onRetry={items.reload} />}
      {noData && (
        <EmptyState title="No spending figures yet" href="/sources" action="Get the official data">
          On Add your data, choose “Check for new data”. The app downloads the Japan Tourism Agency&apos;s spending survey for you.
        </EmptyState>
      )}

      {items.data?.period && (
        <p className="mb-6 max-w-2xl text-sm text-ink-2">
          Latest figures: <strong className="text-ink">{fmtQuarter(items.data.period)}</strong>, compared with {fmtQuarter(items.data.comparison_period)}.
          {preliminary && " These are early figures (速報) and may be revised."} They come from a survey of departing visitors, so treat them as estimates.
        </p>
      )}

      {market.data?.period && <TokyoMarket m={market.data} />}

      {items.data?.period && (
        <Card title="What visitors buy, item by item" className="mt-6"
          subtitle="Average spend per visitor across all of Japan. The survey doesn't publish items for Tokyo alone.">
          <div className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-3">
            <label className="text-sm font-bold text-ink">Visitors from
              <select className={`${inputClass} mt-1 block font-normal`} value={segment}
                onChange={(e) => { setSegment(e.target.value); setPicked(null); }}>
                {(names.data ?? ["All nationalities"]).map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
            <div>
              <div id="sort-label" className="mb-1 text-sm font-bold text-ink">Show first</div>
              <div className="inline-flex rounded-lg border border-line bg-paper p-0.5 text-sm" role="radiogroup" aria-labelledby="sort-label">
                {([["spend", "Biggest spend"], ["growth", "Fastest growing"]] as const).map(([value, text]) => (
                  <button key={value} role="radio" aria-checked={sort === value} onClick={() => setSort(value)}
                    className={`rounded-md px-3 py-1 ${sort === value ? "bg-raised font-bold text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}>
                    {text}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mb-4 flex flex-wrap gap-1.5" aria-label="Filter by category">
            {[[null, "All categories"] as const, ...categories].map(([key, text]) => (
              <button key={text} onClick={() => setCategory(key)} aria-pressed={category === key}
                className={`rounded-full border px-3 py-1 text-sm ${category === key ? "border-ink bg-raised font-bold text-ink" : "border-line text-ink-2 hover:border-ink-3"}`}>
                {text}
              </button>
            ))}
          </div>
          {items.data.comparable === false && (
            <Callout className="mb-4">“Other” covers different countries in each year, so it isn&apos;t compared with last year.</Callout>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-3">
                <tr>
                  <th className="py-2 pr-4 font-normal">Item</th>
                  <th className="py-2 pr-4 text-right font-normal">Per visitor</th>
                  <th className="py-2 pr-4 text-right font-normal">vs last year</th>
                  <th className="py-2 pr-4 text-right font-normal">Share who buy</th>
                  <th className="py-2 pr-4 text-right font-normal">Each buyer spends</th>
                  {segment === "All nationalities" && <th className="py-2 pr-4 text-right font-normal">Market, estimated</th>}
                  <th className="py-2 font-normal"><span className="sr-only">Who buys it, and source</span></th>
                </tr>
              </thead>
              <tbody>
                {(showAll ? sorted : sorted.slice(0, FIRST_ROWS)).map((r) => (
                  <tr key={r.category + r.item}
                    className={`border-t border-line ${picked?.item === r.item ? "bg-route-soft" : ""} ${r.small_sample ? "text-ink-3" : ""}`}>
                    <td className="py-2.5 pr-4">
                      <div className={`font-bold ${r.small_sample ? "" : "text-ink"}`}>{r.label}</div>
                      <div className="text-xs text-ink-3">
                        {r.category_label}{r.small_sample && <span className="ml-2"><Badge tone="warn">Few buyers ({r.buyers})</Badge></span>}
                      </div>
                    </td>
                    <td className="num py-2.5 pr-4 text-right">{fmtYen(r.spend_per_person)}</td>
                    <td className="py-2.5 pr-4 text-right"><ChangeText c={r.spend_change} /></td>
                    <td className="num py-2.5 pr-4 text-right">{r.purchase_rate === null ? "—" : `${r.purchase_rate.toFixed(1)}%`}</td>
                    <td className="num py-2.5 pr-4 text-right">{fmtYen(r.spend_per_purchaser)}</td>
                    {segment === "All nationalities" && <td className="num py-2.5 pr-4 text-right">{r.estimated_market ? fmtYen(r.estimated_market) : "—"}</td>}
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => setPicked(picked?.item === r.item ? null : r)}
                        className="mr-3 text-sm font-medium text-route underline underline-offset-2">
                        {picked?.item === r.item ? "Hide" : "Who buys it"}
                      </button>
                      <EvidenceLink id={r.evidence_id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sorted.length > FIRST_ROWS && (
            <button onClick={() => setShowAll(!showAll)}
              className="mt-4 text-sm font-bold text-route underline decoration-route/40 underline-offset-4 hover:decoration-route">
              {showAll ? `Show the top ${FIRST_ROWS} only` : `Show all ${sorted.length} items`}
            </button>
          )}
          <ul className="mt-4 space-y-1 text-xs text-ink-3">
            <li>“Per visitor” averages over everyone, including those who bought nothing in that item.</li>
            {segment === "All nationalities" && <li>“Market, estimated” is per visitor × visitors that quarter (JNTO). It is our estimate, not a published figure.</li>}
            <li>Faded rows rest on fewer than 50 buyers in the survey. Treat them as rough.</li>
          </ul>
        </Card>
      )}

      {picked && items.data?.period && <WhoBuys item={picked} period={items.data.period} onClose={() => setPicked(null)} />}

      {items.data?.period && <LongTerm segment={segment} />}
    </>
  );
}

function ChangeText({ c }: { c: Change | { value: null; status: string } }) {
  if (c.status !== "ok" || c.value === null) return <span className="text-ink-3">—</span>;
  return <span className={`num font-bold ${c.value < 0 ? "text-down" : "text-route"}`}>{fmtChange(c as Change)}</span>;
}

function TokyoMarket({ m }: { m: Market }) {
  const max = Math.max(...m.categories.map((c) => c.value ?? 0), 1);
  return (
    <Card title="Where visitors' money goes in Tokyo"
      subtitle={`${fmtQuarter(m.period)}. Tokyo figures are published for these broad categories only.`}>
      <p className="font-display text-ink">
        <span className="num text-4xl font-black">{fmtYen(m.total?.value)}</span>
        <span className="ml-2 text-lg font-bold">spent by visitors in Tokyo</span>
      </p>
      <p className="mt-1 text-sm text-ink-2">
        <ChangeText c={m.total!.change} /> compared with {fmtQuarter(m.comparison_period)}
        {m.visitors?.value != null && <>. About {fmtNumber(m.visitors.value)} visitors (<ChangeText c={m.visitors.change} />)</>}
        {m.spend_per_person?.value != null && <>, spending {fmtYen(m.spend_per_person.value)} each in Tokyo on average</>}.
      </p>
      <ul className="mt-6 space-y-3">
        {m.categories.filter((c) => (c.value ?? 0) > 0).map((c) => (
          <li key={c.category} className="grid grid-cols-[minmax(8rem,14rem)_1fr_auto] items-center gap-x-4 text-sm">
            <span className="text-ink">{c.label}</span>
            <span className="h-3 rounded-sm bg-route" style={{ width: `${((c.value ?? 0) / max) * 100}%` }} aria-hidden />
            <span className="num w-44 text-right">
              <span className="text-ink">{fmtYen(c.value)}</span>{" "}
              <ChangeText c={c.change} />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function WhoBuys({ item, period, onClose }: { item: SpendingItem; period: string; onClose: () => void }) {
  const { scope } = useScope();
  const ref = useRef<HTMLDivElement>(null);
  // The panel opens below a long table: bring it into view.
  useEffect(() => { ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [item.item]);
  const data = useApi(() => api.get<{ rows: SegmentRow[]; label: string }>("/api/spending/segments", scope,
    { category: item.category, item: item.item, period }), [scope, item.category, item.item, period]);
  return (
    <div ref={ref} className="scroll-mt-6">
    <Card className="mt-6" title={`Who buys ${item.label.toLowerCase()}`}
      subtitle={`${fmtQuarter(period)}, by visitors' nationality. Visitor growth compares the same quarter a year earlier.`}
      actions={<button onClick={onClose} className="text-sm text-ink-2 underline">Close</button>}>
      {data.loading && <Loading />}
      {data.error && <ErrorState message={data.error} />}
      {data.data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-3">
              <tr>
                <th className="py-2 pr-4 font-normal">Visitors from</th>
                <th className="py-2 pr-4 text-right font-normal">Share who buy it</th>
                <th className="py-2 pr-4 text-right font-normal">Each buyer spends</th>
                <th className="py-2 pr-4 text-right font-normal">Visitors vs last year</th>
                <th className="py-2 font-normal"><span className="sr-only">Source</span></th>
              </tr>
            </thead>
            <tbody>
              {data.data.rows.map((s) => (
                <tr key={s.segment} className={`border-t border-line ${s.small_sample ? "text-ink-3" : ""} ${s.segment === "All nationalities" ? "font-bold" : ""}`}>
                  <td className="py-2 pr-4">
                    {s.segment === "All nationalities" ? "All visitors" : s.segment}
                    {s.small_sample && <span className="ml-2 text-xs font-normal">({s.buyers} buyers)</span>}
                  </td>
                  <td className="num py-2 pr-4 text-right">{s.purchase_rate === undefined ? "—" : `${s.purchase_rate.toFixed(1)}%`}</td>
                  <td className="num py-2 pr-4 text-right">{fmtYen(s.spend_per_purchaser)}</td>
                  <td className="py-2 pr-4 text-right">{s.arrivals ? <ChangeText c={s.arrivals.change} /> : <span className="text-ink-3">—</span>}</td>
                  <td className="py-2 text-right">{s.purchase_rate_evidence_id && <EvidenceLink id={s.purchase_rate_evidence_id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-ink-3">
            Faded rows rest on fewer than 50 buyers, so they come last. Nationality doesn&apos;t tell you what language
            someone wants to be served in.
          </p>
        </div>
      )}
    </Card>
    </div>
  );
}

function LongTerm({ segment }: { segment: string }) {
  const { scope } = useScope();
  const [only, setOnly] = useState<string | null>(null);
  const data = useApi(() => api.get<SpendingHistory>("/api/spending/history", scope, { segment }), [scope, segment]);
  const h = data.data;
  const designs = h?.designs ?? [];
  const first = designs[0]?.points[0]?.period;
  return (
    <Card className="mt-6" title={first ? `The long view, since ${first.slice(0, 4)}` : "The long view"}
      subtitle={`Spending per visitor on the main categories, every quarter${segment === "All nationalities" ? "" : `, visitors from ${segment}`}.`}>
      {data.loading && !h && <Loading />}
      {data.error && <ErrorState message={data.error} onRetry={data.reload} />}
      {h && designs.length <= 1 && (
        <EmptyState title="Only the current survey is loaded" href="/sources" action="Download the history">
          The history from 2010 is a one-off download on Add your data, under Official data.
        </EmptyState>
      )}
      {h && designs.length > 1 && (
        <>
          <div className="mb-4 flex flex-wrap gap-1.5" aria-label="Show category">
            {[{ key: null, label: "All five" }, ...h.categories].map((c) => (
              <button key={c.label} onClick={() => setOnly(c.key)} aria-pressed={only === c.key}
                className={`rounded-full border px-3 py-1 text-sm ${only === c.key ? "border-ink bg-raised font-bold text-ink" : "border-line text-ink-2 hover:border-ink-3"}`}>
                {c.label}
              </button>
            ))}
          </div>
          <HistoryChart data={h} only={only} />
          <ul className="mt-4 max-w-3xl space-y-1 text-xs text-ink-3">
            <li>
              The survey was redesigned twice ({designs.slice(1).map((d) => fmtQuarter(d.from, true)).join(" and ")}), so each
              stretch is drawn separately. Compare within a stretch, not across a break.
            </li>
            <li>{h.gaps[0]?.reason}</li>
            <li>
              Calculated the same way throughout: share of visitors who bought × what buyers spent. It leaves out package-tour
              fees, so it is a little lower than the “per visitor” figures above.
            </li>
          </ul>
        </>
      )}
    </Card>
  );
}

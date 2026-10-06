"use client";

import Link from "next/link";
import { useScope } from "@/components/providers";
import { ButtonLink, DateLegend, ErrorState, Loading, MoreDetail, StationMark } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtChange, fmtDate, fmtDateTime, fmtMonthLong, fmtNumber, fmtPeriod, fmtQuarter, fmtYen, humanize } from "@/lib/format";
import { nextStation, STATIONS, type Station } from "@/lib/route";
import type { Change, ComparisonRow, KeyTrend, Market, Overview, SpendingItem } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const DATASET_LABELS: Record<string, string> = {
  visitor_stats: "Visitor numbers",
  spending_stats: "Visitor spending",
  competitor_offers: "Competitors",
  feedback: "Guest feedback",
  news: "News",
};

export default function HomePage() {
  const { scope, setScope } = useScope();
  const { data, error, loading, reload } = useApi(() => api.get<Overview>("/api/overview", scope), [scope]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const trend = data.key_trends[0];
  const next = nextStation(data);
  const empty = data.coverage.every((c) => c.records === 0);

  return (
    <div className="space-y-14">
      {data.tokyo_market.period ? <TokyoHeadline m={data.tokyo_market} /> : trend ? <Headline t={trend} /> : (
        <section>
          <h1 className="text-[2.5rem] font-black leading-tight text-ink">Find a tourism business worth starting</h1>
          <p className="mt-3 max-w-xl text-base text-ink-2">
            This app reads Japan&apos;s official tourism statistics (who visits, and what they spend money on) and suggests
            business ideas that fit you, each with the numbers behind it. Start by getting the latest data.
          </p>
          {empty && scope === "real" && (
            <p className="mt-3 text-sm text-ink-2">
              Want to look around first?{" "}
              <button onClick={() => setScope("demo")} className="font-bold text-route underline">Show the sample data</button>
            </p>
          )}
        </section>
      )}

      <NextStop station={next} />

      <section aria-labelledby="line-heading">
        <h2 id="line-heading" className="mb-5 text-2xl font-bold text-ink">What your data says so far</h2>
        <div className="grid gap-x-10 gap-y-10 lg:grid-cols-3">
          <StopSummary station={STATIONS[1]} done={STATIONS[1].done(data)}>
            {trend && <Movers t={trend} />}
          </StopSummary>
          <StopSummary station={STATIONS[2]} done={STATIONS[2].done(data)}>
            <SpendingSummary o={data} />
          </StopSummary>
          <StopSummary station={STATIONS[3]} done={STATIONS[3].done(data)}>
            <IdeasSummary o={data} />
          </StopSummary>
        </div>
      </section>

      <section aria-labelledby="data-heading" className="border-t border-line pt-10">
        <h2 id="data-heading" className="text-2xl font-bold text-ink">Your data</h2>
        <p className="mt-1 text-sm text-ink-2">What has been imported, and how up to date it is.</p>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full max-w-3xl text-sm">
            <thead className="text-left text-ink-3">
              <tr>
                <th className="py-2 pr-4 font-normal">Data</th>
                <th className="py-2 pr-4 text-right font-normal">Records</th>
                <th className="py-2 pr-4 font-normal">Covers</th>
                <th className="py-2 font-normal">Last imported</th>
              </tr>
            </thead>
            <tbody className="num">
              {data.coverage.map((c) => (
                <tr key={c.dataset} className="border-t border-line">
                  <td className="py-2.5 pr-4 font-bold text-ink">{DATASET_LABELS[c.dataset] ?? humanize(c.dataset)}</td>
                  <td className="py-2.5 pr-4 text-right text-ink">{fmtNumber(c.records)}</td>
                  <td className="py-2.5 pr-4 text-ink-2">{c.from ? `${fmtPeriod(c.from)} to ${fmtPeriod(c.to)}` : "Nothing yet"}</td>
                  <td className="py-2.5 text-ink-2">{c.last_successful_import ? fmtDate(c.last_successful_import) : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <MoreDetail summary="Which date does “Covers” mean?" className="mt-4">
          <DateLegend />
        </MoreDetail>
      </section>
    </div>
  );
}

/** The one big moment: the latest official number, said as a sentence. */
function Headline({ t }: { t: KeyTrend }) {
  const change = t.total_yoy.status === "ok" ? t.total_yoy.value : null;
  const japan = t.geography.toLowerCase().startsWith("japan");
  const people = t.unit === "persons" ? "people" : t.unit;
  return (
    <section aria-labelledby="headline">
      <h1 id="headline" className="font-display text-ink">
        <span className="num block text-[clamp(3rem,9vw,6.5rem)] font-black leading-[0.95] tracking-tight">{fmtNumber(t.total)}</span>
        <span className="mt-3 block text-2xl font-bold leading-snug sm:text-3xl">
          {people} arrived in {t.geography} in {fmtMonthLong(t.latest_month)}.
        </span>
      </h1>
      {change !== null && (
        <p className={`num mt-4 text-xl font-bold ${change < 0 ? "text-down" : "text-route"}`}>
          <span aria-hidden>{change < 0 ? "▼ " : "▲ "}</span>
          {Math.abs(change).toFixed(1)}% {change < 0 ? "fewer" : "more"} than {fmtMonthLong(t.comparison_month)}
        </p>
      )}
      <p className="mt-3 max-w-xl text-sm text-ink-2">
        {japan && "This counts arrivals to all of Japan, not only Tokyo. "}
        Source: {t.source}.
        {t.non_final_records > 0 && " Recent months are early estimates and may still change."}
      </p>
    </section>
  );
}

function NextStop({ station }: { station: Station | undefined }) {
  return (
    <section aria-labelledby="next-heading" className="rounded-xl border border-line bg-raised p-6 sm:p-8">
      {station ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <StationMark n={station.n} size="lg" />
          <div className="min-w-0 flex-1 basis-64">
            <h2 id="next-heading" className="text-xl font-bold text-ink">Next stop: {station.label}</h2>
            <p className="mt-1 max-w-xl text-sm text-ink-2">{station.todo}</p>
          </div>
          <ButtonLink href={station.href}>Go to {station.label}</ButtonLink>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <div className="min-w-0 flex-1 basis-64">
            <h2 id="next-heading" className="text-xl font-bold text-ink">Every stop has data</h2>
            <p className="mt-1 max-w-xl text-sm text-ink-2">Your latest ideas are ready. Add new files any time to keep them current.</p>
          </div>
          <ButtonLink href="/insights">Open ideas to test</ButtonLink>
        </div>
      )}
    </section>
  );
}

function StopSummary({ station, done, children }: { station: Station; done: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <StationMark n={station.n} done={done} />
        <h3 className="text-lg font-bold text-ink">{station.label}</h3>
      </div>
      <div className="mt-4 text-sm">
        {done ? children : <p className="text-ink-2">{station.todo}</p>}
      </div>
      <Link href={station.href} className="mt-4 inline-block text-sm font-bold text-route underline decoration-route/40 underline-offset-4 hover:decoration-route">
        {done ? `See all ${station.label.toLowerCase()}` : `Go to ${station.label}`}
      </Link>
    </div>
  );
}

function Movers({ t }: { t: KeyTrend }) {
  return (
    <div className="space-y-5">
      <MoverList title="Growing fastest" rows={t.top_growth} />
      <MoverList title={t.top_decline.some((r) => r.yoy.status === "ok" && r.yoy.value! < 0) ? "Shrinking most" : "Growing slowest"} rows={t.top_decline} />
      <p className="text-xs text-ink-3">Compared with {fmtMonthLong(t.comparison_month)}.</p>
    </div>
  );
}

function MoverList({ title, rows }: { title: string; rows: ComparisonRow[] }) {
  return (
    <div>
      <div className="mb-1.5 text-ink-2">{title}</div>
      {rows.length === 0 ? <p className="text-ink-3">Not enough data to compare yet.</p> : (
        <ul className="num divide-y divide-line border-y border-line">
          {rows.map((r) => {
            const v = r.yoy.status === "ok" ? r.yoy.value : null;
            return (
              <li key={r.visitor_origin} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="text-ink">{r.visitor_origin}</span>
                <span className={`font-bold ${v !== null && v < 0 ? "text-down" : "text-route"}`}>
                  {v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(0)}%`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TokyoHeadline({ m }: { m: Market }) {
  const change = m.total?.change.status === "ok" ? m.total.change.value : null;
  return (
    <section aria-labelledby="headline">
      <h1 id="headline" className="font-display text-ink">
        <span className="num block text-[clamp(3rem,9vw,6.5rem)] font-black leading-[0.95] tracking-tight">{fmtYen(m.total?.value)}</span>
        <span className="mt-3 block text-2xl font-bold leading-snug sm:text-3xl">
          spent by international visitors in Tokyo in {fmtQuarter(m.period)}.
        </span>
      </h1>
      {change !== null && (
        <p className={`num mt-4 text-xl font-bold ${change < 0 ? "text-down" : "text-route"}`}>
          <span aria-hidden>{change < 0 ? "▼ " : "▲ "}</span>
          {Math.abs(change).toFixed(1)}% {change < 0 ? "less" : "more"} than {fmtQuarter(m.comparison_period)}
        </p>
      )}
      <p className="mt-3 max-w-xl text-sm text-ink-2">
        Source: Japan Tourism Agency visitor spending survey.
        {m.total?.value_status !== "final" && " Recent quarters are early figures and may be revised."}
      </p>
    </section>
  );
}

function SpendingSummary({ o }: { o: Overview }) {
  const h = o.spending_highlights;
  const tokyo = o.tokyo_market;
  return (
    <div className="space-y-5">
      {h.growing.length > 0 && (
        <div>
          <div className="mb-1.5 text-ink-2">Growing fastest, per visitor</div>
          <ItemList rows={h.growing.slice(0, 4)} />
        </div>
      )}
      {tokyo.period && tokyo.categories.length > 0 && (
        <div>
          <div className="mb-1.5 text-ink-2">Biggest in Tokyo</div>
          <ul className="num divide-y divide-line border-y border-line">
            {tokyo.categories.slice(0, 3).map((c) => (
              <li key={c.category} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="text-ink">{c.label}</span>
                <span className="text-ink-2">{fmtYen(c.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-ink-3">Compared with {fmtQuarter(h.comparison_period)}.</p>
    </div>
  );
}

function ItemList({ rows }: { rows: SpendingItem[] }) {
  return (
    <ul className="num divide-y divide-line border-y border-line">
      {rows.map((r) => (
        <li key={r.category + r.item} className="flex items-baseline justify-between gap-3 py-1.5">
          <span className="text-ink">{r.label}</span>
          <span className={`font-bold ${(r.spend_change.value ?? 0) < 0 ? "text-down" : "text-route"}`}>
            {fmtChange(r.spend_change as Change)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function IdeasSummary({ o }: { o: Overview }) {
  const r = o.latest_report;
  if (!r) return null;
  return (
    <div className="space-y-2 text-ink">
      <p>Your latest ideas are from <strong>{fmtDateTime(r.created_at)}</strong>.</p>
      {r.is_example ? <p className="text-ink-2">That&apos;s a sample report built from made-up data.</p>
        : <p className="text-ink-2">Find new ideas whenever new data arrives.</p>}
    </div>
  );
}

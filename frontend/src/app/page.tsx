"use client";

import Link from "next/link";
import { useScope } from "@/components/providers";
import { ButtonLink, DateLegend, ErrorState, Loading, MoreDetail, StationMark } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate, fmtMonthLong, fmtPeriod, fmtNumber, humanize, plural } from "@/lib/format";
import { nextStation, STATIONS, type Station } from "@/lib/route";
import type { ComparisonRow, KeyTrend, Overview } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const DATASET_LABELS: Record<string, string> = {
  visitor_stats: "Visitor statistics",
  competitor_offers: "Competitor tours",
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
      {trend ? <Headline t={trend} /> : (
        <section>
          <h1 className="text-[2.5rem] font-black leading-tight text-ink">Start by adding your data</h1>
          <p className="mt-3 max-w-xl text-base text-ink-2">
            This app compares official visitor numbers, competitor tours and your guests&apos; feedback, then suggests small
            experiments for your business. It needs at least one file to begin.
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
            <CompetitorSummaryText o={data} />
          </StopSummary>
          <StopSummary station={STATIONS[3]} done={STATIONS[3].done(data)}>
            <FeedbackSummaryText o={data} />
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

function CompetitorSummaryText({ o }: { o: Overview }) {
  const c = o.competitors;
  const jpy = c.by_currency.find((x) => x.currency === "JPY") ?? c.by_currency[0];
  return (
    <div className="space-y-3 text-ink">
      <p>You are tracking <strong>{plural(c.offers, "tour")}</strong> from {plural(c.businesses, "business", "businesses")}.</p>
      {jpy && (
        <p>
          A typical price is <strong className="num">{jpy.currency} {fmtNumber(jpy.median)}</strong>.
          <span className="text-ink-2"> They range from {fmtNumber(jpy.min)} to {fmtNumber(jpy.max)}.</span>
        </p>
      )}
      {c.missing_price > 0 && <p className="text-xs text-ink-3">{plural(c.missing_price, "tour")} {c.missing_price === 1 ? "doesn't" : "don't"} list a price.</p>}
    </div>
  );
}

function FeedbackSummaryText({ o }: { o: Overview }) {
  if (o.top_themes.length === 0) {
    return <p className="text-ink-2">{plural(o.feedback_total, "review")} imported, but none are sorted into topics yet. Open Guest feedback to sort them.</p>;
  }
  return (
    <div>
      <div className="mb-1.5 text-ink-2">Most talked about</div>
      <ul className="num divide-y divide-line border-y border-line">
        {o.top_themes.slice(0, 4).map((t) => (
          <li key={t.theme} className="flex items-baseline justify-between gap-3 py-1.5">
            <span className="text-ink">{humanize(t.theme)}</span>
            <span className="text-ink-2">{t.count} of {o.feedback_classified}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-3">
        Topics found by {{ llm: "AI", local: "your trained model" }[o.theme_method] ?? "simple keyword matching"}.
      </p>
    </div>
  );
}

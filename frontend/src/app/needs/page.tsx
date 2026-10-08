"use client";

import { useState } from "react";
import { HBarChart } from "@/components/charts";
import { useScope } from "@/components/providers";
import { Button, Callout, Card, EmptyState, ErrorState, EvidenceLink, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { humanize, plural } from "@/lib/format";
import type { FeedbackItem, LabelMethod, ThemeSummary } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const METHODS: Record<LabelMethod, { tab: string; done: string; button: string; about: string }> = {
  keyword: {
    tab: "Keywords", done: "keyword matching", button: "Sort with keywords",
    about: "Free and instant, but rough: it looks for words like “ramen” or “too fast” and misses anything phrased differently.",
  },
  local: {
    tab: "Your model", done: "your trained model", button: "Sort with your model",
    about: "Free, runs on this Mac. Uses the classifier you trained on reviews you labelled yourself.",
  },
  llm: {
    tab: "AI", done: "AI", button: "Sort with AI",
    about: "The most accurate. Sends the reviews to the AI service, which costs a small amount per run.",
  },
};

export default function FeedbackPage() {
  const { scope } = useScope();
  const [method, setMethod] = useState<LabelMethod | null>(null);
  const [busy, setBusy] = useState<LabelMethod | null>(null);
  const [notice, setNotice] = useState<{ tone: "note" | "bad"; text: string } | null>(null);
  const [theme, setTheme] = useState<string | null>(null);
  const health = useApi(() => api.get<{ ai_configured: boolean; model: string | null; local_model_trained?: boolean }>("/api/health", null), []);
  const summary = useApi(() => api.get<ThemeSummary>("/api/feedback/themes", scope, { method }), [scope, method]);
  const activeMethod = summary.data?.method ?? "keyword";
  const items = useApi(
    () => theme ? api.get<FeedbackItem[]>("/api/feedback", scope, { theme, method: activeMethod }) : Promise.resolve(null),
    [scope, theme, activeMethod]);

  async function classify(m: LabelMethod) {
    setBusy(m);
    setNotice(null);
    try {
      const r = await api.post<{ classified: number; error?: string | null }>("/api/feedback/classify", scope, { method: m });
      setNotice(r.error
        ? { tone: "bad", text: `Stopped early: ${r.error} ${r.classified} reviews were sorted before it stopped.` }
        : { tone: "note", text: `Sorted ${r.classified} reviews with ${METHODS[m].done}.` });
      setMethod(m);
      summary.reload();
    } catch (e) {
      setNotice({ tone: "bad", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const d = summary.data;
  const available = (["keyword", "local", "llm"] as const).filter((m) =>
    m === "keyword" || (m === "local" ? !!health.data?.local_model_trained : true));
  const sorter = (
    <Sorter available={available} busy={busy} aiReady={!!health.data?.ai_configured} onSort={classify}
      firstTime={!!d && d.classified === 0} />
  );

  return (
    <>
      <PageHeader title="Guest feedback"
        description="Once you have customers, import their reviews here to see what they talk about, grouped into topics. A topic that comes up often is worth a closer look, but it doesn't tell you how many people would pay for a change." />

      {notice && <Callout tone={notice.tone} className="mb-6">{notice.text}</Callout>}
      {summary.loading && !d && <Loading />}
      {summary.error && <ErrorState message={summary.error} onRetry={summary.reload} />}
      {d && d.total_feedback === 0 && (
        <EmptyState title="No guest feedback yet" href="/sources" action="Add your data">
          Import reviews or survey answers with the feedback template. Only use feedback you have permission to use.
        </EmptyState>
      )}

      {d && d.total_feedback > 0 && d.classified === 0 && sorter}

      {d && d.classified > 0 && (
        <div className="space-y-6">
          <Card title="Topics, by how often they come up"
            subtitle={`${d.classified} of ${d.total_feedback} reviews sorted. One review can mention several topics.`}
            actions={d.available_methods.length > 1 ? (
              <div>
                <div id="method-label" className="mb-1 text-xs text-ink-3">Topics found by</div>
                <div className="inline-flex rounded-lg border border-line bg-paper p-0.5 text-sm" role="radiogroup" aria-labelledby="method-label">
                  {(["keyword", "local", "llm"] as const).filter((m) => d.available_methods.includes(m)).map((m) => (
                    <button key={m} role="radio" aria-checked={activeMethod === m} onClick={() => setMethod(m)}
                      className={`rounded-md px-3 py-1 ${activeMethod === m ? "bg-raised font-bold text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}>
                      {METHODS[m].tab}
                    </button>
                  ))}
                </div>
              </div>
            ) : undefined}>
            {activeMethod === "keyword" && (
              <Callout tone="caution" className="mb-5">
                These topics come from simple keyword matching, so expect some mistakes. Sorting with AI or your own model is more accurate.
              </Callout>
            )}
            {d.classified < 30 && (
              <p className="mb-4 text-sm text-ink-2">Only {d.classified} reviews so far. Treat the counts as a rough hint.</p>
            )}
            {d.themes.length === 0 ? <EmptyState title="No topics found" /> : (
              <HBarChart rows={d.themes.map((t) => ({ label: humanize(t.theme), value: t.count }))} valueLabel="Reviews" />
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {d.themes.map((t) => {
              const showingAll = theme === t.theme && items.data;
              return (
                <Card key={t.theme} title={humanize(t.theme)} subtitle={d.taxonomy[t.theme]}>
                  <p className="num text-sm text-ink">
                    <strong>{plural(t.count, "review")}</strong>
                    <span className="text-ink-2"> ({t.share_pct ?? "—"}% of those sorted)</span>
                  </p>
                  {activeMethod !== "keyword" && (
                    <p className="num mt-1 text-sm text-ink-2">
                      <span className="text-down">{t.negative ?? 0} negative</span>, <span className="text-route">{t.positive ?? 0} positive</span>, {t.mixed ?? 0} mixed
                    </p>
                  )}
                  <ul className="mt-5 space-y-4">
                    {(showingAll ? items.data! : t.examples ?? []).map((f) => (
                      <li key={f.evidence_id} className="border-l-2 border-line pl-4">
                        <p className="text-sm text-ink">“{f.text}”</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                          {f.rating !== null && <span>Rated {f.rating}</span>}
                          {f.sentiment && <span>{humanize(f.sentiment)}</span>}
                          <span>{f.source}</span>
                          <EvidenceLink id={f.evidence_id} />
                        </div>
                      </li>
                    ))}
                  </ul>
                  {t.count > (t.examples?.length ?? 0) && (
                    <button onClick={() => setTheme(theme === t.theme ? null : t.theme)}
                      className="mt-5 text-sm font-bold text-route underline decoration-route/40 underline-offset-4 hover:decoration-route">
                      {theme === t.theme ? "Show fewer" : `Show all ${t.count}`}
                    </button>
                  )}
                </Card>
              );
            })}
          </div>

          {sorter}
        </div>
      )}
    </>
  );
}

function Sorter({ available, busy, aiReady, onSort, firstTime }: {
  available: LabelMethod[]; busy: LabelMethod | null; aiReady: boolean; onSort: (m: LabelMethod) => void; firstTime: boolean;
}) {
  return (
    <Card title={firstTime ? "Sort your reviews into topics" : "Sort the reviews again"}
      subtitle={firstTime ? "Pick how. You can try another way later and switch between the results." : "Run this after importing new reviews."}>
      <ul className="divide-y divide-line">
        {available.map((m) => {
          const blocked = m === "llm" && !aiReady;
          return (
            <li key={m} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4 first:pt-0 last:pb-0">
              <div className="max-w-xl">
                <div className="font-bold text-ink">{METHODS[m].tab}</div>
                <p className="text-sm text-ink-2">{METHODS[m].about}</p>
                {blocked && <p className="mt-1 text-xs text-ink-3">Not available yet: add an ANTHROPIC_API_KEY to backend/.env to turn on AI.</p>}
              </div>
              <Button variant={m === "keyword" && firstTime ? "primary" : "secondary"} onClick={() => onSort(m)} disabled={!!busy || blocked}>
                {busy === m ? "Sorting…" : METHODS[m].button}
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

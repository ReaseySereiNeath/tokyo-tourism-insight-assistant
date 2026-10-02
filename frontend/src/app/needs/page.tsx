"use client";

import { useState } from "react";
import { HBarChart } from "@/components/charts";
import { useScope } from "@/components/providers";
import { Badge, Button, Card, EmptyState, ErrorState, EvidenceLink, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";
import type { FeedbackItem, ThemeSummary } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function NeedsPage() {
  const { scope } = useScope();
  const [method, setMethod] = useState<"keyword" | "llm" | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [theme, setTheme] = useState<string | null>(null);
  const health = useApi(() => api.get<{ ai_configured: boolean; model: string | null }>("/api/health", null), []);
  const summary = useApi(() => api.get<ThemeSummary>("/api/feedback/themes", scope, { method }), [scope, method]);
  const activeMethod = summary.data?.method ?? "keyword";
  const items = useApi(
    () => theme ? api.get<FeedbackItem[]>("/api/feedback", scope, { theme, method: activeMethod }) : Promise.resolve(null),
    [scope, theme, activeMethod]);

  async function classify(m: "keyword" | "llm") {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.post<{ classified: number; error?: string | null; missing_labels?: number }>("/api/feedback/classify", scope, { method: m });
      setNotice(r.error
        ? { tone: "bad", text: `Stopped early: ${r.error} (${r.classified} items labeled before the error).` }
        : { tone: "good", text: `${r.classified} items labeled using ${m === "llm" ? "the language model" : "keyword rules"}.` });
      setMethod(m);
      summary.reload();
    } catch (e) {
      setNotice({ tone: "bad", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const d = summary.data;
  return (
    <>
      <PageHeader title="Customer needs"
        description="Themes in visitor feedback, with counts, the sample size behind them, and the original comments."
        actions={<>
          <Button onClick={() => classify("keyword")} disabled={busy}>Re-run keyword rules</Button>
          <Button variant="primary" onClick={() => classify("llm")} disabled={busy || !health.data?.ai_configured}
            title={health.data?.ai_configured ? "Uses the language-model API (costs money)" : "Set ANTHROPIC_API_KEY to enable"}>
            {busy ? "Working…" : "Classify with AI"}
          </Button>
        </>} />

      {health.data && !health.data.ai_configured && (
        <p className="mb-4 text-xs text-ink-3">AI classification is off because no API key is configured. Keyword rules work offline.</p>
      )}
      {notice && <div className={`mb-4 rounded-lg border p-3 text-sm ${notice.tone === "good" ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"}`} role="status">{notice.text}</div>}
      {summary.loading && <Loading />}
      {summary.error && <ErrorState message={summary.error} onRetry={summary.reload} />}
      {d && d.total_feedback === 0 && <EmptyState title="No feedback imported">Use the feedback template on Sources &amp; imports. Only import feedback you have permission to use.</EmptyState>}

      {d && d.total_feedback > 0 && (
        <div className="space-y-6">
          <Card title="Theme frequency"
            subtitle={`${d.classified} of ${d.total_feedback} feedback items classified · percentages use the ${d.classified} classified items as the base · an item can have several themes`}
            actions={d.available_methods.length > 1 ? (
              <div className="inline-flex rounded-lg border border-line p-0.5 text-xs">
                {(["keyword", "llm"] as const).filter((m) => d.available_methods.includes(m)).map((m) => (
                  <button key={m} onClick={() => setMethod(m)} className={`rounded-md px-2.5 py-1 ${activeMethod === m ? "bg-sunken font-medium text-ink" : "text-ink-2"}`}>
                    {m === "llm" ? "AI labels" : "Keyword labels"}
                  </button>
                ))}
              </div>
            ) : undefined}>
            <div className="mb-3 flex flex-wrap gap-2">
              {activeMethod === "keyword"
                ? <Badge tone="warn">Keyword rules: simple word matching, not AI. Expect misses and mislabels.</Badge>
                : <Badge tone="info">Labels from a language model. Spot-check the examples.</Badge>}
              {d.classified < 30 && <Badge tone="warn">Small sample (n={d.classified})</Badge>}
            </div>
            {d.themes.length === 0 ? <EmptyState title="No themes yet — run a classification" /> : (
              <HBarChart rows={d.themes.map((t) => ({ label: humanize(t.theme), value: t.count }))} valueLabel="Feedback items" />
            )}
            <p className="mt-2 text-xs text-ink-3">
              How often a theme comes up is a signal to investigate. It does not show how many customers would pay for a change.
            </p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {d.themes.map((t) => (
              <Card key={t.theme} title={humanize(t.theme)}
                subtitle={<>{d.taxonomy[t.theme]} · <span className="num">{t.count} items ({t.share_pct ?? "—"}%)</span>
                  {activeMethod === "llm" && <> · {t.negative ?? 0} negative / {t.positive ?? 0} positive / {t.mixed ?? 0} mixed</>}</>}
                actions={<button onClick={() => setTheme(theme === t.theme ? null : t.theme)} className="text-xs text-accent underline">{theme === t.theme ? "Hide all" : "Show all"}</button>}>
                <ul className="space-y-3">
                  {(theme === t.theme && items.data ? items.data : t.examples ?? []).map((f) => (
                    <li key={f.evidence_id} className="text-sm">
                      <p className="text-ink">“{f.text}”</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                        <EvidenceLink id={f.evidence_id} />
                        <span>{f.source}</span>
                        <span>lang: {f.language}</span>
                        {f.rating !== null && <span>rating {f.rating}</span>}
                        {f.sentiment && <span>{f.sentiment}</span>}
                        <span>published {f.publication_date ?? "unknown"} · collected {f.collection_date}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                {theme === t.theme && items.loading && <Loading />}
              </Card>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

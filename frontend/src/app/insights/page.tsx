"use client";

import Link from "next/link";
import { useState } from "react";
import { useScope } from "@/components/providers";
import { ScorecardRow } from "@/components/scorecard";
import { Badge, Button, Callout, Card, EmptyState, ErrorState, EvidenceLink, Loading, MoreDetail, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { BusinessType, EvidencePack, Fact, FounderProfile, Opportunity, QualityAction, Report, ReportListItem, ReportResult } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const STATUS_WORDS: Record<string, string> = { success: "Complete", partial: "Partly complete", failed: "Failed" };
const SUFFICIENCY_WORDS = {
  sufficient: "Yes, there is enough data for these ideas.",
  limited: "Only partly. Treat these ideas as starting points.",
  insufficient: "No. Add more data before acting on anything here.",
};
const CONFIDENCE_WORDS = { low: "Not very sure", medium: "Fairly sure", high: "Quite sure" };
const FIT_WORDS = {
  strong: { text: "Strong fit with you", tone: "good" }, moderate: { text: "Moderate fit with you", tone: "info" },
  weak: { text: "Weak fit with you", tone: "warn" }, unknown: { text: "Fit unknown: fill in About you", tone: "neutral" },
} as const;
const TYPE_WORDS: Record<BusinessType, string> = {
  tours_activities: "Tours and activities", food_drink: "Food and drink", accommodation: "Accommodation",
  retail_shopping: "Shop or retail", transport_mobility: "Transport", wellness_beauty: "Wellness and beauty",
  events_entertainment: "Events and entertainment", services_other: "Services",
};

export default function BusinessIdeasPage() {
  const { scope } = useScope();
  return <IdeasContent key={scope} />;
}

function IdeasContent() {
  const { scope } = useScope();
  const health = useApi(() => api.get<{
    ai_configured: boolean; model: string | null; local_ai: { running: boolean; model: string; ready: boolean };
  }>("/api/health", null), []);
  const profile = useApi(() => api.get<FounderProfile>("/api/profile", scope), [scope]);
  const list = useApi(() => api.get<ReportListItem[]>("/api/reports", scope), [scope]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view, setView] = useState<"report" | "preview">("report");
  const [generating, setGenerating] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const currentId = selectedId ?? list.data?.[0]?.id ?? null;
  const report = useApi(() => currentId ? api.get<Report>(`/api/reports/${currentId}`, scope) : Promise.resolve(null), [scope, currentId]);
  const preview = useApi(() => view === "preview" ? api.get<EvidencePack>("/api/reports/preview", scope) : Promise.resolve(null), [scope, view]);

  async function generate(provider: "anthropic" | "local" | "demo") {
    setGenerating(provider);
    setGenError(null);
    try {
      const r = await api.post<Report>("/api/reports", scope, { provider });
      setSelectedId(r.id);
      setView("report");
      list.reload();
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setGenerating(null);
    }
  }

  const aiReady = !!health.data?.ai_configured;
  const local = health.data?.local_ai;
  const localReady = !!local?.ready;
  const profileEmpty = profile.data && Object.values(profile.data).every((v) => !v);

  return (
    <>
      <PageHeader title="Business ideas"
        description="Tourism businesses worth considering, ranked, each tied to the numbers behind it. The app calculates every number itself; the AI only explains them and matches them to you."
        actions={<>
          <Button onClick={() => setView("preview")}>See what the AI reads</Button>
          {scope === "demo" && (
            <Button variant="primary" onClick={() => generate("demo")} disabled={!!generating}>
              {generating === "demo" ? "Creating…" : "Create a sample report"}
            </Button>
          )}
          <Button variant={scope === "real" && !aiReady ? "primary" : "secondary"} onClick={() => generate("local")}
            disabled={!localReady || !!generating}
            title={localReady ? `Runs ${local?.model} on this Mac. Free, and nothing leaves your computer.` : "Local AI isn't ready: see the note below"}>
            {generating === "local" ? "Thinking on your Mac… (a few minutes)" : "Find ideas with local AI (free)"}
          </Button>
          {aiReady && (
            <Button variant={scope === "real" ? "primary" : "secondary"} onClick={() => generate("anthropic")} disabled={!!generating}
              title={`Uses ${health.data?.model}. Each report costs a small amount.`}>
              {generating === "anthropic" ? "Finding ideas… (about a minute)" : "Find ideas with Claude"}
            </Button>
          )}
        </>} />

      <div className="mb-6 space-y-3">
        {local && !localReady && (
          <Callout title="Local AI isn't ready yet">
            {!local.running
              ? <>Ollama isn&apos;t running. Start it in Terminal with <code>brew services start ollama</code>, then reload this page.</>
              : <>The model isn&apos;t downloaded. In Terminal, run <code>ollama pull {local.model}</code> (about 9 GB), then reload this page.</>}
          </Callout>
        )}
        {generating === "local" && (
          <Callout>
            The open-source model is reading about 80 facts on your Mac. It usually takes 2 to 5 minutes; keep this page open.
          </Callout>
        )}
        {profileEmpty && (
          <Callout tone="caution">
            The ideas can&apos;t be matched to you yet: tell the app your budget, skills and goals first.{" "}
            <Link href="/profile" className="font-bold underline">Fill in About you</Link>
          </Callout>
        )}
        {genError && <ErrorState message={genError} />}
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_15rem]">
        <div className="min-w-0">
          {view === "preview" ? (
            <PreviewView loading={preview.loading} error={preview.error} pack={preview.data} onClose={() => setView("report")} />
          ) : (
            <>
              {(list.loading || report.loading) && !report.data && <Loading />}
              {list.data && list.data.length === 0 && (
                <EmptyState title="No business ideas yet">
                  Fill in About you, check what the AI will read, then find your first ideas. It works best once visitor and spending data are both in.
                </EmptyState>
              )}
              {report.error && <ErrorState message={report.error} onRetry={report.reload} />}
              {report.data && <ReportView report={report.data} />}
            </>
          )}
        </div>
        <aside>
          <h2 className="mb-3 text-base font-bold text-ink">Earlier reports</h2>
          {list.data?.length ? (
            <ul className="space-y-1">
              {list.data.map((r) => {
                const active = r.id === currentId && view === "report";
                return (
                  <li key={r.id}>
                    <button onClick={() => { setSelectedId(r.id); setView("report"); }} aria-current={active ? "true" : undefined}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${active ? "border-route bg-raised" : "border-transparent hover:bg-raised"}`}>
                      <div className="font-bold text-ink">{fmtDateTime(r.created_at)}</div>
                      <div className="text-xs text-ink-3">
                        {r.is_example ? "Sample" : "AI"}, {(STATUS_WORDS[r.status] ?? r.status).toLowerCase()}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-sm text-ink-3">None yet.</p>}
        </aside>
      </div>
    </>
  );
}

function ReportView({ report }: { report: Report }) {
  const facts = new Map(report.evidence.facts.map((f) => [f.id, f]));
  const r = report.result;
  const removed = report.validation.removed_opportunities ?? [];
  return (
    <div className="space-y-6">
      {report.is_example ? (
        <Callout tone="caution" title="This is a sample report, not real analysis">
          It was made by fixed rules from the made-up sample data. No AI was used, and nothing here describes the real market.
          It shows how business ideas and their evidence links look.
        </Callout>
      ) : (
        <p className="text-sm text-ink-2">
          Written by {report.model} on {fmtDateTime(report.created_at)}.
          {report.evidence.scope === "demo" && <strong className="text-caution-ink"> It was given the made-up sample data.</strong>}
        </p>
      )}

      {report.status === "failed" && <ErrorState message={report.error ?? "The report could not be created."} />}
      {report.validation.schema_errors && report.validation.schema_errors.length > 0 && (
        <Callout tone="bad" title="The AI's answer was rejected because it was in the wrong format">
          <ul className="mt-1 list-disc pl-5 text-xs">
            {report.validation.schema_errors.map((e, i) => <li key={i}>{e.location}: {e.message}</li>)}
          </ul>
        </Callout>
      )}

      {r && (
        <>
          <Card title="In short">
            <p className="text-base leading-relaxed text-ink">{r.summary}</p>
            <p className="mt-4 text-sm text-ink-2">
              <strong className="text-ink">Enough data?</strong> {SUFFICIENCY_WORDS[r.data_sufficiency]}
            </p>
            {r.sufficiency_notes.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-ink-2">{r.sufficiency_notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            )}
          </Card>

          {r.opportunities.length === 0 && <EmptyState title="No idea was well enough supported by the data to show" />}
          {r.opportunities.map((o, i) => <IdeaCard key={i} n={i + 1} o={o} facts={facts} />)}

          {r.rejected_ideas?.length > 0 && (
            <Card title="Ideas considered but not recommended" subtitle="Obvious options the analysis looked at and set aside, with the reason.">
              <ul className="divide-y divide-line">
                {r.rejected_ideas.map((x, i) => (
                  <li key={i} className="py-2.5 text-sm first:pt-0 last:pb-0">
                    <span className="font-bold text-ink">{x.idea}</span>
                    <span className="text-ink-2">: {x.reason}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {r.questions_to_research.length > 0 && (
            <Card title="Questions to answer before choosing" subtitle="Things the data hints at but can't confirm. Talking to visitors or business owners can.">
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink">{r.questions_to_research.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </Card>
          )}
        </>
      )}

      <MoreDetail summary="How this report was checked">
        <ul className="space-y-1 text-sm text-ink-2">
          <li>The answer was in the expected format: {report.validation.schema_valid ? "yes" : "no"}.</li>
          <li>Every source the AI cited was checked against your data ({report.validation.checked_ids ?? 0} checked).</li>
          <li>Ideas removed for citing sources that don&apos;t exist: {removed.length}.</li>
          {report.validation.provider_error && <li>Error from the AI service: {report.validation.provider_error}</li>}
          {(report.validation.quality?.actions ?? []).map((a, i) => <li key={i}>{qualityWords(a, r)}</li>)}
        </ul>
        {removed.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-ink-3">
            {removed.map((x) => <li key={x.index}>Removed: “{x.idea}” (cited {x.invalid_ids.map((b) => b.id).join(", ")})</li>)}
          </ul>
        )}
        <MoreDetail summary={`What the AI was given (${report.evidence.facts.length} facts, ${report.evidence.documents.length} texts)`} className="mt-4">
          <PackDetails pack={report.evidence} />
        </MoreDetail>
      </MoreDetail>
    </div>
  );
}

function qualityWords(a: QualityAction, r: ReportResult | null): string {
  const idea = a.index !== undefined ? `Idea ${a.index + 1}` : a.rejected_index !== undefined
    ? `Rejected idea “${r?.rejected_ideas[a.rejected_index]?.idea ?? a.rejected_index + 1}”` : "The report";
  switch (a.check) {
    case "evidence_filled": return `${idea}: the AI listed fact numbers only, so the facts themselves are shown.`;
    case "unverified_numbers": return `${idea}: contains numbers not found in the evidence (${a.numbers?.join(", ")}).`;
    case "confidence_capped": return `${idea}: confidence lowered. ${a.note ?? ""}`;
    case "big_first_test": return `${idea}: the first test is a big commitment; a cheaper trial is suggested.`;
    case "sufficiency_lowered": return "“Enough data?” lowered to “only partly”, because About you is empty.";
    case "type_corrected": return `${idea}: business type corrected to match the spending it relies on.`;
    case "citations_fixed": return `${idea}: cited a fact about a different item; the right scorecard is shown instead.`;
  }
}

function IdeaCard({ n, o, facts }: { n: number; o: Opportunity; facts: Map<string, Fact> }) {
  const factIds = o.evidence_ids.filter((id) => facts.has(id));
  const recordIds = o.evidence_ids.filter((id) => !facts.has(id));
  return (
    <section className="rounded-xl border border-line bg-raised p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div>
          <div className="text-sm text-ink-3">Idea {n}, {TYPE_WORDS[o.business_type].toLowerCase()}</div>
          <h2 className="mt-0.5 text-2xl font-bold text-ink">{o.business_idea}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
          <Badge tone={FIT_WORDS[o.fit_with_you ?? "unknown"].tone}>{FIT_WORDS[o.fit_with_you ?? "unknown"].text}</Badge>
          <span>{CONFIDENCE_WORDS[o.confidence]}</span>
        </div>
      </div>
      <div className="space-y-6 text-sm">
        <Part label="Why there is demand">
          <p className="text-base text-ink">{o.demand_evidence}</p>
          {(factIds.length > 0 || recordIds.length > 0) && (
            <div className="mt-3 space-y-1.5">
              {factIds.map((id) => {
                const fact = facts.get(id)!;
                // Skip the sentence when the evidence text already quotes it; keep the link to the calculation.
                const repeated = o.demand_evidence.includes(fact.statement);
                return (
                  <p key={id} className="text-ink-2">
                    {!repeated && <>{fact.statement} </>}
                    <EvidenceLink id={id} fact={fact} label="How it was calculated" />
                  </p>
                );
              })}
              {recordIds.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-2">
                  Based on:
                  {recordIds.map((id, j) => <EvidenceLink key={id} id={id} label={`record ${j + 1}`} />)}
                </div>
              )}
            </div>
          )}
        </Part>
        {o.scorecards?.length > 0 && (
          <Part label="Demand scorecard (calculated by the app, not the AI)">
            <div className="divide-y divide-line border-y border-line">
              {o.scorecards.map((c) => <ScorecardRow key={c.key} c={c} />)}
            </div>
          </Part>
        )}
        {o.why_now && <Part label="Why now"><p className="text-ink-2">{o.why_now}</p></Part>}
        <Part label="Why it could suit you">
          <p className="text-ink-2">{o.why_it_could_work}</p>
          {o.target_visitors && (
            <p className="mt-1 text-ink-2"><strong className="text-ink">Aim at:</strong> {o.target_visitors}{o.target_support && ` (${o.target_support})`}</p>
          )}
        </Part>
        <div className="grid gap-5 rounded-lg bg-route-soft p-5 md:grid-cols-2">
          <Part label="Try this first"><p className="text-ink">{o.first_test}</p></Part>
          <Part label="Go further if"><p className="text-ink">{o.success_measure}</p></Part>
        </div>
        {o.checks_before_starting.length > 0 && (
          <Part label="Check before you start">
            <ul className="list-disc space-y-1 pl-5 text-ink">{o.checks_before_starting.map((c, j) => <li key={j}>{c}</li>)}</ul>
          </Part>
        )}
        {(o.risks.length > 0 || o.alternative_explanations.length > 0) && (
          <MoreDetail summary="Why this might be wrong">
            <ul className="list-disc space-y-1 pl-5 text-ink-2">
              {o.risks.map((l, j) => <li key={`r${j}`}>{l}</li>)}
              {o.alternative_explanations.map((l, j) => <li key={`a${j}`}>{l}</li>)}
            </ul>
          </MoreDetail>
        )}
      </div>
    </section>
  );
}

function Part({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-bold text-ink">{label}</h3>
      {children}
    </div>
  );
}

function PreviewView({ loading, error, pack, onClose }: { loading: boolean; error: string | null; pack: EvidencePack | null; onClose: () => void }) {
  return (
    <Card title="What the AI will read" subtitle="Exactly what a new report would be given right now. Nothing is sent until you create a report."
      actions={<Button onClick={onClose}>Back to the report</Button>}>
      {loading && <Loading />}
      {error && <ErrorState message={error} />}
      {pack && <PackDetails pack={pack} />}
    </Card>
  );
}

function PackDetails({ pack }: { pack: EvidencePack }) {
  return (
    <div className="space-y-6 text-sm">
      <Part label="Missing data">
        {pack.data_gaps.length ? <ul className="list-disc space-y-0.5 pl-5 text-ink-2">{pack.data_gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
          : <p className="text-ink-3">Nothing obvious is missing.</p>}
      </Part>
      <Part label={`Facts calculated from your data (${pack.facts.length})`}>
        {pack.facts.length === 0 ? <p className="text-ink-3">None yet. Import data first.</p> : (
          <ul className="divide-y divide-line">
            {pack.facts.map((f) => (
              <li key={f.id} className="py-2 text-ink-2">
                {f.statement} <EvidenceLink id={f.id} fact={f} label="Details" />
              </li>
            ))}
          </ul>
        )}
      </Part>
      <Part label={`Reviews, news and tours included as text (${pack.documents.length})`}>
        <p className="mb-2 text-ink-2">The AI is told to treat these as quotes to read, never as instructions to follow.</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">{pack.documents.map((d, i) => <EvidenceLink key={d.evidence_id} id={d.evidence_id} label={`${i + 1}`} />)}</div>
      </Part>
      <p className="text-xs text-ink-3">
        Uses {pack.size.chars.toLocaleString()} of the {pack.size.limit_chars.toLocaleString()} characters allowed.
        {pack.size.documents_dropped > 0 && ` ${pack.size.documents_dropped} texts were left out to stay within the limit.`}
      </p>
    </div>
  );
}

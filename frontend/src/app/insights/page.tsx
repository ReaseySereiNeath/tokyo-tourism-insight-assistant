"use client";

import Link from "next/link";
import { useState } from "react";
import { useScope } from "@/components/providers";
import { Button, Callout, Card, EmptyState, ErrorState, EvidenceLink, Loading, MoreDetail, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { BusinessProfile, EvidencePack, Fact, Insight, Report, ReportListItem } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const STATUS_WORDS: Record<string, string> = { success: "Complete", partial: "Partly complete", failed: "Failed" };
const SUFFICIENCY_WORDS = {
  sufficient: "Yes, there is enough data for these ideas.",
  limited: "Only partly. Treat these ideas as starting points.",
  insufficient: "No. Add more data before acting on anything here.",
};
const CONFIDENCE_WORDS = { low: "Not very sure", medium: "Fairly sure", high: "Quite sure" };

export default function IdeasPage() {
  const { scope } = useScope();
  return <IdeasContent key={scope} />;
}

function IdeasContent() {
  const { scope } = useScope();
  const health = useApi(() => api.get<{ ai_configured: boolean; model: string | null }>("/api/health", null), []);
  const profile = useApi(() => api.get<BusinessProfile>("/api/profile", scope), [scope]);
  const list = useApi(() => api.get<ReportListItem[]>("/api/reports", scope), [scope]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view, setView] = useState<"report" | "preview">("report");
  const [generating, setGenerating] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const currentId = selectedId ?? list.data?.[0]?.id ?? null;
  const report = useApi(() => currentId ? api.get<Report>(`/api/reports/${currentId}`, scope) : Promise.resolve(null), [scope, currentId]);
  const preview = useApi(() => view === "preview" ? api.get<EvidencePack>("/api/reports/preview", scope) : Promise.resolve(null), [scope, view]);

  async function generate(provider: "anthropic" | "demo") {
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
  const profileEmpty = profile.data && Object.values(profile.data).every((v) => !v);

  return (
    <>
      <PageHeader title="Ideas to test"
        description="Small experiments for your business, each tied to the numbers behind it. The app calculates every number itself; the AI only explains them and suggests what to try."
        actions={<>
          <Button onClick={() => setView("preview")}>See what the AI reads</Button>
          {scope === "demo" && (
            <Button variant="primary" onClick={() => generate("demo")} disabled={!!generating}>
              {generating === "demo" ? "Creating…" : "Create a sample report"}
            </Button>
          )}
          <Button variant={scope === "real" ? "primary" : "secondary"} onClick={() => generate("anthropic")} disabled={!aiReady || !!generating}
            title={aiReady ? `Uses ${health.data?.model}. Each report costs a small amount.` : "Add ANTHROPIC_API_KEY to backend/.env to turn on AI"}>
            {generating === "anthropic" ? "Writing ideas… (about a minute)" : "Create ideas with AI"}
          </Button>
        </>} />

      <div className="mb-6 space-y-3">
        {health.data && !aiReady && (
          <Callout>
            AI is off because no API key is set, so new ideas can&apos;t be created yet. You can still see exactly what the AI would read
            {scope === "real" ? ", or switch to sample data to see an example report." : ", and create a sample report."}
          </Callout>
        )}
        {profileEmpty && (
          <Callout tone="caution">
            The ideas can&apos;t be sized to your business yet because you haven&apos;t described it.{" "}
            <Link href="/profile" className="font-bold underline">Describe your business</Link>
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
                <EmptyState title="No ideas yet">
                  Check what the AI will read first, then create your first report. It works best once visitors, competitors and feedback all have data.
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
  const removed = report.validation.removed_insights ?? [];
  return (
    <div className="space-y-6">
      {report.is_example ? (
        <Callout tone="caution" title="This is a sample report, not real analysis">
          It was made by fixed rules from the made-up sample data. No AI was used, and nothing here describes the real market.
          It shows how reports and their evidence links work.
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

          {r.insights.length === 0 && <EmptyState title="No ideas were well enough supported by the data to show" />}
          {r.insights.map((ins, i) => <IdeaCard key={i} n={i + 1} ins={ins} facts={facts} />)}

          {r.customer_needs_to_investigate.length > 0 && (
            <Card title="Questions to ask your guests" subtitle="Things the data hints at but can't confirm.">
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink">{r.customer_needs_to_investigate.map((q, i) => <li key={i}>{q}</li>)}</ul>
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
        </ul>
        {removed.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-ink-3">
            {removed.map((x) => <li key={x.index}>Removed: “{x.finding}” (cited {x.invalid_ids.map((b) => b.id).join(", ")})</li>)}
          </ul>
        )}
        <MoreDetail summary={`What the AI was given (${report.evidence.facts.length} facts, ${report.evidence.documents.length} texts)`} className="mt-4">
          <PackDetails pack={report.evidence} />
        </MoreDetail>
      </MoreDetail>
    </div>
  );
}

function IdeaCard({ n, ins, facts }: { n: number; ins: Insight; facts: Map<string, Fact> }) {
  const factIds = ins.evidence_ids.filter((id) => facts.has(id));
  const recordIds = ins.evidence_ids.filter((id) => !facts.has(id));
  return (
    <Card title={`Idea ${n}`} actions={<span className="text-sm text-ink-2">{CONFIDENCE_WORDS[ins.confidence]}</span>}>
      <div className="space-y-6 text-sm">
        <Part label="What the data shows">
          <p className="text-base text-ink">{ins.finding}</p>
          {(factIds.length > 0 || recordIds.length > 0) && (
            <div className="mt-3 space-y-1.5">
              {factIds.map((id) => {
                const fact = facts.get(id)!;
                // Skip the sentence when the finding already quotes it; keep the link to the calculation.
                const repeated = ins.finding.includes(fact.statement);
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
        <Part label="What it might mean">
          <p className="text-ink-2">{ins.interpretation}</p>
          {ins.customer_segment && (
            <p className="mt-1 text-ink-2"><strong className="text-ink">Who:</strong> {ins.customer_segment}{ins.segment_support && ` (${ins.segment_support})`}</p>
          )}
        </Part>
        <div className="grid gap-5 rounded-lg bg-route-soft p-5 md:grid-cols-2">
          <Part label="Try this"><p className="text-ink">{ins.proposed_experiment}</p></Part>
          <Part label="You'll know it worked if"><p className="text-ink">{ins.success_measure}</p></Part>
        </div>
        {(ins.limitations.length > 0 || ins.alternative_explanations.length > 0) && (
          <MoreDetail summary="Why this might be wrong">
            <ul className="list-disc space-y-1 pl-5 text-ink-2">
              {ins.limitations.map((l, j) => <li key={`l${j}`}>{l}</li>)}
              {ins.alternative_explanations.map((l, j) => <li key={`a${j}`}>{l}</li>)}
            </ul>
          </MoreDetail>
        )}
      </div>
    </Card>
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

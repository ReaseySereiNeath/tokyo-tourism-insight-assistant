"use client";

import Link from "next/link";
import { useState } from "react";
import { useScope } from "@/components/providers";
import { Badge, Button, Card, EmptyState, ErrorState, EvidenceLink, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime, humanize } from "@/lib/format";
import type { BusinessProfile, EvidencePack, Fact, Report, ReportListItem } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function InsightsPage() {
  const { scope } = useScope();
  return <InsightsContent key={scope} />;
}

function InsightsContent() {
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
      <PageHeader title="Insights"
        description="Findings and suggested experiments, each linked to the evidence it rests on. Numbers come from the app's own calculations, not from the model."
        actions={<>
          <Button onClick={() => setView("preview")}>Preview evidence</Button>
          {scope === "demo" && (
            <Button variant="primary" onClick={() => generate("demo")} disabled={!!generating}>
              {generating === "demo" ? "Generating…" : "Generate example report"}
            </Button>
          )}
          <Button variant={scope === "real" ? "primary" : "secondary"} onClick={() => generate("anthropic")} disabled={!aiReady || !!generating}
            title={aiReady ? `Calls ${health.data?.model} (costs money)` : "Set ANTHROPIC_API_KEY in backend/.env to enable"}>
            {generating === "anthropic" ? "Analysing… (can take a minute)" : scope === "demo" ? "Live AI on demo data" : "Generate report with AI"}
          </Button>
        </>} />

      {health.data && !aiReady && (
        <div className="mb-4 rounded-lg border border-line bg-sunken p-3 text-sm text-ink-2">
          Live AI analysis is off: no API key is configured. You can still preview the exact evidence a report would use
          {scope === "real" ? ", or switch to Demo to see an example report." : ", and generate a clearly labeled example report from demo data."}
        </div>
      )}
      {profileEmpty && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          Your business profile is empty, so experiments can&apos;t be tailored to your capacity and budget.{" "}
          <Link href="/profile" className="underline">Fill it in</Link>.
        </div>
      )}
      {genError && <div className="mb-4"><ErrorState message={genError} /></div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div className="min-w-0">
          {view === "preview" ? (
            <PreviewView loading={preview.loading} error={preview.error} pack={preview.data} onClose={() => setView("report")} />
          ) : (
            <>
              {(list.loading || report.loading) && <Loading />}
              {list.data && list.data.length === 0 && (
                <EmptyState title="No reports yet">Preview the evidence first, then generate a report.</EmptyState>
              )}
              {report.error && <ErrorState message={report.error} onRetry={report.reload} />}
              {report.data && <ReportView report={report.data} />}
            </>
          )}
        </div>
        <aside>
          <Card title="Report history">
            {list.data?.length ? (
              <ul className="space-y-1">
                {list.data.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => { setSelectedId(r.id); setView("report"); }}
                      className={`w-full rounded-md px-2 py-1.5 text-left text-xs ${r.id === currentId && view === "report" ? "bg-sunken" : "hover:bg-sunken"}`}>
                      <div className="font-medium text-ink">#{r.id} · {fmtDateTime(r.created_at)}</div>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {r.is_example ? <Badge tone="warn">Example</Badge> : <Badge tone="info">Live AI</Badge>}
                        <Badge tone={r.status === "success" ? "good" : r.status === "partial" ? "warn" : "bad"}>{r.status}</Badge>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-ink-3">None yet.</p>}
          </Card>
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
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100" role="note">
          <div className="text-sm font-bold uppercase tracking-wide">Example report — not live AI analysis</div>
          <p className="mt-1 text-sm">Generated by fixed rules from synthetic demo data. No language model was called and nothing here describes the real market. It shows how reports, evidence links and validation work.</p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
          <Badge tone="info">Live AI analysis</Badge> model {report.model} · {fmtDateTime(report.created_at)}
          {report.evidence.scope === "demo" && <Badge tone="warn">Input was SYNTHETIC demo data</Badge>}
        </div>
      )}

      {report.status === "failed" && <ErrorState message={report.error ?? "The report failed."} />}
      {report.validation.schema_errors && report.validation.schema_errors.length > 0 && (
        <Card title="Why the answer was rejected">
          <ul className="list-disc pl-5 text-xs text-ink-2">
            {report.validation.schema_errors.map((e, i) => <li key={i}><code>{e.location}</code>: {e.message}</li>)}
          </ul>
        </Card>
      )}

      {r && (
        <>
          <Card title="Summary">
            <p className="text-sm leading-relaxed text-ink">{r.summary}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone={r.data_sufficiency === "sufficient" ? "good" : r.data_sufficiency === "limited" ? "warn" : "bad"}>
                Evidence: {r.data_sufficiency}
              </Badge>
            </div>
            {r.sufficiency_notes.length > 0 && (
              <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-ink-2">{r.sufficiency_notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            )}
          </Card>

          {r.insights.length === 0 && <EmptyState title="No insights met the evidence requirements" />}
          {r.insights.map((ins, i) => (
            <Card key={i} title={`Insight ${i + 1}`} actions={<Badge tone={ins.confidence === "high" ? "good" : ins.confidence === "medium" ? "info" : "warn"}>{ins.confidence} confidence</Badge>}>
              <div className="space-y-4 text-sm">
                <Section label="Finding"><p className="text-ink">{ins.finding}</p></Section>
                <Section label="Supporting evidence">
                  <div className="flex flex-wrap gap-1.5">{ins.evidence_ids.map((id) => <EvidenceLink key={id} id={id} fact={facts.get(id)} />)}</div>
                </Section>
                <Section label="Interpretation"><p className="text-ink-2">{ins.interpretation}</p></Section>
                <Section label="Customer segment">
                  {ins.customer_segment
                    ? <p className="text-ink-2">{ins.customer_segment}{ins.segment_support && <span className="text-ink-3"> — {ins.segment_support}</span>}</p>
                    : <p className="text-ink-3">Not identified: the evidence does not support a specific segment.</p>}
                </Section>
                <div className="grid gap-4 md:grid-cols-2">
                  <Section label="Proposed experiment"><p className="text-ink">{ins.proposed_experiment}</p></Section>
                  <Section label="Success measure"><p className="text-ink">{ins.success_measure}</p></Section>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Section label="Limitations"><ul className="list-disc pl-5 text-ink-2">{ins.limitations.map((l, j) => <li key={j}>{l}</li>)}</ul></Section>
                  <Section label="Alternative explanations"><ul className="list-disc pl-5 text-ink-2">{ins.alternative_explanations.map((l, j) => <li key={j}>{l}</li>)}</ul></Section>
                </div>
              </div>
            </Card>
          ))}

          {r.customer_needs_to_investigate.length > 0 && (
            <Card title="Customer needs to investigate">
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">{r.customer_needs_to_investigate.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </Card>
          )}
        </>
      )}

      <Card title="Validation" subtitle="Checks run on the model's answer before it was shown">
        <ul className="space-y-1 text-xs text-ink-2">
          <li>Structure matches the required format: {report.validation.schema_valid ? "yes" : "no"}</li>
          <li>Evidence IDs checked: {report.validation.checked_ids ?? 0}</li>
          <li>Insights removed for citing evidence that does not exist: {removed.length}</li>
          {report.validation.provider_error && <li>Provider error: {report.validation.provider_error}</li>}
        </ul>
        {removed.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-ink-3">
            {removed.map((x) => <li key={x.index}>Removed: “{x.finding}” — {x.invalid_ids.map((b) => `${b.id} (${b.reason})`).join(", ")}</li>)}
          </ul>
        )}
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-accent">Evidence pack this report received ({report.evidence.facts.length} facts, {report.evidence.documents.length} documents)</summary>
          <PackDetails pack={report.evidence} />
        </details>
      </Card>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-3">{label}</div>
      {children}
    </div>
  );
}

function PreviewView({ loading, error, pack, onClose }: { loading: boolean; error: string | null; pack: EvidencePack | null; onClose: () => void }) {
  return (
    <Card title="Evidence preview" subtitle="Exactly what a report would receive right now. No AI is called."
      actions={<button onClick={onClose} className="text-xs text-accent underline">Back to report</button>}>
      {loading && <Loading />}
      {error && <ErrorState message={error} />}
      {pack && <PackDetails pack={pack} />}
    </Card>
  );
}

function PackDetails({ pack }: { pack: EvidencePack }) {
  return (
    <div className="mt-3 space-y-4 text-xs">
      <div>
        <div className="mb-1 font-medium text-ink-2">Data gaps</div>
        {pack.data_gaps.length ? <ul className="list-disc pl-5 text-ink-2">{pack.data_gaps.map((g, i) => <li key={i}>{g}</li>)}</ul> : <p className="text-ink-3">None detected.</p>}
      </div>
      <div>
        <div className="mb-1 font-medium text-ink-2">Computed facts ({pack.facts.length})</div>
        {pack.facts.length === 0 ? <p className="text-ink-3">No facts: import data first.</p> : (
          <ul className="space-y-1.5">
            {pack.facts.map((f: Fact) => (
              <li key={f.id} className="flex gap-2">
                <EvidenceLink id={f.id} fact={f} />
                <span className="text-ink-2"><span className="text-ink-3">[{humanize(f.kind)}]</span> {f.statement}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="mb-1 font-medium text-ink-2">Documents ({pack.documents.length}, sent as untrusted text)</div>
        <div className="flex flex-wrap gap-1.5">{pack.documents.map((d) => <EvidenceLink key={d.evidence_id} id={d.evidence_id} />)}</div>
      </div>
      <p className="text-ink-3">Size: {pack.size.chars.toLocaleString()} of {pack.size.limit_chars.toLocaleString()} characters · {pack.size.documents_dropped} documents left out.</p>
    </div>
  );
}

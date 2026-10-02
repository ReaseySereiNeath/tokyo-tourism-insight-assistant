"use client";

import { useEffect } from "react";
import { useApi } from "@/lib/useApi";
import { api, type Scope } from "@/lib/api";
import { fmtDateTime, humanize } from "@/lib/format";
import type { EvidenceDetail, Fact } from "@/lib/types";
import { Badge, ErrorState, Loading } from "./ui";

interface Target {
  id: string;
  fact?: Fact;
}

const DATE_LABELS: Record<string, string> = {
  reporting_month: "Reporting period",
  publication_date: "Publication date",
  collection_date: "Collection date",
  date_observed: "Date observed",
};
const HIDDEN = new Set(["evidence_id", "batch_id", "created_at", "updated_at"]);

export function EvidenceDrawer({ target, scope, onClose, onOpen }: {
  target: Target | null; scope: Scope; onClose: () => void; onOpen: (t: Target) => void;
}) {
  const isFact = !!target && /^F\d+$/.test(target.id);
  const { data: detail, error } = useApi(
    () => target && !isFact
      ? api.get<EvidenceDetail>(`/api/evidence/${encodeURIComponent(target.id)}`, scope)
      : Promise.resolve(null),
    [target?.id ?? null, scope]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!target) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Evidence ${target.id}`}>
      <button className="absolute inset-0 bg-black/30" onClick={onClose} aria-label="Close evidence panel" />
      <div className="relative h-full w-full max-w-xl overflow-y-auto border-l border-line bg-raised p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-ink-3">{isFact ? "Computed fact" : "Evidence record"}</div>
            <div className="font-mono text-lg text-ink">{target.id}</div>
          </div>
          <button onClick={onClose} className="rounded-md border border-line px-2 py-1 text-sm text-ink-2 hover:bg-sunken">Close</button>
        </div>

        {isFact && (target.fact ? (
          <div className="space-y-4 text-sm">
            <p className="text-ink">{target.fact.statement}</p>
            <p className="text-xs text-ink-3">
              Calculated in Python from the records below, before the report was written. The model received this
              statement; it did not calculate it.
            </p>
            <div>
              <div className="mb-2 text-xs font-medium text-ink-2">Underlying records ({target.fact.evidence_ids.length})</div>
              {target.fact.evidence_ids.length === 0 ? (
                <p className="text-xs text-ink-3">This summary fact has no individual record links.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {target.fact.evidence_ids.map((id) => (
                    <button key={id} onClick={() => onOpen({ id })}
                      className="rounded border border-line bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-accent hover:border-accent">
                      {id}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-2">Open this fact from its report to see the calculation.</p>
        ))}

        {!isFact && !detail && !error && <Loading />}
        {error && <ErrorState message={error} />}
        {detail && <RecordDetail d={detail} />}
      </div>
    </div>
  );
}

function RecordDetail({ d }: { d: EvidenceDetail }) {
  const rec = d.record;
  const dates = Object.keys(DATE_LABELS).filter((k) => k in rec);
  const fields = Object.entries(rec).filter(([k]) => !HIDDEN.has(k) && !(k in DATE_LABELS));
  return (
    <div className="space-y-6 text-sm">
      <div>
        <Badge>{humanize(d.type)}</Badge>
        {typeof rec.value_status === "string" && rec.value_status !== "final" && (
          <span className="ml-2"><Badge tone="warn">{String(rec.value_status)}</Badge></span>
        )}
      </div>

      {typeof rec.text === "string" && (
        <blockquote className="rounded-lg border-l-4 border-accent bg-sunken p-3 text-ink">{rec.text}</blockquote>
      )}

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
        {fields.filter(([k]) => k !== "text").map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-3">{humanize(k)}</dt>
            <dd className="break-words text-ink">
              {v === null || v === "" ? <span className="text-ink-3">not recorded</span>
                : k === "url" ? <a href={String(v)} target="_blank" rel="noreferrer" className="text-accent underline">{String(v)}</a>
                : String(v)}
            </dd>
          </div>
        ))}
      </dl>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Dates</h3>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
          {dates.map((k) => (
            <div key={k} className="contents">
              <dt className="text-ink-3">{DATE_LABELS[k]}</dt>
              <dd className="text-ink">{rec[k] ? String(rec[k]) : <span className="text-ink-3">unknown</span>}</dd>
            </div>
          ))}
        </dl>
      </div>

      {d.themes && d.themes.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Theme labels</h3>
          <ul className="space-y-1">
            {d.themes.map((t) => (
              <li key={t.theme + t.method} className="flex flex-wrap items-center gap-2">
                <Badge>{humanize(t.theme)}</Badge>
                <span className="text-xs text-ink-3">
                  {t.method === "llm" ? `language model (${t.model})` : "keyword rules"}
                  {t.sentiment ? ` · ${t.sentiment}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Provenance</h3>
        {d.import_batch ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-ink-3">Imported from</dt><dd className="break-all text-ink">{d.import_batch.original_filename}</dd>
            <dt className="text-ink-3">Import batch</dt><dd className="text-ink">#{d.import_batch.id} · {d.import_batch.importer} · {fmtDateTime(d.import_batch.completed_at)}</dd>
            <dt className="text-ink-3">Original file kept at</dt><dd className="break-all font-mono text-xs text-ink-2">{d.import_batch.raw_path}</dd>
            <dt className="text-ink-3">File SHA-256</dt><dd className="break-all font-mono text-xs text-ink-2">{d.import_batch.file_sha256}</dd>
          </dl>
        ) : <p className="text-ink-3">No import batch recorded.</p>}
      </div>

      {d.source && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Source & usage conditions</h3>
          <p className="text-ink">{d.source.attribution}</p>
          <p className="mt-1 text-xs text-ink-2">{d.source.license_note}</p>
          {d.source.url && <a href={d.source.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-accent underline">{d.source.url}</a>}
        </div>
      )}

      {d.revisions.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Revision history</h3>
          <ul className="space-y-1 text-xs text-ink-2">
            {d.revisions.map((r, i) => (
              <li key={i}>{fmtDateTime(r.changed_at)} · {r.field}: {r.old_value ?? "—"} → {r.new_value} (batch #{r.batch_id})</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

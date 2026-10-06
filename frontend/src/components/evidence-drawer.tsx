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
  reporting_month: "Month described",
  publication_date: "Publication date",
  collection_date: "Collection date",
  date_observed: "Date checked",
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
      <div className="relative h-full w-full max-w-xl overflow-y-auto border-l border-line bg-raised p-6 shadow-2xl sm:p-8">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-ink">{isFact ? "How this number was calculated" : "Where this comes from"}</h2>
            <div className="mt-0.5 text-xs text-ink-3">Record {target.id}</div>
          </div>
          <button onClick={onClose} className="rounded-lg border border-line px-3 py-1.5 text-sm font-bold text-ink hover:bg-sunken">Close</button>
        </div>

        {isFact && (target.fact ? (
          <div className="space-y-4 text-sm">
            <p className="text-ink">{target.fact.statement}</p>
            <p className="text-xs text-ink-3">
              The app calculated this from the records below before the report was written. The AI was given the
              finished sentence; it didn&apos;t do the maths.
            </p>
            <div>
              <h3 className="mb-2 text-sm font-bold text-ink">Records it was calculated from ({target.fact.evidence_ids.length})</h3>
              {target.fact.evidence_ids.length === 0 ? (
                <p className="text-xs text-ink-3">This is a summary of the whole dataset, so there are no single records to show.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {target.fact.evidence_ids.map((id, i) => (
                    <button key={id} onClick={() => onOpen({ id })} title={id}
                      className="rounded-md border border-line px-2 py-0.5 text-xs font-medium text-route hover:border-route">
                      Record {i + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-2">Open this from its report to see the calculation.</p>
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
          <span className="ml-2"><Badge tone="warn">Early estimate</Badge></span>
        )}
      </div>

      {typeof rec.text === "string" && (
        <blockquote className="border-l-4 border-route bg-paper p-3 text-base text-ink">“{rec.text}”</blockquote>
      )}

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
        {fields.filter(([k]) => k !== "text").map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-3">{humanize(k)}</dt>
            <dd className="break-words text-ink">
              {v === null || v === "" ? <span className="text-ink-3">Not recorded</span>
                : k === "url" ? <a href={String(v)} target="_blank" rel="noreferrer" className="break-all text-route underline">{String(v)}</a>
                : String(v)}
            </dd>
          </div>
        ))}
      </dl>

      <div>
        <h3 className="mb-2 text-sm font-bold text-ink">Dates</h3>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
          {dates.map((k) => (
            <div key={k} className="contents">
              <dt className="text-ink-3">{DATE_LABELS[k]}</dt>
              <dd className="text-ink">{rec[k] ? String(rec[k]) : <span className="text-ink-3">Unknown</span>}</dd>
            </div>
          ))}
        </dl>
      </div>

      {d.themes && d.themes.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-bold text-ink">Topics</h3>
          <ul className="space-y-1">
            {d.themes.map((t) => (
              <li key={t.theme + t.method} className="flex flex-wrap items-center gap-2">
                <Badge>{humanize(t.theme)}</Badge>
                <span className="text-xs text-ink-3">
                  {t.method === "llm" ? `found by AI (${t.model})` : t.method === "local" ? `found by your trained model` : "found by keyword matching"}
                  {t.sentiment ? ` · ${t.sentiment}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-bold text-ink">Imported from</h3>
        {d.import_batch ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-ink-3">File</dt><dd className="break-all text-ink">{d.import_batch.original_filename}</dd>
            <dt className="text-ink-3">Imported on</dt><dd className="text-ink">{fmtDateTime(d.import_batch.completed_at)}</dd>
            <dt className="text-ink-3">Original file kept at</dt><dd className="break-all text-xs text-ink-2">{d.import_batch.raw_path}</dd>
            <dt className="text-ink-3">File fingerprint</dt><dd className="break-all text-xs text-ink-2">{d.import_batch.file_sha256}</dd>
          </dl>
        ) : <p className="text-ink-3">No import recorded.</p>}
      </div>

      {d.source && (
        <div>
          <h3 className="mb-2 text-sm font-bold text-ink">Source and conditions of use</h3>
          <p className="text-ink">{d.source.attribution}</p>
          <p className="mt-1 text-xs text-ink-2">{d.source.license_note}</p>
          {d.source.url && <a href={d.source.url} target="_blank" rel="noreferrer" className="mt-1 inline-block break-all text-xs text-route underline">{d.source.url}</a>}
        </div>
      )}

      {d.revisions.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-bold text-ink">Changes since first import</h3>
          <ul className="space-y-1 text-xs text-ink-2">
            {d.revisions.map((r, i) => (
              <li key={i}>{fmtDateTime(r.changed_at)}: {humanize(r.field)} changed from {r.old_value ?? "nothing"} to {r.new_value}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

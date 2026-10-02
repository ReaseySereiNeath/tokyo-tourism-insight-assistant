"use client";

import { useState } from "react";
import { useScope } from "@/components/providers";
import { Badge, Button, Card, EmptyState, ErrorState, inputClass, Loading, PageHeader } from "@/components/ui";
import { api, buildUrl } from "@/lib/api";
import { fmtDateTime, humanize } from "@/lib/format";
import type { DatasetGuide, ImportBatch } from "@/lib/types";
import { useApi } from "@/lib/useApi";

interface Source { name: string; publisher: string; url: string; attribution: string; license_note: string; access_method: string }

export default function SourcesPage() {
  const { scope } = useScope();
  const guides = useApi(() => api.get<{ datasets: DatasetGuide[]; importers: Record<string, string> }>("/api/imports/datasets", null), []);
  const history = useApi(() => api.get<ImportBatch[]>("/api/imports", scope), [scope]);
  const sources = useApi(() => api.get<Source[]>("/api/sources", scope), [scope]);
  const [result, setResult] = useState<ImportBatch | null>(null);
  const [openBatch, setOpenBatch] = useState<number | null>(null);

  const onImported = (b: ImportBatch) => {
    setResult(b);
    history.reload();
  };

  return (
    <>
      <PageHeader title="Sources & imports"
        description="Import files, check validation errors, and trace every record back to the file it came from. Original files are kept unchanged on your Mac." />
      {scope === "demo" && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          You are in demo mode: files imported here go into the <strong>demo</strong> database only. Switch to “My data” to import real files.
          <DemoReset onDone={() => history.reload()} />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <UploadCard guides={guides.data?.datasets ?? []} importers={guides.data?.importers ?? {}} onImported={onImported} />
        <FeedCard onImported={onImported} />
      </div>

      {result && <BatchResult batch={result} onClose={() => setResult(null)} />}

      <Card title="Import history" className="mt-6">
        {history.loading && <Loading />}
        {history.error && <ErrorState message={history.error} onRetry={history.reload} />}
        {history.data && history.data.length === 0 && <EmptyState title="Nothing imported yet" />}
        {history.data && history.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-3">
                <tr>
                  <th className="py-2 font-medium">#</th><th className="py-2 font-medium">File</th><th className="py-2 font-medium">Dataset</th>
                  <th className="py-2 font-medium">Status</th><th className="py-2 text-right font-medium">New</th><th className="py-2 text-right font-medium">Duplicates</th>
                  <th className="py-2 text-right font-medium">Updated</th><th className="py-2 text-right font-medium">Errors</th><th className="py-2 pl-3 font-medium">Completed</th><th />
                </tr>
              </thead>
              <tbody className="num">
                {history.data.map((b) => (
                  <tr key={b.id} className="border-t border-line">
                    <td className="py-1.5 text-ink-3">{b.id}</td>
                    <td className="max-w-56 truncate py-1.5 text-ink" title={b.original_filename ?? ""}>{b.original_filename}</td>
                    <td className="py-1.5 text-ink-2">{humanize(b.dataset)}</td>
                    <td className="py-1.5"><Badge tone={b.status === "success" ? "good" : "bad"}>{b.status}</Badge></td>
                    <td className="py-1.5 text-right">{b.rows_inserted}</td>
                    <td className="py-1.5 text-right text-ink-2">{b.rows_duplicate}</td>
                    <td className="py-1.5 text-right text-ink-2">{b.rows_updated}</td>
                    <td className="py-1.5 text-right">{b.error_count}</td>
                    <td className="py-1.5 pl-3 text-xs text-ink-2">{fmtDateTime(b.completed_at)}</td>
                    <td className="py-1.5 pl-3"><button onClick={() => setOpenBatch(openBatch === b.id ? null : b.id)} className="text-xs text-accent underline">{openBatch === b.id ? "Hide" : "Details"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {openBatch !== null && <BatchDetails id={openBatch} />}
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="Known sources and usage conditions" subtitle="Checked on the source websites when this app was built. Re-check before relying on them.">
          {sources.data?.map((s) => (
            <div key={s.name} className="mb-4 border-b border-line pb-4 text-sm last:mb-0 last:border-0 last:pb-0">
              <div className="font-medium text-ink">{s.name} <span className="font-normal text-ink-3">· {s.publisher}</span></div>
              <a href={s.url} target="_blank" rel="noreferrer" className="text-xs text-accent underline">{s.url}</a>
              <p className="mt-1 text-xs text-ink-2"><strong className="font-medium">Attribution:</strong> {s.attribution}</p>
              <p className="mt-1 text-xs text-ink-2"><strong className="font-medium">Conditions:</strong> {s.license_note}</p>
              <p className="mt-1 text-xs text-ink-2"><strong className="font-medium">How to collect:</strong> {s.access_method}</p>
            </div>
          ))}
        </Card>
        <Card title="Templates and required columns">
          {guides.data?.datasets.map((g) => (
            <details key={g.dataset} className="mb-3 text-sm">
              <summary className="cursor-pointer font-medium text-ink">{g.label}</summary>
              <div className="mt-2 flex gap-3 text-xs">
                <a className="text-accent underline" href={buildUrl(`/api/imports/templates/${g.dataset}`, null)}>Blank template (CSV)</a>
                <a className="text-accent underline" href={buildUrl(`/api/imports/templates/${g.dataset}`, null, { example: true })}>With example row</a>
              </div>
              <table className="mt-2 w-full text-xs">
                <tbody>
                  {g.columns.map((c) => (
                    <tr key={c.name} className="border-t border-line align-top">
                      <td className="py-1 pr-2 font-mono text-ink">{c.name}{c.required && <span className="text-red-600">*</span>}</td>
                      <td className="py-1 text-ink-2">{c.description} <span className="text-ink-3">e.g. {c.example}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-ink-3">* required. Duplicate key: {g.key_fields.join(" + ")}.</p>
              {g.notes.map((n, i) => <p key={i} className="mt-1 text-xs text-ink-2">{n}</p>)}
            </details>
          ))}
        </Card>
      </div>
    </>
  );
}

function UploadCard({ guides, importers, onImported }: { guides: DatasetGuide[]; importers: Record<string, string>; onImported: (b: ImportBatch) => void }) {
  const { scope } = useScope();
  const [dataset, setDataset] = useState("visitor_stats");
  const [importer, setImporter] = useState("auto");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("dataset", dataset);
    form.append("importer", importer);
    form.append("file", file);
    try {
      onImported(await api.upload<ImportBatch>(scope, form));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Import a file" subtitle={`CSV or Excel (.xlsx), up to 20 MB · into the ${scope === "demo" ? "DEMO" : "real"} database`}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-ink-2">Dataset
          <select className={`${inputClass} mt-1 block w-full`} value={dataset}
            onChange={(e) => { setDataset(e.target.value); if (e.target.value !== "visitor_stats") setImporter("auto"); }}>
            {guides.map((g) => <option key={g.dataset} value={g.dataset}>{g.label}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-ink-2">File format
          <select className={`${inputClass} mt-1 block w-full`} value={importer} onChange={(e) => setImporter(e.target.value)}>
            {Object.entries(importers).filter(([k]) => k === "auto" || dataset === "visitor_stats").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {importer === "jnto_monthly_xlsx" && (
          <p className="text-xs text-ink-2">
            Download “訪日外客数（総数）” monthly XLSX from{" "}
            <a className="text-accent underline" href="https://www.jnto.go.jp/statistics/data/visitors-statistics/" target="_blank" rel="noreferrer">JNTO</a>{" "}
            and upload it unchanged. Blank cells (unpublished months) stay missing; italic figures are stored as estimates.
          </p>
        )}
        <input type="file" accept=".csv,.xlsx,.xlsm" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-lg file:border file:border-line file:bg-sunken file:px-3 file:py-1.5 file:text-sm file:text-ink" />
        <Button variant="primary" type="submit" disabled={!file || busy}>{busy ? "Importing…" : "Validate & import"}</Button>
        {error && <ErrorState message={error} />}
        <p className="text-xs text-ink-3">If any row is invalid, nothing from the file is imported and every problem is listed. Re-importing the same data never creates duplicates.</p>
      </form>
    </Card>
  );
}

function FeedCard({ onImported }: { onImported: (b: ImportBatch) => void }) {
  const { scope } = useScope();
  const [url, setUrl] = useState("");
  const [publisher, setPublisher] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onImported(await api.post<ImportBatch>("/api/imports/news-feed", scope, {}, { url, publisher: publisher || null, permission_confirmed: confirmed }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Import news from an RSS/Atom feed" subtitle="Only feeds whose terms allow you to store headlines and short excerpts">
      <form onSubmit={submit} className="space-y-3">
        <input className={`${inputClass} w-full`} type="url" required placeholder="https://example.com/feed.xml" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Feed URL" />
        <input className={`${inputClass} w-full`} placeholder="Publisher name (optional)" value={publisher} onChange={(e) => setPublisher(e.target.value)} aria-label="Publisher" />
        <label className="flex items-start gap-2 text-xs text-ink-2">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
          I have checked this feed&apos;s terms and may store its headlines, links and short excerpts for internal research.
        </label>
        <Button type="submit" disabled={!url || !confirmed || busy}>{busy ? "Fetching…" : "Fetch feed"}</Button>
        {error && <ErrorState message={error} />}
        <p className="text-xs text-ink-3">One request to the URL you enter. No crawling, no login or paywall access. Manual CSV import is always available.</p>
      </form>
    </Card>
  );
}

function BatchResult({ batch, onClose }: { batch: ImportBatch; onClose: () => void }) {
  const ok = batch.status === "success";
  return (
    <Card className="mt-6" title={ok ? `Imported ${batch.original_filename}` : `Rejected ${batch.original_filename}`}
      subtitle={`Import #${batch.id}`} actions={<button onClick={onClose} className="text-xs text-accent underline">Dismiss</button>}>
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge tone={ok ? "good" : "bad"}>{batch.status}</Badge>
        <Badge>{batch.rows_total} rows read</Badge>
        <Badge tone="good">{batch.rows_inserted} new</Badge>
        <Badge>{batch.rows_duplicate} duplicates skipped</Badge>
        <Badge tone={batch.rows_updated ? "warn" : "neutral"}>{batch.rows_updated} revised</Badge>
      </div>
      {batch.warnings && batch.warnings.length > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-amber-800 dark:text-amber-300">{batch.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}
      {batch.errors && batch.errors.length > 0 && <ErrorTable errors={batch.errors} />}
    </Card>
  );
}

function ErrorTable({ errors }: { errors: NonNullable<ImportBatch["errors"]> }) {
  return (
    <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-red-200 dark:border-red-900">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-red-50 text-left text-red-900 dark:bg-red-950 dark:text-red-200">
          <tr><th className="px-3 py-1.5 font-medium">Row</th><th className="px-3 py-1.5 font-medium">Column</th><th className="px-3 py-1.5 font-medium">Problem</th></tr>
        </thead>
        <tbody>
          {errors.map((e, i) => (
            <tr key={i} className="border-t border-red-100 dark:border-red-900">
              <td className="num px-3 py-1.5 text-ink">{e.row ?? "file"}</td>
              <td className="px-3 py-1.5 font-mono text-ink-2">{e.column ?? "—"}</td>
              <td className="px-3 py-1.5 text-ink">{e.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {errors.length >= 200 && <p className="px-3 py-1.5 text-xs text-ink-3">Showing the first 200 problems.</p>}
    </div>
  );
}

function BatchDetails({ id }: { id: number }) {
  const { scope } = useScope();
  const batch = useApi(() => api.get<ImportBatch>(`/api/imports/${id}`, scope), [scope, id]);
  const records = useApi(() => api.get<Record<string, unknown>[]>(`/api/imports/${id}/records`, scope, { limit: 20 }), [scope, id]);
  if (batch.loading) return <Loading />;
  if (batch.error || !batch.data) return <ErrorState message={batch.error ?? "Not found"} />;
  const b = batch.data;
  return (
    <div className="mt-4 rounded-lg border border-line bg-sunken p-4 text-xs">
      <div className="grid gap-1 text-ink-2">
        <div><span className="text-ink-3">Importer:</span> {b.importer}</div>
        <div className="break-all"><span className="text-ink-3">Original file kept at:</span> <span className="font-mono">{b.raw_path}</span></div>
        <div className="break-all"><span className="text-ink-3">SHA-256:</span> <span className="font-mono">{b.file_sha256}</span></div>
      </div>
      {b.warnings && b.warnings.length > 0 && <ul className="mt-2 list-disc pl-5 text-amber-800 dark:text-amber-300">{b.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      {b.errors && b.errors.length > 0 && <ErrorTable errors={b.errors} />}
      {records.data && records.data.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 font-medium text-ink-2">Records whose latest version came from this import (first 20)</div>
          <ul className="space-y-0.5 font-mono text-[11px] text-ink-2">
            {records.data.map((r) => <li key={String(r.evidence_id)} className="truncate">{String(r.evidence_id)} · {String(r.title ?? r.text ?? r.tour_name ?? `${r.visitor_origin} ${r.reporting_month}: ${r.value}`)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function DemoReset({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<"idle" | "confirm" | "busy">("idle");
  if (state === "idle") return <button onClick={() => setState("confirm")} className="ml-2 underline">Reset demo data</button>;
  if (state === "busy") return <span className="ml-2">Resetting…</span>;
  return (
    <span className="ml-2">
      Rebuild the demo database (your real data is not touched)?{" "}
      <button className="font-medium underline" onClick={async () => { setState("busy"); await api.post("/api/demo/reset", null); setState("idle"); onDone(); }}>Yes, reset</button>{" "}
      <button className="underline" onClick={() => setState("idle")}>Cancel</button>
    </span>
  );
}

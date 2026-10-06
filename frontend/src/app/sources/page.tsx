"use client";

import { useState } from "react";
import { useScope } from "@/components/providers";
import { Badge, Button, Callout, Card, EmptyState, ErrorState, inputClass, Loading, MoreDetail, PageHeader } from "@/components/ui";
import { api, buildUrl } from "@/lib/api";
import { fmtDateTime, humanize } from "@/lib/format";
import type { DatasetGuide, ImportBatch } from "@/lib/types";
import { useApi } from "@/lib/useApi";

interface Source { name: string; publisher: string; url: string; attribution: string; license_note: string; access_method: string }

const DATASET_ABOUT: Record<string, string> = {
  visitor_stats: "Official monthly arrival numbers, such as the JNTO workbook.",
  competitor_offers: "Other operators' tours: name, price, length and language.",
  feedback: "Your guests' reviews and survey answers.",
  news: "Headlines and short excerpts about Tokyo tourism.",
};
const RESULT_WORDS: Record<ImportBatch["status"], { label: string; tone: "good" | "bad" }> = {
  success: { label: "Imported", tone: "good" },
  rejected: { label: "Rejected", tone: "bad" },
  failed: { label: "Failed", tone: "bad" },
};

export default function SourcesPage() {
  const { scope } = useScope();
  const guides = useApi(() => api.get<{ datasets: DatasetGuide[]; importers: Record<string, string> }>("/api/imports/datasets", null), []);
  const history = useApi(() => api.get<ImportBatch[]>("/api/imports", scope), [scope]);
  const sources = useApi(() => api.get<Source[]>("/api/sources", scope), [scope]);
  const [result, setResult] = useState<ImportBatch | null>(null);
  const [openBatch, setOpenBatch] = useState<number | null>(null);

  const datasetLabel = (d: string) => guides.data?.datasets.find((g) => g.dataset === d)?.label ?? humanize(d);
  const onImported = (b: ImportBatch) => {
    setResult(b);
    history.reload();
  };

  return (
    <>
      <PageHeader title="Add your data"
        description="Import files from your Mac. If any row has a problem, nothing is imported and you'll see exactly what to fix. Importing the same file twice never creates duplicates." />
      {scope === "demo" && (
        <Callout tone="caution" className="mb-6">
          You&apos;re adding to the <strong>sample data</strong>, so files imported here won&apos;t show up in your own data.
          Switch to “Your data” at the bottom of the menu to import real files.
          <DemoReset onDone={() => history.reload()} />
        </Callout>
      )}

      <UploadCard guides={guides.data?.datasets ?? []} importers={guides.data?.importers ?? {}} onImported={onImported} />
      {result && <BatchResult batch={result} onClose={() => setResult(null)} />}

      <Card title="Past imports" className="mt-6">
        {history.loading && !history.data && <Loading />}
        {history.error && <ErrorState message={history.error} onRetry={history.reload} />}
        {history.data && history.data.length === 0 && <p className="text-sm text-ink-3">Nothing imported yet.</p>}
        {history.data && history.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-3">
                <tr>
                  <th className="py-2 font-normal">File</th>
                  <th className="py-2 font-normal">Kind of data</th>
                  <th className="py-2 font-normal">Result</th>
                  <th className="py-2 text-right font-normal">New rows</th>
                  <th className="py-2 text-right font-normal">Already had</th>
                  <th className="py-2 text-right font-normal">Updated</th>
                  <th className="py-2 text-right font-normal">Problems</th>
                  <th className="py-2 pl-4 font-normal">When</th>
                  <th className="py-2"><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((b) => (
                  <tr key={b.id} className="border-t border-line">
                    <td className="max-w-56 truncate py-2 font-bold text-ink" title={b.original_filename ?? ""}>{b.original_filename}</td>
                    <td className="py-2 text-ink-2">{datasetLabel(b.dataset)}</td>
                    <td className="py-2"><Badge tone={RESULT_WORDS[b.status].tone}>{RESULT_WORDS[b.status].label}</Badge></td>
                    <td className="num py-2 text-right text-ink">{b.rows_inserted}</td>
                    <td className="num py-2 text-right text-ink-2">{b.rows_duplicate}</td>
                    <td className="num py-2 text-right text-ink-2">{b.rows_updated}</td>
                    <td className={`num py-2 text-right ${b.error_count ? "font-bold text-down" : "text-ink-2"}`}>{b.error_count}</td>
                    <td className="py-2 pl-4 text-ink-2">{fmtDateTime(b.completed_at)}</td>
                    <td className="py-2 pl-3 text-right">
                      <button onClick={() => setOpenBatch(openBatch === b.id ? null : b.id)} className="text-sm font-medium text-route underline underline-offset-2">
                        {openBatch === b.id ? "Hide" : "Details"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {openBatch !== null && <BatchDetails id={openBatch} />}
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <FeedCard onImported={onImported} />
        <Card title="Where official data comes from" subtitle="Checked on each source's website when this app was built. Check again before publishing anything.">
          {sources.data?.map((s) => (
            <div key={s.name} className="border-b border-line pb-4 text-sm last:border-0 last:pb-0 [&+&]:pt-4">
              <div className="font-bold text-ink">{s.name}</div>
              <div className="text-ink-2">{s.publisher}</div>
              <a href={s.url} target="_blank" rel="noreferrer" className="text-sm text-route underline underline-offset-2 break-all">{s.url}</a>
              <MoreDetail summary="How to collect it and what you may do with it" className="mt-2">
                <dl className="space-y-2 text-ink-2">
                  <div><dt className="font-bold text-ink">How to collect</dt><dd>{s.access_method}</dd></div>
                  <div><dt className="font-bold text-ink">Credit it as</dt><dd>{s.attribution}</dd></div>
                  <div><dt className="font-bold text-ink">Conditions</dt><dd>{s.license_note}</dd></div>
                </dl>
              </MoreDetail>
            </div>
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
  const guide = guides.find((g) => g.dataset === dataset);

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
    <Card title="Import a file" subtitle={`A CSV or Excel file up to 20 MB. It goes into ${scope === "demo" ? "the sample data" : "your data"}.`}>
      <form onSubmit={submit} className="space-y-6">
        <fieldset>
          <legend className="mb-2 text-sm font-bold text-ink">What kind of data is it?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {guides.map((g) => (
              <label key={g.dataset}
                className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${dataset === g.dataset ? "border-route bg-route-soft" : "border-line hover:border-ink-3"}`}>
                <input type="radio" name="dataset" value={g.dataset} checked={dataset === g.dataset} className="mt-1 accent-route"
                  onChange={() => { setDataset(g.dataset); if (g.dataset !== "visitor_stats") setImporter("auto"); }} />
                <span>
                  <span className="block font-bold text-ink">{g.label}</span>
                  <span className="block text-ink-2">{DATASET_ABOUT[g.dataset]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {dataset === "visitor_stats" && (
          <label className="block text-sm font-bold text-ink">File type
            <select className={`${inputClass} mt-1 block w-full max-w-md font-normal`} value={importer} onChange={(e) => setImporter(e.target.value)}>
              {Object.entries(importers).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        )}
        {importer === "jnto_monthly_xlsx" && (
          <p className="max-w-2xl text-sm text-ink-2">
            Download the “訪日外客数（総数）” monthly XLSX from{" "}
            <a className="text-route underline" href="https://www.jnto.go.jp/statistics/data/visitors-statistics/" target="_blank" rel="noreferrer">JNTO</a>{" "}
            and upload it as it is. Months JNTO hasn&apos;t published stay empty, and figures in italics are saved as early estimates.
          </p>
        )}

        <div>
          <label className="block text-sm font-bold text-ink" htmlFor="file">Choose the file</label>
          <input id="file" type="file" accept=".csv,.xlsx,.xlsm" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm text-ink-2 file:mr-3 file:rounded-lg file:border file:border-line file:bg-sunken file:px-4 file:py-2 file:text-sm file:font-bold file:text-ink" />
          {guide && (
            <p className="mt-2 text-sm text-ink-2">
              No file yet? Download the template:{" "}
              <a className="text-route underline underline-offset-2" href={buildUrl(`/api/imports/templates/${guide.dataset}`, null)}>blank</a> or{" "}
              <a className="text-route underline underline-offset-2" href={buildUrl(`/api/imports/templates/${guide.dataset}`, null, { example: true })}>with an example row</a>.
            </p>
          )}
        </div>

        {guide && (
          <MoreDetail summary={`Columns a ${guide.label.toLowerCase()} file needs`}>
            <table className="w-full max-w-3xl text-sm">
              <tbody>
                {guide.columns.map((c) => (
                  <tr key={c.name} className="border-t border-line align-top">
                    <td className="py-1.5 pr-4 font-bold text-ink">{c.name}{c.required ? "" : <span className="font-normal text-ink-3"> (optional)</span>}</td>
                    <td className="py-1.5 text-ink-2">{c.description} <span className="text-ink-3">For example: {c.example}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {guide.notes.map((n, i) => <p key={i} className="mt-2 max-w-2xl text-ink-2">{n}</p>)}
          </MoreDetail>
        )}

        <Button variant="primary" type="submit" disabled={!file || busy}>{busy ? "Importing…" : "Import file"}</Button>
        {error && <ErrorState message={error} />}
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
    <Card title="Add news from a website's feed" subtitle="For sites that publish an RSS or Atom feed and allow you to keep their headlines.">
      <form onSubmit={submit} className="space-y-3">
        <input className={`${inputClass} w-full`} type="url" required placeholder="https://example.com/feed.xml" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Feed address" />
        <input className={`${inputClass} w-full`} placeholder="Publisher name (optional)" value={publisher} onChange={(e) => setPublisher(e.target.value)} aria-label="Publisher" />
        <label className="flex items-start gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 accent-route" />
          I checked this site&apos;s terms, and I may keep its headlines, links and short excerpts for my own research.
        </label>
        <Button type="submit" disabled={!url || !confirmed || busy}>{busy ? "Fetching…" : "Fetch the feed"}</Button>
        {error && <ErrorState message={error} />}
        <p className="text-xs text-ink-3">The app reads that one address once. It doesn&apos;t crawl the site or get past logins or paywalls.</p>
      </form>
    </Card>
  );
}

function BatchResult({ batch, onClose }: { batch: ImportBatch; onClose: () => void }) {
  const ok = batch.status === "success";
  return (
    <section role="status" className={`mt-6 rounded-xl border-l-4 bg-raised p-6 ${ok ? "border-route" : "border-down"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-xl font-bold text-ink">{ok ? `Imported ${batch.original_filename}` : `Nothing was imported from ${batch.original_filename}`}</h2>
        <button onClick={onClose} className="text-sm text-ink-2 underline">Dismiss</button>
      </div>
      <p className="num mt-2 text-sm text-ink-2">
        {ok
          ? `Read ${batch.rows_total} rows: ${batch.rows_inserted} new, ${batch.rows_duplicate} you already had, ${batch.rows_updated} updated with newer figures.`
          : `Fix the ${batch.errors?.length ?? 0} problems below in your file, then import it again.`}
      </p>
      {batch.warnings && batch.warnings.length > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-caution-ink">{batch.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}
      {batch.errors && batch.errors.length > 0 && <ErrorTable errors={batch.errors} />}
    </section>
  );
}

function ErrorTable({ errors }: { errors: NonNullable<ImportBatch["errors"]> }) {
  return (
    <div className="mt-4 max-h-80 overflow-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-down-soft text-left text-ink">
          <tr><th className="px-3 py-2 font-bold">Row</th><th className="px-3 py-2 font-bold">Column</th><th className="px-3 py-2 font-bold">What to fix</th></tr>
        </thead>
        <tbody>
          {errors.map((e, i) => (
            <tr key={i} className="border-t border-line">
              <td className="num px-3 py-1.5 text-ink">{e.row ?? "Whole file"}</td>
              <td className="px-3 py-1.5 text-ink-2">{e.column ?? "—"}</td>
              <td className="px-3 py-1.5 text-ink">{e.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {errors.length >= 200 && <p className="px-3 py-2 text-xs text-ink-3">Showing the first 200 problems.</p>}
    </div>
  );
}

function BatchDetails({ id }: { id: number }) {
  const { scope } = useScope();
  const batch = useApi(() => api.get<ImportBatch>(`/api/imports/${id}`, scope), [scope, id]);
  const records = useApi(() => api.get<Record<string, unknown>[]>(`/api/imports/${id}/records`, scope, { limit: 20 }), [scope, id]);
  if (batch.loading) return <Loading />;
  if (batch.error || !batch.data) return <ErrorState message={batch.error ?? "This import could not be found."} />;
  const b = batch.data;
  return (
    <div className="mt-4 space-y-3 rounded-lg bg-sunken p-4 text-sm">
      <dl className="grid gap-x-4 gap-y-1 text-ink-2 sm:grid-cols-[max-content_1fr]">
        <dt className="text-ink-3">Read as</dt><dd>{b.importer}</dd>
        <dt className="text-ink-3">Original file kept at</dt><dd className="break-all">{b.raw_path}</dd>
        <dt className="text-ink-3">File fingerprint</dt><dd className="break-all text-xs">{b.file_sha256}</dd>
      </dl>
      {b.warnings && b.warnings.length > 0 && <ul className="list-disc pl-5 text-caution-ink">{b.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      {b.errors && b.errors.length > 0 && <ErrorTable errors={b.errors} />}
      {records.data && records.data.length > 0 && (
        <div>
          <div className="mb-1 font-bold text-ink">First rows from this file</div>
          <ul className="space-y-0.5 text-ink-2">
            {records.data.map((r) => <li key={String(r.evidence_id)} className="truncate">{String(r.title ?? r.text ?? r.tour_name ?? `${r.visitor_origin}, ${r.reporting_month}: ${r.value}`)}</li>)}
          </ul>
        </div>
      )}
      {records.data && records.data.length === 0 && <EmptyState title="No rows from this file are in use" />}
    </div>
  );
}

function DemoReset({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<"idle" | "confirm" | "busy">("idle");
  if (state === "idle") return <button onClick={() => setState("confirm")} className="ml-1 font-bold underline">Reset the sample data</button>;
  if (state === "busy") return <span className="ml-1">Resetting…</span>;
  return (
    <span className="ml-1">
      Rebuild the sample data from scratch? Your own data isn&apos;t touched.{" "}
      <button className="font-bold underline" onClick={async () => { setState("busy"); await api.post("/api/demo/reset", null); setState("idle"); onDone(); }}>Yes, reset</button>{" "}
      <button className="underline" onClick={() => setState("idle")}>Cancel</button>
    </span>
  );
}

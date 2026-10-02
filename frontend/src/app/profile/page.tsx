"use client";

import { useState } from "react";
import { useScope } from "@/components/providers";
import { Button, Card, ErrorState, inputClass, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import type { BusinessProfile } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const FIELDS: { key: keyof BusinessProfile; label: string; hint: string; long?: boolean }[] = [
  { key: "business_name", label: "Business name", hint: "" },
  { key: "offerings", label: "Current offerings", hint: "Tours, length, stops, languages", long: true },
  { key: "operating_area", label: "Operating area", hint: "Neighbourhoods you run tours in" },
  { key: "capacity", label: "Capacity", hint: "Guides, group size, tours per week" },
  { key: "price_range", label: "Price range", hint: "e.g. JPY 8,000–14,000 per adult" },
  { key: "monthly_budget", label: "Budget for experiments", hint: "Money and time you can spend per month" },
  { key: "goals", label: "Goals", hint: "What you want to achieve this quarter", long: true },
  { key: "notes", label: "Other context", hint: "Constraints, seasonality, anything the analysis should respect", long: true },
];

const EMPTY: BusinessProfile = { business_name: "", offerings: "", operating_area: "", capacity: "", price_range: "", monthly_budget: "", goals: "", notes: "" };

export default function ProfilePage() {
  const { scope } = useScope();
  const { data, error, loading, reload } = useApi(() => api.get<BusinessProfile>("/api/profile", scope), [scope]);

  return (
    <>
      <PageHeader title="Business profile"
        description="Your business, not your customers. Reports use this to size experiments to your capacity and budget." />
      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && !loading && <ProfileForm key={scope} initial={{ ...EMPTY, ...data }} />}
    </>
  );
}

function ProfileForm({ initial }: { initial: BusinessProfile }) {
  const { scope } = useScope();
  const [form, setForm] = useState<BusinessProfile>(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    try {
      await api.put("/api/profile", scope, form);
      setStatus("saved");
    } catch (err) {
      setSaveError((err as Error).message);
      setStatus("error");
    }
  }

  return (
        <Card>
          <form onSubmit={save} className="grid max-w-3xl gap-4">
            {FIELDS.map((f) => (
              <label key={f.key} className="block text-sm font-medium text-ink">
                {f.label}
                {f.hint && <span className="ml-2 text-xs font-normal text-ink-3">{f.hint}</span>}
                {f.long ? (
                  <textarea rows={3} className={`${inputClass} mt-1 block w-full`} value={form[f.key]}
                    onChange={(e) => { setForm({ ...form, [f.key]: e.target.value }); setStatus("idle"); }} />
                ) : (
                  <input className={`${inputClass} mt-1 block w-full`} value={form[f.key]}
                    onChange={(e) => { setForm({ ...form, [f.key]: e.target.value }); setStatus("idle"); }} />
                )}
              </label>
            ))}
            <div className="flex items-center gap-3">
              <Button variant="primary" type="submit" disabled={status === "saving"}>{status === "saving" ? "Saving…" : "Save profile"}</Button>
              {status === "saved" && <span className="text-sm text-emerald-700 dark:text-emerald-400">Saved.</span>}
              {status === "error" && <span className="text-sm text-red-700">{saveError}</span>}
              <span className="text-xs text-ink-3">Saved separately for {scope === "demo" ? "demo" : "real"} data.</span>
            </div>
          </form>
        </Card>
  );
}

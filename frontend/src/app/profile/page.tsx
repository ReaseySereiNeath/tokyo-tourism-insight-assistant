"use client";

import { useState } from "react";
import { useScope } from "@/components/providers";
import { Button, Card, ErrorState, inputClass, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import type { FounderProfile } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const FIELDS: { key: keyof FounderProfile; label: string; hint: string; long?: boolean }[] = [
  { key: "budget", label: "Money you can put in", hint: "Savings or loans you could use to start, roughly" },
  { key: "time_available", label: "Time you can give it", hint: "Full time, or evenings and weekends? From when?" },
  { key: "location", label: "Where you could run it", hint: "City or ward, or “anywhere in Japan”" },
  { key: "languages", label: "Languages you speak", hint: "And how well" },
  { key: "skills", label: "Skills and experience", hint: "Jobs, qualifications and hobbies that could help, like cooking, guiding or design", long: true },
  { key: "interests", label: "Kinds of business you'd consider", hint: "Or “open to anything”", long: true },
  { key: "limits", label: "Limits", hint: "Things you can't or won't do: a long lease, night work, visa conditions", long: true },
  { key: "goals", label: "What you want from it", hint: "Income you're aiming for, by when, or simply a side project", long: true },
];

const EMPTY: FounderProfile = { budget: "", time_available: "", location: "", languages: "", skills: "", interests: "", limits: "", goals: "" };

export default function ProfilePage() {
  const { scope } = useScope();
  const { data, error, loading, reload } = useApi(() => api.get<FounderProfile>("/api/profile", scope), [scope]);

  return (
    <>
      <PageHeader title="About you"
        description="Business ideas are matched to what you have and want. Rough answers are fine, and you can change them any time." />
      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && !loading && <ProfileForm key={scope} initial={{ ...EMPTY, ...data }} />}
    </>
  );
}

function ProfileForm({ initial }: { initial: FounderProfile }) {
  const { scope } = useScope();
  const [form, setForm] = useState<FounderProfile>(initial);
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
              <label key={f.key} className="block text-sm font-bold text-ink">
                {f.label}
                {f.hint && <span className="mt-0.5 block text-sm font-normal text-ink-2">{f.hint}</span>}
                {f.long ? (
                  <textarea rows={3} className={`${inputClass} mt-2 block w-full font-normal`} value={form[f.key]}
                    onChange={(e) => { setForm({ ...form, [f.key]: e.target.value }); setStatus("idle"); }} />
                ) : (
                  <input className={`${inputClass} mt-2 block w-full font-normal`} value={form[f.key]}
                    onChange={(e) => { setForm({ ...form, [f.key]: e.target.value }); setStatus("idle"); }} />
                )}
              </label>
            ))}
            <div className="flex items-center gap-3">
              <Button variant="primary" type="submit" disabled={status === "saving"}>{status === "saving" ? "Saving…" : "Save changes"}</Button>
              {status === "saved" && <span className="text-sm font-bold text-route" role="status">Changes saved</span>}
              {status === "error" && <span className="text-sm text-down" role="alert">{saveError}</span>}
              {scope === "demo" && <span className="text-sm text-ink-3">This is a made-up sample person. Your own answers are kept separately.</span>}
            </div>
          </form>
        </Card>
  );
}

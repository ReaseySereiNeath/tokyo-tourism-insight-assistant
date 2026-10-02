"use client";

import { useEvidence } from "./providers";
import type { Fact } from "@/lib/types";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, children, className = "", actions }: {
  title?: string; subtitle?: React.ReactNode; children: React.ReactNode; className?: string; actions?: React.ReactNode;
}) {
  return (
    <section className={`rounded-xl border border-line bg-raised p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
            {subtitle && <div className="mt-0.5 text-xs text-ink-3">{subtitle}</div>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</div>
      <div className="num mt-1 text-2xl font-semibold text-ink">{value}</div>
      {note && <div className="mt-0.5 text-xs text-ink-2">{note}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-ink-3" role="status">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
      <div className="font-medium">Something went wrong</div>
      <div className="mt-1">{message}</div>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 rounded-md border border-red-300 px-3 py-1 text-xs font-medium hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900/40">
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-sunken p-6 text-center">
      <div className="text-sm font-medium text-ink">{title}</div>
      {children && <div className="mt-1 text-sm text-ink-2">{children}</div>}
    </div>
  );
}

const BADGE_TONES = {
  neutral: "bg-sunken text-ink-2 border-line",
  info: "bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900",
  warn: "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800",
  good: "bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900",
  bad: "bg-red-50 text-red-900 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900",
};

export function Badge({ tone = "neutral", children, title }: { tone?: keyof typeof BADGE_TONES; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

export function EvidenceLink({ id, fact }: { id: string; fact?: Fact }) {
  const { open } = useEvidence();
  return (
    <button
      onClick={() => open({ id, fact })}
      className="rounded border border-line bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-accent hover:border-accent"
      title="Open evidence"
    >
      {id}
    </button>
  );
}

export function Button({ children, variant = "secondary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  const styles = variant === "primary"
    ? "bg-accent text-white hover:opacity-90 border-transparent"
    : "bg-raised text-ink hover:bg-sunken border-line";
  return (
    <button {...props} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${props.className ?? ""}`}>
      {children}
    </button>
  );
}

export const inputClass = "rounded-lg border border-line bg-raised px-3 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none";

/** Explains which date a value refers to; the three dates are never interchangeable. */
export function DateLegend() {
  return (
    <p className="text-xs text-ink-3">
      <strong className="font-medium text-ink-2">Reporting period</strong> = the month a statistic describes ·{" "}
      <strong className="font-medium text-ink-2">Publication date</strong> = when the source published it ·{" "}
      <strong className="font-medium text-ink-2">Collection date</strong> = when it was obtained.
    </p>
  );
}

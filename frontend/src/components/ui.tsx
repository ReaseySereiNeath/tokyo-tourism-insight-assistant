"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { stationFor } from "@/lib/route";
import type { Fact } from "@/lib/types";
import { useEvidence } from "./providers";

/** A numbered station marker, like the circles on Tokyo station signs. */
export function StationMark({ n, done = false, current = false, size = "md" }: {
  n: number; done?: boolean; current?: boolean; size?: "md" | "lg";
}) {
  const box = size === "lg" ? "h-12 w-12 text-xl border-[5px]" : "h-8 w-8 text-sm border-[3px]";
  const fill = done ? "border-route bg-route text-white dark:text-paper" : "border-route bg-raised text-ink";
  return (
    <span aria-hidden className={`font-display inline-flex shrink-0 items-center justify-center rounded-full font-black leading-none ${box} ${fill} ${current ? "ring-4 ring-route/25" : ""}`}>
      {n}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  const station = stationFor(usePathname());
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="flex max-w-2xl items-start gap-4">
        {station && <StationMark n={station.n} size="lg" />}
        <div>
          <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-ink">{title}</h1>
          {description && <p className="mt-2 text-base text-ink-2">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ title, subtitle, children, className = "", actions }: {
  title?: string; subtitle?: React.ReactNode; children: React.ReactNode; className?: string; actions?: React.ReactNode;
}) {
  return (
    <section className={`rounded-xl border border-line bg-raised p-6 ${className}`}>
      {(title || actions) && (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            {title && <h2 className="text-xl font-bold text-ink">{title}</h2>}
            {subtitle && <div className="mt-1 text-sm text-ink-2">{subtitle}</div>}
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
      <div className="text-sm text-ink-2">{label}</div>
      <div className="num font-display mt-1 text-3xl font-bold text-ink">{value}</div>
      {note && <div className="mt-1 text-xs text-ink-3">{note}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-ink-3" role="status">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-route" />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border-l-4 border-down bg-down-soft p-4 text-sm text-ink">
      <div className="font-bold">That didn&apos;t work</div>
      <div className="mt-1 text-ink-2">{message}</div>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 rounded-md border border-line bg-raised px-3 py-1 text-sm font-medium hover:bg-sunken">
          Try again
        </button>
      )}
    </div>
  );
}

/** An empty area is an invitation to act: say what is missing and link to where to fix it. */
export function EmptyState({ title, children, href, action }: {
  title: string; children?: React.ReactNode; href?: string; action?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-paper p-6">
      <div className="font-bold text-ink">{title}</div>
      {children && <div className="mt-1 max-w-prose text-sm text-ink-2">{children}</div>}
      {href && action && <ButtonLink href={href} className="mt-4">{action}</ButtonLink>}
    </div>
  );
}

const CALLOUT_TONES = {
  caution: "border-caution bg-caution-soft text-caution-ink",
  note: "border-line bg-sunken text-ink-2",
  bad: "border-down bg-down-soft text-ink",
};

/** One plain-language note with a coloured edge. Use sparingly: one per section at most. */
export function Callout({ tone = "note", title, children, className = "" }: {
  tone?: keyof typeof CALLOUT_TONES; title?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div role="note" className={`rounded-lg border-l-4 px-4 py-3 text-sm ${CALLOUT_TONES[tone]} ${className}`}>
      {title && <div className="font-bold">{title}</div>}
      <div className={title ? "mt-0.5" : ""}>{children}</div>
    </div>
  );
}

const BADGE_TONES = {
  neutral: "bg-sunken text-ink-2",
  info: "bg-sunken text-ink",
  warn: "bg-caution-soft text-caution-ink",
  good: "bg-route-soft text-route",
  bad: "bg-down-soft text-down",
};

export function Badge({ tone = "neutral", children, title }: { tone?: keyof typeof BADGE_TONES; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

/** Opens the evidence panel. Shows a short label; the raw ID stays available to screen readers and on hover. */
export function EvidenceLink({ id, fact, label = "Source" }: { id: string; fact?: Fact; label?: React.ReactNode }) {
  const { open } = useEvidence();
  return (
    <button onClick={() => open({ id, fact })} title={`Open record ${id}`} aria-label={`Open source record ${id}`}
      className="inline-flex items-center gap-1 text-xs font-medium text-route underline decoration-route/40 underline-offset-2 hover:decoration-route">
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 1.5h5l3 3v10H4z" /><path d="M6.5 8h3.5M6.5 11h3.5" />
      </svg>
      {label}
    </button>
  );
}

const BUTTON_STYLES = {
  primary: "bg-route text-white hover:brightness-110 border-transparent dark:text-paper",
  secondary: "bg-raised text-ink hover:bg-sunken border-line",
};
const BUTTON_BASE = "inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50";

export function Button({ children, variant = "secondary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_STYLES }) {
  return (
    <button {...props} className={`${BUTTON_BASE} ${BUTTON_STYLES[variant]} ${props.className ?? ""}`}>
      {children}
    </button>
  );
}

export function ButtonLink({ href, children, variant = "primary", className = "" }: {
  href: string; children: React.ReactNode; variant?: keyof typeof BUTTON_STYLES; className?: string;
}) {
  return <Link href={href} className={`${BUTTON_BASE} ${BUTTON_STYLES[variant]} ${className}`}>{children}</Link>;
}

/** Secondary detail that most visits do not need, folded away. */
export function MoreDetail({ summary, children, className = "" }: { summary: string; children: React.ReactNode; className?: string }) {
  return (
    <details className={`group text-sm ${className}`}>
      <summary className="cursor-pointer list-none font-medium text-route [&::-webkit-details-marker]:hidden">
        <span className="mr-1 inline-block transition-transform group-open:rotate-90" aria-hidden>›</span>{summary}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export const inputClass = "rounded-lg border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-route focus:outline-none";

/** Explains which date a value refers to; the three dates are never interchangeable. */
export function DateLegend() {
  return (
    <ul className="space-y-1 text-sm text-ink-2">
      <li><strong className="font-bold text-ink">Reporting period</strong>: the month a statistic describes.</li>
      <li><strong className="font-bold text-ink">Publication date</strong>: when the source published it.</li>
      <li><strong className="font-bold text-ink">Collection date</strong>: when you obtained it.</li>
    </ul>
  );
}

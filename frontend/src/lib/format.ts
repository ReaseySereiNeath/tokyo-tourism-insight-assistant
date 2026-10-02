import type { Change } from "./types";

// Missing values render as an em dash, never as 0.
export const MISSING = "—";

export function fmtNumber(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return MISSING;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined) return MISSING;
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function fmtMoney(n: number | null | undefined, currency: string | null | undefined): string {
  if (n === null || n === undefined) return "Not published";
  return `${currency ?? ""} ${fmtNumber(n)}`.trim();
}

export function fmtDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return MISSING;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

const CHANGE_REASONS: Record<string, string> = {
  missing_current: "no value this period",
  missing_previous: "no comparable earlier period",
  zero_base: "earlier value was 0",
};

export function fmtChange(c: Change | null | undefined): string {
  if (!c) return MISSING;
  if (c.status !== "ok" || c.value === null) return MISSING;
  return `${c.value > 0 ? "+" : ""}${c.value.toFixed(1)}%`;
}

export function changeReason(c: Change | null | undefined): string | undefined {
  return c && c.status !== "ok" ? CHANGE_REASONS[c.status] : undefined;
}

export function fmtMonth(month: string | null | undefined): string {
  if (!month) return MISSING;
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

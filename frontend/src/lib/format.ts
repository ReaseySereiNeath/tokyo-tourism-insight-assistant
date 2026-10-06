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

/** "1 tour", "3 tours". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmtNumber(n)} ${n === 1 ? one : many}`;
}

export function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function fmtMonthLong(month: string | null | undefined): string {
  if (!month) return MISSING;
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });
}

/** A YYYY-MM month, a YYYY-Qn quarter or a YYYY-MM-DD day, written out. */
export function fmtPeriod(value: string | null | undefined): string {
  if (!value) return MISSING;
  if (/^\d{4}-Q[1-4]$/.test(value)) return fmtQuarter(value, true);
  return value.length === 7 ? fmtMonth(value) : new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
}

/** ¥942.7 billion, ¥23.2 million, ¥2,227. */
export function fmtYen(n: number | null | undefined): string {
  if (n === null || n === undefined) return MISSING;
  if (Math.abs(n) >= 1e9) return `¥${(n / 1e9).toLocaleString("en-US", { maximumFractionDigits: 1 })} billion`;
  if (Math.abs(n) >= 1e6) return `¥${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })} million`;
  return `¥${fmtNumber(n)}`;
}

const QUARTER_MONTHS = ["January–March", "April–June", "July–September", "October–December"];
const QUARTER_SHORT = ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"];

/** "2026-Q2" -> "April–June 2026" (or "Apr–Jun 2026" when short); "2026" -> "2026". */
export function fmtQuarter(period: string | null | undefined, short = false): string {
  if (!period) return MISSING;
  const m = period.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return period;
  return `${(short ? QUARTER_SHORT : QUARTER_MONTHS)[Number(m[2]) - 1]} ${m[1]}`;
}

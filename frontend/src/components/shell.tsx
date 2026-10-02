"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useScope } from "./providers";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/trends", label: "Visitor trends" },
  { href: "/competitors", label: "Competitors" },
  { href: "/needs", label: "Customer needs" },
  { href: "/insights", label: "Insights" },
  { href: "/sources", label: "Sources & imports" },
  { href: "/profile", label: "Business profile" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { scope, setScope } = useScope();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-line bg-raised md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="px-5 py-5">
          <div className="text-sm font-semibold text-ink">Tokyo Tourism</div>
          <div className="text-xs text-ink-3">Insight Assistant</div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible" aria-label="Main">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${active ? "bg-sunken font-medium text-ink" : "text-ink-2 hover:bg-sunken"}`}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-5 py-4">
          <div className="mb-1.5 text-xs font-medium text-ink-3">Data shown</div>
          <div className="inline-flex rounded-lg border border-line p-0.5 text-sm" role="radiogroup" aria-label="Data scope">
            {(["real", "demo"] as const).map((s) => (
              <button key={s} role="radio" aria-checked={scope === s} onClick={() => setScope(s)}
                className={`rounded-md px-3 py-1 ${scope === s ? (s === "demo" ? "bg-amber-400 font-medium text-amber-950" : "bg-accent font-medium text-white") : "text-ink-2"}`}>
                {s === "real" ? "My data" : "Demo"}
              </button>
            ))}
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {scope === "demo" && (
          <div className="border-b border-amber-300 bg-amber-100 px-6 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100" role="status">
            <strong>DEMO MODE — synthetic data.</strong> Every number, review and business here is invented for
            demonstration. Nothing on these pages describes the real market.
          </div>
        )}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

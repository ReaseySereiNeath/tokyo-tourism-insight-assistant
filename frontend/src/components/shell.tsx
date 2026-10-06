"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { STATIONS } from "@/lib/route";
import type { Overview } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { useScope } from "./providers";
import { StationMark } from "./ui";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { scope, setScope } = useScope();
  // Re-read on every page change so a station fills in as soon as its data exists.
  const progress = useApi(() => api.get<Overview>("/api/overview", scope), [scope, pathname]);
  const o = progress.data;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-line bg-raised md:sticky md:top-0 md:h-screen md:w-72 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-3 px-4 pt-4 md:block md:px-6 md:pt-7">
          <Link href="/" className={`block rounded-md ${pathname === "/" ? "" : "hover:opacity-80"}`}>
            <span className="font-display block text-lg font-black leading-tight text-ink">Tokyo Tourism Insights</span>
            <span className="block text-xs text-ink-3">{pathname === "/" ? "You are on the home page" : "Back to home"}</span>
          </Link>
        </div>

        <nav aria-label="Steps" className="px-4 pb-4 pt-5 md:px-6 md:pt-8">
          {/* Phones: a horizontal line with names under each stop. Larger screens: a vertical line with names beside it. */}
          <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:overflow-visible md:px-0">
          <ol className="flex min-w-max md:min-w-0 md:flex-col">
            {STATIONS.map((s, i) => {
              const current = pathname.startsWith(s.href);
              const done = !!o && s.done(o);
              const last = i === STATIONS.length - 1;
              return (
                <li key={s.href} className="relative w-22 shrink-0 md:w-auto md:pb-6">
                  {!last && (
                    <span aria-hidden className="absolute left-1/2 top-[14.5px] h-0.75 w-full bg-route md:left-[14.5px] md:top-4 md:h-full md:w-0.75" />
                  )}
                  <Link href={s.href} aria-current={current ? "page" : undefined}
                    className="group relative flex flex-col items-center gap-1.5 text-center md:flex-row md:items-start md:gap-3 md:text-left">
                    <StationMark n={s.n} done={done} current={current} />
                    <span className="min-w-0">
                      <span className={`block text-xs leading-tight md:pt-1.5 md:text-sm ${current ? "font-bold text-ink" : "text-ink-2 group-hover:text-ink"}`}>
                        {s.label}
                      </span>
                      <span className="hidden text-xs text-ink-3 md:mt-0.5 md:block">
                        {done ? s.hint : `${s.hint}. Nothing here yet.`}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
          </div>
        </nav>

        <div className="hidden space-y-6 border-t border-line px-6 py-6 md:block">
          <SideLink href="/profile" pathname={pathname} label="About you" hint="Budget, skills and goals the ideas must fit" />
          <SideLink href="/needs" pathname={pathname} label="Guest feedback" hint="For later, once you have customers" />
          <ScopeSwitch scope={scope} setScope={setScope} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {scope === "demo" && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-4 border-caution bg-caution-soft px-6 py-3 text-sm text-caution-ink" role="status">
            <span><strong>You are looking at sample data.</strong> Every number, review and business here is made up.</span>
            <button onClick={() => setScope("real")} className="rounded-md border border-caution-ink/30 px-3 py-1 font-bold hover:bg-caution/20">
              Switch to your data
            </button>
          </div>
        )}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8 lg:px-12 lg:py-12">{children}</main>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-4 py-4 md:hidden">
          <span className="flex gap-4">
            <Link href="/profile" className="text-sm text-ink-2 underline">About you</Link>
            <Link href="/needs" className="text-sm text-ink-2 underline">Guest feedback</Link>
          </span>
          <ScopeSwitch scope={scope} setScope={setScope} />
        </div>
      </div>
    </div>
  );
}

function SideLink({ href, pathname, label, hint }: { href: string; pathname: string; label: string; hint: string }) {
  const current = pathname.startsWith(href);
  return (
    <Link href={href} aria-current={current ? "page" : undefined}
      className={`block text-sm ${current ? "font-bold text-ink" : "text-ink-2 hover:text-ink"}`}>
      {label}
      <span className="block text-xs font-normal text-ink-3">{hint}</span>
    </Link>
  );
}

function ScopeSwitch({ scope, setScope }: { scope: "real" | "demo"; setScope: (s: "real" | "demo") => void }) {
  return (
    <div>
      <div id="scope-label" className="mb-1.5 text-xs text-ink-3">Showing</div>
      <div className="inline-flex rounded-lg border border-line bg-paper p-0.5 text-sm" role="radiogroup" aria-labelledby="scope-label">
        {(["real", "demo"] as const).map((s) => (
          <button key={s} role="radio" aria-checked={scope === s} onClick={() => setScope(s)}
            className={`rounded-md px-3 py-1 ${scope === s ? (s === "demo" ? "bg-caution font-bold text-caution-ink" : "bg-route font-bold text-white dark:text-paper") : "text-ink-2 hover:text-ink"}`}>
            {s === "real" ? "Your data" : "Sample data"}
          </button>
        ))}
      </div>
    </div>
  );
}

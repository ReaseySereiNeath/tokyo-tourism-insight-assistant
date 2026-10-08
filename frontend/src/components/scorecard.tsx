"use client";

import { fmtChange, fmtQuarter, fmtYen } from "@/lib/format";
import type { Scorecard } from "@/lib/types";
import { EvidenceLink } from "./ui";

/** A 1-5 score as five pips, with the number for screen readers and anyone who prefers digits. */
export function ScorePips({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={`Demand score ${score} out of 5`}>
      <span className="inline-flex gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`h-2.5 w-2.5 rounded-full ${score >= i - 0.25 ? "bg-route" : score >= i - 0.75 ? "bg-route/45" : "bg-line"}`} />
        ))}
      </span>
      <span className="num font-bold text-ink">{score.toFixed(1)}</span>
    </span>
  );
}

const PART_WORDS = { size: "Size", growth: "Growth", momentum: "Steadiness" } as const;

/** The computed demand evidence for one spending item: every part of the score is shown. */
export function ScorecardRow({ c, showLabel = true }: { c: Scorecard; showLabel?: boolean }) {
  return (
    <div className="grid gap-x-6 gap-y-2 py-3 sm:grid-cols-[minmax(12rem,1fr)_auto]">
      <div>
        {showLabel && <div className="font-bold text-ink">{c.label}</div>}
        <div className="text-sm text-ink-2">
          {fmtYen(c.spend_per_person)} per visitor,{" "}
          <span className={c.change.status === "ok" && (c.change.value ?? 0) < 0 ? "text-down" : "text-route"}>{fmtChange(c.change)}</span>{" "}
          vs {fmtQuarter(c.comparison_period, true)}.{" "}
          {c.quarters_compared > 1 ? `Grew in ${c.quarters_growing} of the last ${c.quarters_compared} quarters.`
            : c.quarters_compared === 1 ? "Only one quarter can be compared so far." : ""}
          {c.purchase_rate !== null && ` Bought by ${c.purchase_rate.toFixed(1)}% of visitors (${c.buyers} in the survey).`}
          {c.estimated_market !== null && ` Market about ${fmtYen(c.estimated_market)} a quarter (estimate).`}
          {c.evidence_ids[0] && <> <EvidenceLink id={c.evidence_ids[0]} /></>}
        </div>
      </div>
      <div className="sm:text-right">
        <ScorePips score={c.score} />
        <div className="mt-1 text-xs text-ink-3">
          {(Object.keys(PART_WORDS) as (keyof typeof PART_WORDS)[]).map((k) => `${PART_WORDS[k]} ${Math.round(c.score_parts[k] * 100)}%`).join(", ")}
        </div>
      </div>
    </div>
  );
}

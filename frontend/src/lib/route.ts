// The app is one route, walked in order: add data, read each kind of evidence,
// then turn it into ideas to test. The navigation and the home page's
// "next stop" both read this list.
import type { Overview } from "./types";

export interface Station {
  n: number;
  href: string;
  label: string;
  hint: string;
  /** What the owner should do at this stop when it has nothing yet. */
  todo: string;
  done: (o: Overview) => boolean;
}

const records = (o: Overview, dataset: string) => o.coverage.find((c) => c.dataset === dataset)?.records ?? 0;

export const STATIONS: Station[] = [
  {
    n: 1, href: "/sources", label: "Add your data", hint: "Files, templates and news feeds",
    todo: "Import your first file. Start with the JNTO visitor workbook or one of the templates.",
    done: (o) => o.coverage.some((c) => c.records > 0),
  },
  {
    n: 2, href: "/trends", label: "Visitors", hint: "Who is travelling to Japan",
    todo: "Import visitor statistics to see which countries are growing.",
    done: (o) => records(o, "visitor_stats") > 0,
  },
  {
    n: 3, href: "/competitors", label: "Competitors", hint: "What other tours offer and charge",
    todo: "Add a few competitor tours so you can compare prices and lengths.",
    done: (o) => records(o, "competitor_offers") > 0,
  },
  {
    n: 4, href: "/needs", label: "Guest feedback", hint: "What your guests talk about",
    todo: "Add guest reviews or survey answers to see what people ask for.",
    done: (o) => records(o, "feedback") > 0,
  },
  {
    n: 5, href: "/insights", label: "Ideas to test", hint: "Small experiments, with the evidence",
    todo: "Turn your data into a short list of experiments to try.",
    done: (o) => o.latest_report !== null,
  },
];

export function stationFor(pathname: string): Station | undefined {
  return STATIONS.find((s) => pathname.startsWith(s.href));
}

/** The first stop that still needs something; the data stop counts once any dataset exists. */
export function nextStation(o: Overview): Station | undefined {
  return STATIONS.find((s) => !s.done(o));
}

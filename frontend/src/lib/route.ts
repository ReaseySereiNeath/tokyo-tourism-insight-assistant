// The app is one route, walked in order: get the data, read who visits and what
// they spend on, turn it into business ideas, then check the competition.
// The navigation and the home page's "next stop" both read this list.
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
    n: 1, href: "/sources", label: "Add your data", hint: "Official data updates itself",
    todo: "Check for the latest official statistics. They download by themselves once you have checked.",
    done: (o) => o.coverage.some((c) => c.records > 0),
  },
  {
    n: 2, href: "/trends", label: "Visitors", hint: "Who is travelling to Japan",
    todo: "Get the JNTO visitor numbers to see which countries are growing.",
    done: (o) => records(o, "visitor_stats") > 0,
  },
  {
    n: 3, href: "/spending", label: "Spending", hint: "What visitors spend money on",
    todo: "Get the Japan Tourism Agency spending survey to see where visitors' money goes.",
    done: (o) => records(o, "spending_stats") > 0,
  },
  {
    n: 4, href: "/insights", label: "Business ideas", hint: "Opportunities, with the evidence",
    todo: "Turn the data into a ranked list of business ideas that fit you.",
    done: (o) => o.latest_report !== null,
  },
  {
    n: 5, href: "/competitors", label: "Competitors", hint: "Check the competition for an idea",
    todo: "Record a few existing businesses similar to your favourite idea, with their prices.",
    done: (o) => records(o, "competitor_offers") > 0,
  },
];

export function stationFor(pathname: string): Station | undefined {
  return STATIONS.find((s) => pathname.startsWith(s.href));
}

/** The first stop that still needs something; the data stop counts once any dataset exists. */
export function nextStation(o: Overview): Station | undefined {
  return STATIONS.find((s) => !s.done(o));
}

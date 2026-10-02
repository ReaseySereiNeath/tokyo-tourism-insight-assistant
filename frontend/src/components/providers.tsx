"use client";

import { createContext, useCallback, useContext, useState, useSyncExternalStore } from "react";
import type { Scope } from "@/lib/api";
import type { Fact } from "@/lib/types";
import { EvidenceDrawer } from "./evidence-drawer";

// ---- Data scope: "real" (your imports) or "demo" (synthetic data) ----
const ScopeContext = createContext<{ scope: Scope; setScope: (s: Scope) => void }>({
  scope: "real",
  setScope: () => {},
});

// ---- Evidence drawer: open any evidence ID (or a report fact) from anywhere ----
interface EvidenceTarget {
  id: string;
  fact?: Fact; // when the ID is a report fact (F1, F2...), the fact travels with it
}
const EvidenceContext = createContext<{ open: (t: EvidenceTarget) => void }>({ open: () => {} });

let memoryScope: Scope = "real";

function readScope(): Scope {
  try {
    const saved = localStorage.getItem("scope");
    if (saved === "demo" || saved === "real") return saved;
  } catch {
    /* fall back to the in-memory value */
  }
  return memoryScope;
}

function subscribeScope(callback: () => void) {
  window.addEventListener("scope-change", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("scope-change", callback);
    window.removeEventListener("storage", callback);
  };
}

export function Providers({ children }: { children: React.ReactNode }) {
  // The server always renders "real"; the browser then reads the saved choice.
  const scope = useSyncExternalStore(subscribeScope, readScope, () => "real" as Scope);
  const [target, setTarget] = useState<EvidenceTarget | null>(null);

  const setScope = useCallback((s: Scope) => {
    setTarget(null);
    try {
      localStorage.setItem("scope", s);
    } catch {
      /* storage unavailable: the choice will not persist */
    }
    memoryScope = s;
    window.dispatchEvent(new Event("scope-change"));
  }, []);

  return (
    <ScopeContext.Provider value={{ scope, setScope }}>
      <EvidenceContext.Provider value={{ open: setTarget }}>
        {children}
        <EvidenceDrawer target={target} scope={scope} onClose={() => setTarget(null)} onOpen={setTarget} />
      </EvidenceContext.Provider>
    </ScopeContext.Provider>
  );
}

export const useScope = () => useContext(ScopeContext);
export const useEvidence = () => useContext(EvidenceContext);

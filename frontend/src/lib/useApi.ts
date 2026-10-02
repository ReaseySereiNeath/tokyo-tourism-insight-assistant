"use client";

import { useCallback, useEffect, useState } from "react";

// Loads data with explicit loading / error states and a reload() function.
// `key` lists everything the request depends on; the FIRST element should be
// the data scope (or another identity). While a new request is in flight we
// keep showing the previous result only if that first element is unchanged,
// so switching between real and demo data never shows the other scope's data.
export function useApi<T>(fetcher: () => Promise<T>, key: unknown[]) {
  const [version, setVersion] = useState(0);
  const requestKey = JSON.stringify([...key, version]);
  const identity = JSON.stringify(key[0] ?? null);
  const [state, setState] = useState<{ requestKey: string | null; identity: string | null; data: T | null; error: string | null }>(
    { requestKey: null, identity: null, data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    fetcher()
      .then((data) => !cancelled && setState({ requestKey, identity, data, error: null }))
      .catch((e: Error) => !cancelled && setState({ requestKey, identity, data: null, error: e.message }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requestKey captures the dependencies
  }, [requestKey]);

  const fresh = state.requestKey === requestKey;
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return {
    data: fresh || state.identity === identity ? state.data : null,
    error: fresh ? state.error : null,
    loading: !fresh,
    reload,
  };
}

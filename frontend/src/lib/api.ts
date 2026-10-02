// Thin client for the FastAPI backend. Every call names the data scope
// ("real" or "demo") so the two databases are never mixed.
export type Scope = "real" | "demo";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

type Params = Record<string, string | number | boolean | string[] | null | undefined>;

export function buildUrl(path: string, scope: Scope | null, params: Params = {}): string {
  const url = new URL(path, API_BASE);
  if (scope) url.searchParams.set("scope", scope);
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
    else url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function handle<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;
  let message = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    if (typeof body.detail === "string") message = body.detail;
    else if (Array.isArray(body.detail)) message = body.detail.map((d: { msg: string }) => d.msg).join("; ");
  } catch {
    /* non-JSON error body */
  }
  throw new ApiError(message, res.status);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(`Cannot reach the backend at ${API_BASE}. Is it running? (see README)`, 0);
  }
  return handle<T>(res);
}

export const api = {
  get: <T>(path: string, scope: Scope | null, params?: Params) => request<T>(buildUrl(path, scope, params)),
  post: <T>(path: string, scope: Scope | null, params?: Params, body?: unknown) =>
    request<T>(buildUrl(path, scope, params), {
      method: "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(path: string, scope: Scope, body: unknown) =>
    request<T>(buildUrl(path, scope), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  upload: <T>(scope: Scope, form: FormData) =>
    request<T>(buildUrl("/api/imports", scope), { method: "POST", body: form }),
};

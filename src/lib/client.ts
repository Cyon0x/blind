"use client";

/**
 * Browser-side calls to Blind's own API. The CSRF token is read from the
 * readable cookie and echoed in a header; every mutation goes through here so
 * no screen has to remember to do it.
 */
function csrf(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)blind_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; code: string; status: number };

export async function api<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const token = csrf();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (token && init.method && init.method !== "GET") headers.set("x-blind-csrf", token);
  try {
    const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        code: String(payload.code ?? "error"),
        error: String(payload.error ?? payload.detail ?? `Request failed (${response.status})`),
      };
    }
    return { ok: true, data: payload as T };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      code: "network",
      error: error instanceof Error ? error.message : "Blind could not reach its own API.",
    };
  }
}

export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const get = <T,>(path: string) => api<T>(path, { method: "GET" });
export const del = <T,>(path: string) => api<T>(path, { method: "DELETE" });

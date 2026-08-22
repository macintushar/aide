/**
 * Where the browser talks to Aide.
 *
 * Vite dev serves the UI on a different port than the API, so requests go
 * through `/api` and the proxy strips that prefix. Production will serve the
 * UI from the same origin as the server, so the prefix is empty.
 */
export function apiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_AIDE_API_BASE
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return fromEnv.replace(/\/$/, "")
  }
  return import.meta.env.DEV ? "/api" : ""
}

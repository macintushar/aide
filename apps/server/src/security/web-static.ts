import { readFile } from "node:fs/promises"
import { extname, join, normalize, resolve, sep } from "node:path"

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
}

/** Route prefixes owned by the API; never fall back to the SPA shell. */
const API_PREFIXES = [
  "/commands",
  "/config",
  "/projects",
  "/sessions",
  "/instances",
  "/auth",
]

/**
 * Serves a built single-page web app from `root`. Unknown non-API GETs fall
 * back to index.html so client-side routes (e.g. /?authToken=…) work on a
 * hard reload. Registered after every API route.
 */
export function serveWebApp(
  root: string
): (path: string) => Promise<Response | undefined> {
  const dist = resolve(root)

  async function fileResponse(path: string): Promise<Response | undefined> {
    const target = normalize(join(dist, path))
    // Stay inside dist even if the URL tries to escape it.
    if (!target.startsWith(dist + sep) && target !== dist) return undefined
    try {
      const body = await readFile(target)
      return new Response(new Uint8Array(body), {
        headers: {
          "content-type":
            CONTENT_TYPES[extname(target).toLowerCase()] ??
            "application/octet-stream",
        },
      })
    } catch {
      return undefined
    }
  }

  return async (path: string) => {
    const pathname = decodeURI(path.split("?")[0] ?? "/")
    if (
      pathname !== "/" &&
      API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))
    ) {
      return undefined
    }
    const asset = await fileResponse(pathname)
    if (asset) return asset
    if (pathname === "/" || !extname(pathname)) {
      return fileResponse("/index.html")
    }
    return undefined
  }
}

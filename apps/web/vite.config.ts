import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import type { ProxyOptions } from "vite"
import { defineConfig } from "vitest/config"

const aideServer = process.env.AIDE_SERVER_URL ?? "http://127.0.0.1:3000"

/**
 * Dev-only same-origin prefix. The browser calls `/api/...`; Vite forwards to
 * the Aide server after stripping `/api`. Origin is rewritten to the server
 * because the command guard allowlists that origin, not the Vite port.
 */
function aideApiProxy(): ProxyOptions {
  const origin = new URL(aideServer).origin
  return {
    target: aideServer,
    changeOrigin: true,
    timeout: 0,
    proxyTimeout: 0,
    rewrite: (urlPath) => urlPath.replace(/^\/api/, "") || "/",
    configure(proxy) {
      proxy.on("proxyReq", (proxyReq) => {
        proxyReq.setHeader("origin", origin)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": aideApiProxy(),
    },
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": aideApiProxy(),
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text", "lcov", "json"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**"],
    },
  },
})

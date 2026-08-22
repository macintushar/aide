import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        // Design gallery. Delete this entry with `src/gallery/` to remove it.
        gallery: path.resolve(import.meta.dirname, "gallery.html"),
      },
    },
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    // Proxy API calls to the aide server so the dev UI shares its origin
    // semantics. The browser's cross-origin Origin header is dropped — the
    // server treats a missing Origin as same-origin.
    proxy: Object.fromEntries(
      [
        "/commands",
        "/instances",
        "/config",
        "/sessions",
        "/projects",
        "/auth",
      ].map((route) => [
        route,
        {
          target: "http://localhost:3000",
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.removeHeader("origin")
              proxyReq.removeHeader("referer")
            })
          },
        },
      ])
    ),
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: true,
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

// @ts-check
import { defineConfig } from "astro/config"
import starlight from "@astrojs/starlight"

// https://astro.build/config
export default defineConfig({
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
  },
  // esbuild keeps standard `backdrop-filter` — lightningcss strips it for
  // legacy targets, leaving only the -webkit- alias.
  vite: {
    build: { cssMinify: "esbuild" },
    server: { allowedHosts: true },
  },
  integrations: [
    starlight({
      title: "aide",
      description:
        "aide runs one coding conversation across interchangeable agents. Local-first, SQLite-backed, no account.",
      customCss: ["./src/styles/starlight.css"],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/macintushar/aide",
        },
      ],
      sidebar: [{ label: "Intro", slug: "docs" }],
    }),
  ],
})

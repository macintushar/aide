# aide — Design System

The standing reference for aide's visual design. Everything here is decided. If a
question is not answered by this document, it has not been decided yet — raise it
rather than inventing an answer.

**Companion:** `brand/aide-brand-kit.html` renders these tokens visually — swatches,
type specimens, logo sizes, and an app mock. This file is the source of truth; the
HTML is the picture of it.

**Implementation:** `packages/ui/src/styles/globals.css`.

---

## 1. Brand fundamentals

|                 |                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**        | `aide` — always lowercase, in every context, including the start of a sentence, in product UI, docs, prose, and code comments. Never "Aide", never "AIDE". |
| **Descriptor**  | An open-source home for coding agents.                                                                                                                     |
| **Tagline**     | One conversation. Any agent.                                                                                                                               |
| **Positioning** | The session belongs to aide, not to a harness. Users start a task in one agent and finish it in another; aide owns the transcript.                         |

`README.md` and `PLAN.md` currently capitalize "Aide" throughout. Lowercase them
when either file is next edited.

---

## 2. Color

Dark is the default. Light is a real theme, not an afterthought — both ship.

All values are OKLCH. Lightness and chroma are chosen deliberately; do not
substitute visually-similar hex.

### 2.1 Neutral ramp

Nine steps from deep ink to white. Every step carries a faint blue (C ≈0.003–0.015,
hue 255) so the dark theme reads as ink rather than flat grey and sits naturally
beside the sky accent. This ramp replaces every gray in the system: there is no
second neutral family.

| Token  | Dark                     | Light                    | Role                                 |
| ------ | ------------------------ | ------------------------ | ------------------------------------ |
| `--n0` | `oklch(0.145 0.006 255)` | `oklch(0.966 0.004 255)` | Frame: page, sidebar, input wells    |
| `--n1` | `oklch(0.172 0.007 255)` | `oklch(1 0 0)`           | Work surface (the inset main panel)  |
| `--n2` | `oklch(0.203 0.008 255)` | `oklch(0.975 0.003 255)` | Card, composer, popover, hover       |
| `--n3` | `oklch(0.243 0.009 255)` | `oklch(0.945 0.005 255)` | Raised control, user bubble, pressed |
| `--n4` | `oklch(0.322 0.011 255)` | `oklch(0.872 0.008 255)` | Ghost text, disabled, separators     |
| `--n5` | `oklch(0.528 0.013 255)` | `oklch(0.61 0.013 255)`  | Faint text, placeholders, timestamps |
| `--n6` | `oklch(0.708 0.011 255)` | `oklch(0.47 0.015 255)`  | Muted / secondary text               |
| `--n7` | `oklch(0.868 0.006 255)` | `oklch(0.31 0.013 255)`  | Body text                            |
| `--n8` | `oklch(0.968 0.003 255)` | `oklch(0.18 0.012 255)`  | Headings, emphasis                   |

Never use pure `#fff` for text on dark; `--n8` is the ceiling. The frame (`--n0`) is
darker than the work surface (`--n1`) in dark mode and slightly greyer than it in
light mode, so the inset panel always reads as the place where work happens.

### 2.2 Accent — saturated sky, hue 240

The brand hue, pushed until it reads as _live_. The earlier soft sky (`#5FA8D3`,
C 0.097) made primary buttons look disabled; at C 0.155 the accent carries the
"an agent is working" meaning the board depends on.

| Token             | Dark                           | Light                        | Role                                 |
| ----------------- | ------------------------------ | ---------------------------- | ------------------------------------ |
| `--accent-subtle` | `oklch(0.72 0.155 240 / 0.14)` | `oklch(0.6 0.18 246 / 0.1)`  | Selected fill, toggled chip          |
| `--accent-dim`    | `oklch(0.72 0.155 240 / 0.45)` | `oklch(0.6 0.18 246 / 0.45)` | Focus border, running card border    |
| `--accent-base`   | `oklch(0.72 0.155 240)`        | `oklch(0.6 0.18 246)`        | Primary fill, running dot, scan line |
| `--accent-hi`     | `oklch(0.78 0.13 238)`         | `oklch(0.55 0.18 248)`       | Primary hover                        |
| `--accent-ink`    | `oklch(0.79 0.125 238)`        | `oklch(0.5 0.17 250)`        | Accent-coloured **text**             |
| `--accent-fg`     | `oklch(0.17 0.035 250)`        | `oklch(1 0 0)`               | Text **on** the accent               |
| `--accent-glow`   | `oklch(0.72 0.155 240 / 0.28)` | `oklch(0.6 0.18 246 / 0.2)`  | Focus rings, primary hover halo      |

**`--accent-fg` flips with the theme.** The dark accent is bright, so text on it is
deep navy; the light accent is deeper, so text on it is white. Never hardcode
either.

**Accent text uses `--accent-ink`, never `--accent-base`.**

### 2.3 Borders

Alpha, never a step in the neutral ramp, so a border survives any surface.

| Token           | Dark                   | Light                        | Role                                         |
| --------------- | ---------------------- | ---------------------------- | -------------------------------------------- |
| `--line`        | `oklch(1 0 0 / 0.075)` | `oklch(0.2 0.02 255 / 0.09)` | Hairlines, card edges, the work-surface edge |
| `--line-strong` | `oklch(1 0 0 / 0.14)`  | `oklch(0.2 0.02 255 / 0.17)` | Inputs, outline buttons, hovered cards       |

### 2.4 Status

Status is aide's main colour language. The same four hues mean the same thing on
the board, in the sidebar, in the header pill and in the transcript.

| Token           | Dark                    | Light                  | Meaning                                       |
| --------------- | ----------------------- | ---------------------- | --------------------------------------------- |
| accent          | `--accent-base`         | `--accent-base`        | An agent is working right now                 |
| `--warn`        | `oklch(0.82 0.145 78)`  | `oklch(0.6 0.145 62)`  | Waiting on you: permission or input requested |
| `--ok`          | `oklch(0.765 0.15 158)` | `oklch(0.56 0.14 158)` | Finished; tool succeeded; instance healthy    |
| `--danger-base` | `oklch(0.69 0.19 22)`   | `oklch(0.56 0.2 25)`   | Failed; adapter crashed; destructive confirm  |

### 2.5 Diff

Foreground stays readable as code; background tint stays quiet enough to read a
full file through. Backgrounds are alpha so they compose over any surface.

| Token           | Dark                            | Light                           |
| --------------- | ------------------------------- | ------------------------------- |
| `--diff-add-fg` | `oklch(0.799 0.126 158)`        | `oklch(0.515 0.113 156)`        |
| `--diff-add-bg` | `oklch(0.702 0.143 157 / 0.13)` | `oklch(0.561 0.125 156 / 0.11)` |
| `--diff-del-fg` | `oklch(0.737 0.161 20)`         | `oklch(0.501 0.170 23)`         |
| `--diff-del-bg` | `oklch(0.626 0.193 23 / 0.13)`  | `oklch(0.545 0.188 24 / 0.09)`  |

Diff foregrounds are lighter (dark) or darker (light) than `--ok` and
`--danger-base`, and diff rows always carry a tinted background, so a diff never
reads as a status.

### 2.6 Rules

- No categorical color palette exists. aide has no charts and no per-harness colors.
  If you need to distinguish N things, use marks, labels, or position — not hue.
- Status (§2.4, §5) is the only thing that carries color, everywhere in the app.
- Never introduce a color outside this file. Extend this file instead.

---

## 3. Typography

### 3.1 Faces

| Face           | Where                                                                              | Never                      |
| -------------- | ---------------------------------------------------------------------------------- | -------------------------- |
| **Geist**      | Everything — app body, UI, headings, labels, buttons, and the site's display type. | —                          |
| **Geist Mono** | The allowlist in §3.4 only.                                                        | Anywhere not on that list. |

aide uses **one typeface**, app and site alike. There is no separate heading or
display face — hierarchy comes from weight and tracking (§3.2). Instrument Sans,
Instrument Serif and JetBrains Mono are removed.

Packages: `@fontsource-variable/geist`, `@fontsource-variable/geist-mono`. Mono is
Geist's own sibling so the two registers share proportions and never look pasted
together.

### 3.2 Scale

| Role                  | Size    | Weight | Tracking    |
| --------------------- | ------- | ------ | ----------- |
| Display _(site only)_ | 52–72px | 600    | −0.030em    |
| h1                    | 40px    | 600    | −0.030em    |
| h2                    | 30px    | 600    | −0.025em    |
| h3                    | 20px    | 600    | −0.020em    |
| Body                  | 15px    | 400    | 0           |
| UI                    | 13px    | 400    | 0           |
| Small                 | 12px    | 400    | 0           |
| Label _(uppercase)_   | 11px    | 600    | **+0.10em** |
| Mono                  | 12px    | 400    | 0           |

**Tracking tightens as size grows** — −0.020em at 20px through −0.030em at 40px and
above.
Uppercase labels go the other way at +0.10em. Both rules are mandatory; default
untracked headings look slack at large sizes.

Line height: 1.62 body, 1.14 headings, 1.7 code blocks.

### 3.3 Case

Sentence case for all headings, buttons, labels, and menu items. Uppercase only for
the 11px label role. Never Title Case.

### 3.4 Mono policy

Mono is a scalpel, not a second register. It earns its place only where character
alignment or exact transcription matters. Restricting it also makes it _mean_
something: a monospaced line is machine-issued and probably copyable.

**Mono — the complete list:**

- Tool call lines (name, target, args)
- Code blocks
- Diffs and file contents
- Inline `code` spans inside assistant output
- Raw event payloads in the debug/inspector view
- Design-token names and values in documentation
- Branch names and file paths shown as identifiers (worktree chip, tool subject)
- Numbers that tick or are compared in a column: elapsed clocks, relative times on
  cards, costs, token counts, counters (always `tabular-nums`)

**Sans — everything else**, including: section labels, badges and status tags,
model and agent names in the composer, sidebar items, table headers,
nav, buttons, settings fields, file paths written in prose, error messages, empty
states, window title bars.

---

## 4. Harness identity

Harnesses are identified by **their own logo and name. Nothing else.**

### 4.1 Rules

- Use the **official mark from each vendor's press kit, as-is** — full color,
  unmodified. Do not recolor, tint, monochrome, outline, or restyle a vendor mark.
- The mark appears at **16–20px**, left-aligned with the instance's display name, in:
  the harness picker, the composer chip, the instances sidebar, and as the message
  avatar in the transcript.
- Disabled or unconfigured instances drop to **45% opacity**. Never change the color.
- Harness identity carries **no aide-assigned color**. There is no per-harness hue,
  rail, tint, border, or theme.
- Never place a vendor mark inside aide's own lockup.

### 4.2 Secondary line

The line under the instance name names the **driver**, not the vendor — PLAN.md
separates the two, and a user may run several instances of one driver.

### 4.3 Consequence for the adapter contract

The avatar column is the only thing distinguishing speakers in a transcript, so it
can never be empty. **Every driver must supply its mark before it can be enabled.**

Add a required `icon` field to the adapter capability descriptor in
`packages/contracts`. This keeps the UI from branching on driver ID — PLAN.md
principle 7 forbids that — and mirrors how principle 14 already handles composer
controls. Adding a harness then stays a config change, not a UI change.

### 4.4 Asset collection

Marks are pending. Collect official SVGs from each vendor's press kit and commit
them under `packages/ui/src/assets/harnesses/`. Using marks as-is is the low-risk
path: the trademark exposure was in recoloring, which §4.1 forbids.

---

## 5. Turn state

State is the only color in a transcript. The vocabulary below is applied
identically in the sidebar dot, the message badge, and the composer.

| State          | Token           | Badge       | Treatment                                                                                                  |
| -------------- | --------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| queued         | `--n4`          | `queued`    | Static. No motion — a queued turn is not doing anything and must not imply that it is.                     |
| streaming      | `--accent-base` | `streaming` | The only state that animates: 1.6s pulse on the dot, caret blink at the text tail.                         |
| awaiting input | `--warn`        | `awaiting`  | Permission or user-input request. Blocks the turn, so it gets a persistent inline surface — never a toast. |
| completed      | `--ok`          | `done`      | Badge fades after 4s. The resting case shouldn't accumulate chrome.                                        |
| interrupted    | `--n5`          | `stopped`   | Deliberately neutral.                                                                                      |
| failed         | `--danger-base` | `failed`    | Persistent badge plus a danger-tinted tool-call border.                                                    |

**Shape carries state as well as hue.** The awaiting dot is a hollow `--warn` ring
and the failed dot is a `--danger-base` diamond; every other state is a filled
circle. No state depends on color alone.

### 5.1 Session activity

A session takes the state of its latest turn, except that a pending request always
wins. This is what the board, the sidebar and ⌘K show (`GET /sessions`).

| Activity      | Dot                 | Label     | Board lane |
| ------------- | ------------------- | --------- | ---------- |
| `needs_input` | hollow `--warn`     | Needs you | Needs you  |
| `failed`      | `--danger-base` ◆   | Failed    | Needs you  |
| `running`     | accent, radar pulse | Running   | Running    |
| `queued`      | `--n4`              | Queued    | Running    |
| `completed`   | `--ok`              | Done      | Recent     |
| `interrupted` | `--n5`              | Stopped   | Recent     |
| `idle`        | `--n4`              | New       | Recent     |

**interrupted ≠ failed.** aide has explicit turn interruption in Day-0 scope, so
users hit "interrupted" constantly. It is a deliberate user action, not an error.
Coloring it red trains people to ignore red.

---

## 6. Form

### 6.1 Radius

Base `--radius: 0.5rem` (8px). Soft enough to feel like a modern tool, never bubbly.

| Token          | Value | Use                                            |
| -------------- | ----- | ---------------------------------------------- |
| `--radius-sm`  | 4px   | Inline code, tiny chips                        |
| `--radius-md`  | 6px   | Kbd, menu rows                                 |
| `--radius-lg`  | 8px   | Buttons, inputs, tool calls, sidebar rows      |
| `--radius-xl`  | 12px  | Cards, popovers, the work surface              |
| `--radius-2xl` | 16px  | Composer, modals, command palette, user bubble |

Full round is for dots, pills, the send button and status chips only.

### 6.2 Elevation

Surfaces first, then a whisper of light. Each layer is a step up the ramp (§2.1);
cards and controls add `--shadow-card`, a 1px top highlight plus a soft drop, which
reads as a physical edge on dark without looking like a drop shadow. Floating
layers (popovers, menus, modals, ⌘K) take `--shadow-pop`.

| Layer         | Fill   | Shadow          |
| ------------- | ------ | --------------- |
| Frame         | `--n0` | —               |
| Work surface  | `--n1` | `--shadow-card` |
| Card/composer | `--n2` | `--shadow-card` |
| Floating      | `--n2` | `--shadow-pop`  |

---

## 7. Motion

| Token         | Value                        | Applies to                                   |
| ------------- | ---------------------------- | -------------------------------------------- |
| `--ease`      | `cubic-bezier(0.2, 0, 0, 1)` | Everything. Fast out, long settle.           |
| `--dur-fast`  | 120ms                        | Hover, focus ring, chip toggle, button press |
| `--dur-base`  | 180ms                        | Popover, dropdown, card hover lift           |
| `--dur-slow`  | 280ms                        | Modal, panel slide, card entrance (`rise`)   |
| `--dur-pulse` | 1600ms                       | Live state only (below)                      |

### Only live things loop

Looping motion means _an agent is working right now_ and nothing else:

- **Radar**: a running status dot radiates a ring outward.
- **Scan line**: a running card sweeps a thin accent line along its top edge.
- **Shimmer**: "Working" and loading text sweep a highlight across themselves.
- **Spinner**: a running tool call's status icon.

Waiting-on-you is deliberately static: it is the user's move, not the agent's. All
loops stop under `prefers-reduced-motion`; the signal stays as a static fill.

### The streaming rule

Streamed tokens **must never animate individually**: no per-token fade, no
typewriter reveal, no layout shift as text arrives. Text appears instantly.

---

## 8. Logo

### 8.1 The mark — Caret-A

The letter A whose apex is a shell caret. Two strokes on a 32-unit grid. The
crossbar is the only accent element, so the mark carries brand color in exactly
one place.

```svg
<svg viewBox="0 0 32 32" fill="none">
  <path d="M6 26 L16 6 L26 26" stroke="var(--n8)" stroke-width="3.2"
        stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M11 19 H21" stroke="var(--accent-base)" stroke-width="3.2"
        stroke-linecap="round"/>
</svg>
```

### 8.2 Optical sizes

Stroke thickens as the mark shrinks and the legs pull inward to hold the counter
open. This is optical compensation, not scaling — **ship three discrete SVGs**, not
one scaled asset.

| Size           | Stroke | Legs                                              |
| -------------- | ------ | ------------------------------------------------- |
| 32px and above | 3.2    | `M6 26 L16 6 L26 26` · bar `M11 19 H21`           |
| 20px           | 3.6    | same paths                                        |
| 16px           | 4.2    | `M6.5 26 L16 6.5 L25.5 26` · bar `M11.5 19 H20.5` |

### 8.3 App tile

Caret-A knocked out of a flat accent tile, for the dock, favicon, and avatar slots.
64-unit grid, `rx="14"`, fill `--accent-base`, mark in `--accent-fg` at stroke 6.4.

### 8.4 Wordmark

`aide` — lowercase, Geist 600, tracking −0.035em.

In the outlined production SVG, the tittle of the **i** is `--accent-base` while the
rest is `--n8`. One dot of brand color, echoing the crossbar. Live-text fallbacks
render single-color; the rule applies to the SVG only.

### 8.5 Lockup

Mark + wordmark, horizontal. Gap = mark stroke width × 3. Clear space on all sides
= the mark's cap height.

### 8.6 Usage

**Do:** use the mark alone once "aide" is established on the surface · crossbar in
`--accent-base` on dark, `--accent-dim` on light · keep clear space equal to cap
height.

**Don't:** set the wordmark in title case or caps · place a vendor mark inside the
lockup · outline, gradient, or shadow the flat mark · put the flat mark on a photo
(use the tile) · stretch the lockup gap.

### 8.7 Secondary glyph — Multiplex

One session entering, three harnesses leaving. Neutral, no accent. For docs
diagrams and the site's architecture section only — never as the primary mark, and
never as a favicon.

---

## 9. Voice

aide is precise, not impressive. Every claim in the product is checkable; the copy
should be too.

**Principles**

1. **Precise over impressive.** "Switch harness mid-conversation", not "AI-powered orchestration."
2. **The session is the subject.** Lead with what the user keeps, not which vendors are supported.
3. **Local is a feature.** Loopback-bound, SQLite on your disk, no account. Say it plainly and early.

**Standing copy**

Marketing leads with switching agents, not with local-first. Local / SQLite /
loopback remain true of the product; they do not have to lead the landing page.

| Slot       | Copy                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| Tagline    | One conversation. Any agent.                                                                                              |
| Descriptor | An open-source home for coding agents.                                                                                    |
| Hero sub   | Start in OpenCode, continue in Claude, and finish in Codex. Switch whenever you want without explaining everything again. |
| Meta / OG  | aide lets you switch between coding agents without starting over.                                                         |
| Page title | aide — one conversation across coding agents                                                                              |
| Docs intro | aide owns the session. Harnesses are configuration.                                                                       |

**Write:** "aide stores the transcript" · "select an instance per message" · "runs on
127.0.0.1" · sentence case · lowercase "aide" even sentence-initially.

**Avoid:** "supercharge" · "seamlessly" · "revolutionary" · "AI-powered" ·
exclamation marks in product UI · Title Case Headings · "Aide" capitalized ·
claiming harness support that isn't shipped.

---

## 10. Marketing site & docs

One Astro project. Marketing pages hand-built against these tokens; `/docs` on
Starlight with a custom theme layer.

```
apps/www/
  src/
    styles/
      tokens.css        ← generated from packages/ui globals.css. Never hand-edited.
      starlight.css     ← maps aide tokens onto --sl-* variables
      marketing.css     ← hero, feature grid, install block
    components/
      Logo.astro        ← 3 optical sizes + tile variant
      InstallTabs.astro ← curl / npm / bun / brew
      HarnessGrid.astro ← official vendor marks, unmodified
    pages/
      index.astro
    content/docs/       ← Starlight collection
  astro.config.mjs
```

`tokens.css` is **generated, never authored.** If the accent changes, the app and
site move in one commit.

### 10.1 Starlight mapping

| Starlight variable               | aide token                     | Note                                                                        |
| -------------------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| `--sl-color-accent`              | `--accent-ink`                 | Links, active sidebar item, focus                                           |
| `--sl-color-accent-low`          | `--accent-subtle`              | Selected row, note-badge background                                         |
| `--sl-color-accent-high`         | `--accent-hi` / `--accent-ink` | Hover, visited. Light mode uses the ink so it holds contrast on white       |
| `--sl-color-bg`                  | `--n0`                         | Page canvas                                                                 |
| `--sl-color-bg-nav`              | `--n1`                         | Header + `backdrop-filter: blur(14px)` at 0.82 alpha                        |
| `--sl-color-bg-sidebar`          | `--n1`                         | Same surface as the app sidebar, deliberately                               |
| `--sl-color-bg-inline-code`      | `--n2`                         | —                                                                           |
| `--sl-color-hairline` / `-shade` | `--line`                       | Alpha border, not a gray step                                               |
| `--sl-color-gray-1` … `-6`       | `--n7` … `--n2`                | Starlight's ramp runs light→dark; ours runs dark→light. **Map in reverse.** |
| `--sl-color-text`                | `--n7`                         | Body copy                                                                   |
| `--sl-color-white`               | `--n8`                         | Headings. Never pure `#fff`.                                                |
| `--sl-font`                      | Geist                          | —                                                                           |
| `--sl-font-mono`                 | IBM Plex Mono                  | Docs are the one place mono runs long — code samples are the content        |
| `--sl-content-width`             | `45rem`                        | —                                                                           |
| `--sl-nav-height`                | `4rem`                         | —                                                                           |
| `--sl-text-h1` … `h4`            | 40 / 30 / 20 / 16px            | From §3.2                                                                   |

### 10.2 Pages

**Landing `/`** — hero (two-line Geist 600 display, install tabs, switch
demo framed as the product) → proof strip → explainer → harness strip in official
marks → open-source split → FAQ accordion → install CTA. Footer is a single row:
wordmark, `© 2026 · MIT licensed`, Docs, GitHub, then the trademark note. Copy is in
`apps/www/src/pages/index.astro`; if the page changes, update this section.

**Docs `/docs`** — Intro · Install · Concepts (sessions, harnesses, instances,
parts) · Harnesses (OpenCode, Claude, adding a driver) · Configuration · MCP ·
Git & workspace · Troubleshooting. Sidebar order mirrors PLAN.md's section order so
the docs and the design doc stay reconcilable.

Light mode is required for docs — people link to them from anywhere.

---

## 11. Implementation

### 11.1 Where it lives

`packages/ui/src/styles/globals.css` is the implementation and is not duplicated
here. Tokens are primitives (`--n*`, `--accent-*`, status, `--line*`, shadows),
mapped once onto the shadcn contract and exposed to Tailwind through `@theme
inline` (`bg-frame`, `bg-surface`, `shadow-card`, `shadow-pop`, `text-ui`, …).

`cn()` in `packages/ui/src/lib/utils.ts` teaches tailwind-merge the type roles
(`text-ui`, `text-small`, …). Without it a following colour class silently deletes
the size.

### 11.2 Product surfaces

| Surface         | Where                                         | Notes                                                                                           |
| --------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Shell           | `apps/web/src/components/shell/app-shell.tsx` | Sidebar on the frame; session + panel on an inset work surface. Panes float below `md`.         |
| Mission control | `apps/web/src/features/overview/`             | Start a task (project, worktree, harness, prompt → session created and sent), then three lanes. |
| Sidebar         | `apps/web/src/components/shell/sidebar.tsx`   | Needs you, Running, then every project. Harness health in the footer.                           |
| Command palette | `apps/web/src/components/command-palette.tsx` | ⌘K / Ctrl+K. Sessions, actions, and open-by-id for a pasted `session_…`.                        |
| Transcript      | `apps/web/src/features/transcript/`           | User bubbles right; assistant rows under a harness avatar; a handoff divider at every switch.   |
| Composer        | `apps/web/src/features/composer/composer.tsx` | One card; adapter controls as pills; ⌘↵ sends.                                                  |
| Full-app demo   | `apps/web/gallery.html?app`                   | The real App over a demo workspace; no server or harness needed.                                |

---

## 12. Decision log

Recorded so settled questions stay settled. Each was chosen over specific
alternatives.

| Decision               | Chosen                         | Over                                                                | Why                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redesign (2026-10)     | Mission control, dark-first    | Chat-first single thread; IDE-style panes                           | Users run several agents at once and switch harness mid-task. Status across sessions and the handoff seam are the product; the home screen now shows both.                                                                         |
| Accent saturation      | C 0.155 sky, hue 240           | The soft C 0.097 sky                                                | The soft accent made primary buttons look disabled and could not carry "live". Same hue family, so the brand reads as continuous.                                                                                                  |
| Neutral tint           | Hue 255 at C ≈0.01             | True black and white                                                | Flat black/grey read unfinished; a faint ink tint gives depth and sits with the sky accent.                                                                                                                                        |
| Mono face              | Geist Mono                     | IBM Plex Mono                                                       | Same proportions as Geist, so mono spans sit in a sentence without a seam.                                                                                                                                                         |
| Radius, elevation      | 8px base; edge-light shadows   | 6px flat surfaces only                                              | Cards on a board need a tangible edge; a 1px top highlight does that on dark without decorative drop shadows.                                                                                                                      |
| Looping motion         | All live states, not one dot   | Streaming dot only                                                  | On a board of many sessions the eye must find running work instantly. Loops stay reserved for live work, never waiting or done.                                                                                                    |
| Accent hue             | Sky blue `#5FA8D3`, hue 236    | Cyan-teal (200); orange `#E88C2A`; cobalt `#2F6BFF`                 | Chosen in the 2026 restyle. Light enough to carry near-black text on fills, calm next to vendor marks, and bluer than the old cyan so the change reads as a rebrand. Accent text takes a separate ink token for contrast on white. |
| Base mode              | Dark default, light shipped    | Light-first (the shadcn default)                                    | Local developer tool that lives beside a terminal. Both reference sites are dark-only.                                                                                                                                             |
| Neutrals (superseded)  | True black and white           | Hue-250 tint at C≈0.006                                             | The restyle alternates pure black and white surfaces. A blue-tinted ramp read gray-blue next to the sky-blue accent.                                                                                                               |
| Typeface               | Geist alone, app and site      | Instrument Sans; Bricolage Grotesque; Inter; IBM Plex Sans          | Plain, modern and built for developer tools, without Inter's ubiquity. One family everywhere keeps the site and app identical.                                                                                                     |
| Outfit                 | Removed                        | Keeping it                                                          | Geometric, wide, near-circular bowls fighting Instrument Sans's rhythm. Zero consumers.                                                                                                                                            |
| Display face           | None; Geist 600 at large sizes | Instrument Serif italic; Petrona                                    | Serif display was tried in the 2026 restyle and rejected in favor of a sans-only system.                                                                                                                                           |
| Mono (face superseded) | IBM Plex Mono, short allowlist | Full second register ("sans for language, mono for machine output") | Mono costs width and tone across a long transcript. Restricting it makes a monospaced line _mean_ machine-issued and copyable.                                                                                                     |
| Harness identity       | Official vendor marks, as-is   | Six aide-assigned categorical hues                                  | A vendor's mark is unambiguous and self-updating; an invented color is a mapping every user must learn and breaks when a seventh harness arrives. Using marks unmodified also removes the trademark risk, which lay in recoloring. |
| Theme default          | `"system"`                     | Forcing dark                                                        | Respects a stated OS preference and requires no provider change or test churn.                                                                                                                                                     |
| Name casing            | `aide`, always lowercase       | "Aide" in prose, lowercase wordmark only                            | Matches opencode's convention; one rule with no exceptions is easier to hold.                                                                                                                                                      |
| Radius (superseded)    | 6px base, capped 14px          | 8px base capped 18px                                                | Sharper corners give a flat, printed feel while pills and dots stay round.                                                                                                                                                         |
| Elevation              | Neutral-ramp surfaces          | Drop shadows                                                        | On a canvas at L 0.145 a shadow is nearly invisible; a 0.04 lightness step is not.                                                                                                                                                 |
| Categorical palette    | None                           | `--chart-1…5`                                                       | Five samples of one blue is a sequential scale, not a categorical one. With harness color dropped, aide has no categorical need at all.                                                                                            |

### Reference audit

Design references are [t3.codes](https://t3.codes) and [opencode.ai](https://opencode.ai).
Tokens below were pulled from their live computed stylesheets.

|             | t3.codes                                               | opencode.ai                                                |
| ----------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| Personality | Sans, warm-dark, rounded                               | Mono, neutral-dark, square                                 |
| Canvas      | `#09090b`                                              | `#0c0c0e`                                                  |
| Accent      | `oklch(.68 .17 250)`                                   | `#007aff`                                                  |
| Type        | DM Sans + JetBrains Mono                               | Berkeley Mono throughout                                   |
| Radius      | 8 / 12 / 16                                            | 0                                                          |
| Borrowed    | Alpha borders (`#ffffff14`) — they survive any surface | Per-role `-hover` / `-active` variants; 45rem docs measure |

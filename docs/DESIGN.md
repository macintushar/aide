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

Nine steps at hue 250, chroma ≈0.006. The tint is imperceptible alone but keeps
surfaces related to the accent instead of reading as flat concrete. This ramp
replaces every gray in the system — there is no second neutral family.

| Token  | Dark                     | Light                    | Role                     |
| ------ | ------------------------ | ------------------------ | ------------------------ |
| `--n0` | `oklch(0.145 0.005 250)` | `oklch(0.995 0.001 250)` | Canvas                   |
| `--n1` | `oklch(0.185 0.006 250)` | `oklch(0.975 0.002 250)` | Card, sidebar, composer  |
| `--n2` | `oklch(0.225 0.007 250)` | `oklch(0.955 0.003 250)` | Popover, dropdown, hover |
| `--n3` | `oklch(0.285 0.008 250)` | `oklch(0.910 0.004 250)` | Input fill, pressed      |
| `--n4` | `oklch(0.420 0.008 250)` | `oklch(0.780 0.006 250)` | Ghost text, disabled     |
| `--n5` | `oklch(0.580 0.008 250)` | `oklch(0.620 0.008 250)` | Faint text, placeholders |
| `--n6` | `oklch(0.720 0.006 250)` | `oklch(0.480 0.010 250)` | Muted / secondary body   |
| `--n7` | `oklch(0.870 0.004 250)` | `oklch(0.320 0.010 250)` | Body text                |
| `--n8` | `oklch(0.970 0.002 250)` | `oklch(0.180 0.008 250)` | Headings, emphasis       |

Never use pure `#fff` or `#000` for text. `--n8` on `--n0` is the maximum contrast
pair; pure white vibrates against the canvas.

### 2.2 Accent — cyan-teal, hue 200

The brand color. The one hue on screen that no agent vendor owns, which is what
keeps it legible as _aide's own chrome_ rather than as another logo.

| Token             | Dark                     | Light                    | Role                     |
| ----------------- | ------------------------ | ------------------------ | ------------------------ |
| `--accent-subtle` | `oklch(0.280 0.050 200)` | `oklch(0.945 0.035 200)` | Badge fill, selected row |
| `--accent-dim`    | `oklch(0.450 0.090 200)` | `oklch(0.780 0.090 200)` | Borders, dividers        |
| `--accent-base`   | `oklch(0.720 0.130 200)` | `oklch(0.550 0.130 200)` | Links, primary fill      |
| `--accent-hi`     | `oklch(0.800 0.130 200)` | `oklch(0.470 0.130 200)` | Hover, focus ring        |
| `--accent-fg`     | `oklch(0.170 0.030 200)` | `oklch(0.990 0.010 200)` | Text **on** the accent   |

**`--accent-fg` is dark in dark mode.** The accent is bright, so text on top of it is
near-black, not white. This inverts the shadcn default. Anything hardcoding
light-on-primary is a bug.

In light mode the accent drops to L 0.550 so it holds contrast on white, and
`--accent-fg` flips back to light.

### 2.3 Borders

Alpha, never a step in the neutral ramp. A solid gray border breaks the moment a
card sits on a different surface; an alpha border never does.

| Token           | Dark                  | Light                 | Role                                          |
| --------------- | --------------------- | --------------------- | --------------------------------------------- |
| `--line`        | `oklch(1 0 0 / 0.09)` | `oklch(0 0 0 / 0.10)` | Hairlines, card edges, table rules            |
| `--line-strong` | `oklch(1 0 0 / 0.17)` | `oklch(0 0 0 / 0.18)` | Inputs, secondary buttons, focused containers |

### 2.4 Status

Three roles, all at L 0.68–0.82 in dark so no status outshouts another.

| Token           | Dark                     | Light                    | Meaning                                                    |
| --------------- | ------------------------ | ------------------------ | ---------------------------------------------------------- |
| `--ok`          | `oklch(0.760 0.160 155)` | `oklch(0.560 0.150 155)` | Turn completed, tool succeeded, instance healthy           |
| `--warn`        | `oklch(0.820 0.150 80)`  | `oklch(0.640 0.140 70)`  | Permission requested, degraded capability, context rebuilt |
| `--danger-base` | `oklch(0.680 0.200 25)`  | `oklch(0.560 0.200 25)`  | Turn failed, adapter crashed, destructive confirm          |

### 2.5 Diff

Foreground stays readable as code; background tint stays quiet enough to read a
full file through. Backgrounds are alpha so they compose over any surface.

| Token           | Dark                          | Light                         |
| --------------- | ----------------------------- | ----------------------------- |
| `--diff-add-fg` | `oklch(0.84 0.15 150)`        | `oklch(0.45 0.14 150)`        |
| `--diff-add-bg` | `oklch(0.55 0.12 150 / 0.16)` | `oklch(0.70 0.13 150 / 0.18)` |
| `--diff-del-fg` | `oklch(0.79 0.17 22)`         | `oklch(0.48 0.17 22)`         |
| `--diff-del-bg` | `oklch(0.55 0.14 22 / 0.16)`  | `oklch(0.70 0.15 22 / 0.18)`  |

Diff hues sit ~5° off `--ok` and `--danger-base`. Deliberate near-miss — a diff must
never read as a status.

### 2.6 Rules

- No categorical color palette exists. aide has no charts and no per-harness colors.
  If you need to distinguish N things, use marks, labels, or position — not hue.
- Turn state is the only thing in a transcript that carries color (§5).
- Never introduce a color outside this file. Extend this file instead.

---

## 3. Typography

### 3.1 Faces

| Face                          | Where                                                                      | Never                                                      |
| ----------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Instrument Sans**           | The entire app — body, UI, headings, labels, buttons. Also site body copy. | —                                                          |
| **Instrument Serif** (italic) | Marketing site display type only: hero, section headers.                   | In the app. Below 32px. More than one line of a paragraph. |
| **JetBrains Mono**            | The allowlist in §3.4 only.                                                | Anywhere not on that list.                                 |

The app uses **one typeface**. There is no separate heading face — hierarchy comes
from weight and tracking (§3.2). The app's largest type is a dialog title at ~19px,
where a second grotesque would be indistinguishable and cost a second font load.
Outfit is removed.

Packages: `@fontsource-variable/instrument-sans`,
`@fontsource-variable/jetbrains-mono`. Instrument Serif is loaded by the site only.

### 3.2 Scale

| Role                                | Size    | Weight | Tracking    |
| ----------------------------------- | ------- | ------ | ----------- |
| Display _(site only, serif italic)_ | 52–72px | 400    | −0.015em    |
| h1                                  | 40px    | 600    | −0.038em    |
| h2                                  | 30px    | 600    | −0.030em    |
| h3                                  | 20px    | 600    | −0.020em    |
| Body                                | 15px    | 400    | 0           |
| UI                                  | 13px    | 400    | 0           |
| Small                               | 12px    | 400    | 0           |
| Label _(uppercase)_                 | 11px    | 600    | **+0.10em** |
| Mono                                | 12px    | 400    | 0           |

**Tracking tightens as size grows** — −0.020em at 20px through −0.042em at 60px.
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

**Sans — everything else**, including: section labels, badges and status tags,
timestamps, model and agent names in the composer, sidebar items, table headers,
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

**interrupted ≠ failed.** aide has explicit turn interruption in Day-0 scope, so
users hit "interrupted" constantly. It is a deliberate user action, not an error.
Coloring it red trains people to ignore red.

---

## 6. Form

### 6.1 Radius

Base `--radius: 0.5rem` (8px).

| Token          | Value | Use                                  |
| -------------- | ----- | ------------------------------------ |
| `--radius-sm`  | 5px   | Chips, small controls, inline badges |
| `--radius-md`  | 6px   | Buttons, inputs                      |
| `--radius-lg`  | 8px   | Cards, popovers, tool-call blocks    |
| `--radius-xl`  | 12px  | Panels, modals                       |
| `--radius-2xl` | 18px  | Large containers, window chrome      |

Capped at 18px — nothing in a dense transcript needs more. `99px` (full round) is
available for dots and pills only.

### 6.2 Elevation

**Surfaces, not shadows.** On a canvas at L 0.145 a drop shadow is nearly invisible;
a 0.04 step in lightness is not.

| Surface  | Token  | Use                            |
| -------- | ------ | ------------------------------ |
| Canvas   | `--n0` | Page / app background          |
| Raised   | `--n1` | Card, sidebar, composer        |
| Floating | `--n2` | Popover, dropdown, hover state |
| Active   | `--n3` | Focused input, pressed control |

Shadows are reserved for genuinely floating layers — modals, command palette, and
the app window itself — where they read as depth rather than decoration.

---

## 7. Motion

| Token         | Value                        | Applies to                                         |
| ------------- | ---------------------------- | -------------------------------------------------- |
| `--ease`      | `cubic-bezier(0.2, 0, 0, 1)` | Everything. Fast out, long settle.                 |
| `--dur-fast`  | 120ms                        | Hover, focus ring, chip toggle, button press       |
| `--dur-base`  | 180ms                        | Popover, dropdown, sidebar item, tab change        |
| `--dur-slow`  | 280ms                        | Modal, panel slide, session switch                 |
| `--dur-pulse` | 1600ms                       | Streaming dot only. Nothing else in the app loops. |

### The streaming rule

Streamed tokens **must never animate individually** — no per-token fade, no
typewriter reveal, no layout shift as text arrives. Text appears instantly; only
the caret blinks and the state dot pulses.

Fading each token makes fast models look slow and makes long outputs unreadable
while they arrive. Honor `prefers-reduced-motion` by dropping the pulse to a
static fill.

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

Caret-A knocked out of an accent gradient, for the dock, favicon, and avatar slots.
64-unit grid, `rx="15"`, gradient `oklch(0.80 0.13 200)` → `oklch(0.60 0.13 210)`,
mark in `--accent-fg` at stroke 6.4.

### 8.4 Wordmark

`aide` — lowercase, Instrument Sans 600, tracking −0.035em.

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

| Slot         | Copy                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Tagline      | One conversation. Any agent.                                                                                                      |
| Descriptor   | An open-source home for coding agents.                                                                                            |
| Hero sub     | Start in OpenCode, continue in Claude, and finish in Codex. Switch whenever you want without explaining everything again.         |
| Meta / OG    | aide lets you switch between coding agents without starting over.                                                                 |
| Page title   | aide — one conversation across coding agents                                                                                      |
| Docs intro   | aide owns the session. Harnesses are configuration.                                                                               |

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

| Starlight variable               | aide token          | Note                                                                        |
| -------------------------------- | ------------------- | --------------------------------------------------------------------------- |
| `--sl-color-accent`              | `--accent-base`     | Links, active sidebar item, focus                                           |
| `--sl-color-accent-low`          | `--accent-subtle`   | Selected row, note-badge background                                         |
| `--sl-color-accent-high`         | `--accent-hi`       | Hover, visited                                                              |
| `--sl-color-bg`                  | `--n0`              | Page canvas                                                                 |
| `--sl-color-bg-nav`              | `--n1`              | Header + `backdrop-filter: blur(14px)` at 0.82 alpha                        |
| `--sl-color-bg-sidebar`          | `--n1`              | Same surface as the app sidebar, deliberately                               |
| `--sl-color-bg-inline-code`      | `--n2`              | —                                                                           |
| `--sl-color-hairline` / `-shade` | `--line`            | Alpha border, not a gray step                                               |
| `--sl-color-gray-1` … `-6`       | `--n7` … `--n2`     | Starlight's ramp runs light→dark; ours runs dark→light. **Map in reverse.** |
| `--sl-color-text`                | `--n7`              | Body copy                                                                   |
| `--sl-color-white`               | `--n8`              | Headings. Never pure `#fff`.                                                |
| `--sl-font`                      | Instrument Sans     | —                                                                           |
| `--sl-font-mono`                 | JetBrains Mono      | Docs are the one place mono runs long — code samples are the content        |
| `--sl-content-width`             | `45rem`             | —                                                                           |
| `--sl-nav-height`                | `4rem`              | —                                                                           |
| `--sl-text-h1` … `h4`            | 40 / 30 / 20 / 16px | From §3.2                                                                   |

### 10.2 Pages

**Landing `/`** — hero (two-line Instrument Serif italic, install tabs, switch
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

### 11.1 `packages/ui/src/styles/globals.css`

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "@fontsource-variable/instrument-sans";
@import "@fontsource-variable/jetbrains-mono";

@custom-variant dark (&:is(.dark *));
@custom-variant light (&:is(.light *));
@source "../../../apps/**/*.{ts,tsx}";
@source "../../../components/**/*.{ts,tsx}";
@source "../**/*.{ts,tsx}";

/* ── aide primitives ─────────────────────────────────────────
   ThemeProvider always writes an explicit .light or .dark onto
   <html> and defaults to "system", so :root governs only the
   pre-hydration frame. Dark there makes that frame dark, not white. */
:root,
.dark {
  --n0: oklch(0.145 0.005 250);
  --n1: oklch(0.185 0.006 250);
  --n2: oklch(0.225 0.007 250);
  --n3: oklch(0.285 0.008 250);
  --n4: oklch(0.42 0.008 250);
  --n5: oklch(0.58 0.008 250);
  --n6: oklch(0.72 0.006 250);
  --n7: oklch(0.87 0.004 250);
  --n8: oklch(0.97 0.002 250);

  --accent-subtle: oklch(0.28 0.05 200);
  --accent-dim: oklch(0.45 0.09 200);
  --accent-base: oklch(0.72 0.13 200);
  --accent-hi: oklch(0.8 0.13 200);
  --accent-fg: oklch(0.17 0.03 200);

  --line: oklch(1 0 0 / 0.09);
  --line-strong: oklch(1 0 0 / 0.17);

  --ok: oklch(0.76 0.16 155);
  --warn: oklch(0.82 0.15 80);
  --danger-base: oklch(0.68 0.2 25);

  --diff-add-fg: oklch(0.84 0.15 150);
  --diff-add-bg: oklch(0.55 0.12 150 / 0.16);
  --diff-del-fg: oklch(0.79 0.17 22);
  --diff-del-bg: oklch(0.55 0.14 22 / 0.16);

  --ease: cubic-bezier(0.2, 0, 0, 1);
  --dur-fast: 120ms;
  --dur-base: 180ms;
  --dur-slow: 280ms;
  --dur-pulse: 1600ms;

  --radius: 0.5rem;
}

/* ── shadcn contract ─────────────────────────────────────── */
:root,
.dark {
  --background: var(--n0);
  --foreground: var(--n8);
  --card: var(--n1);
  --card-foreground: var(--n8);
  --popover: var(--n2);
  --popover-foreground: var(--n8);
  --primary: var(--accent-base);
  --primary-foreground: var(--accent-fg);
  --secondary: var(--n3);
  --secondary-foreground: var(--n8);
  --muted: var(--n2);
  --muted-foreground: var(--n6);
  --accent: var(--n2);
  --accent-foreground: var(--n8);
  --destructive: var(--danger-base);
  --border: var(--line);
  --input: var(--line-strong);
  --ring: var(--accent-hi);
  --sidebar: var(--n1);
  --sidebar-foreground: var(--n7);
  --sidebar-primary: var(--accent-base);
  --sidebar-primary-foreground: var(--accent-fg);
  --sidebar-accent: var(--n2);
  --sidebar-accent-foreground: var(--n8);
  --sidebar-border: var(--line);
  --sidebar-ring: var(--accent-hi);
}

/* ── light theme ─────────────────────────────────────────── */
.light {
  --n0: oklch(0.995 0.001 250);
  --n1: oklch(0.975 0.002 250);
  --n2: oklch(0.955 0.003 250);
  --n3: oklch(0.91 0.004 250);
  --n4: oklch(0.78 0.006 250);
  --n5: oklch(0.62 0.008 250);
  --n6: oklch(0.48 0.01 250);
  --n7: oklch(0.32 0.01 250);
  --n8: oklch(0.18 0.008 250);

  --accent-subtle: oklch(0.945 0.035 200);
  --accent-dim: oklch(0.78 0.09 200);
  --accent-base: oklch(0.55 0.13 200);
  --accent-hi: oklch(0.47 0.13 200);
  --accent-fg: oklch(0.99 0.01 200);

  --line: oklch(0 0 0 / 0.1);
  --line-strong: oklch(0 0 0 / 0.18);

  --ok: oklch(0.56 0.15 155);
  --warn: oklch(0.64 0.14 70);
  --danger-base: oklch(0.56 0.2 25);

  --diff-add-fg: oklch(0.45 0.14 150);
  --diff-add-bg: oklch(0.7 0.13 150 / 0.18);
  --diff-del-fg: oklch(0.48 0.17 22);
  --diff-del-bg: oklch(0.7 0.15 22 / 0.18);
}

@theme inline {
  /* existing --color-* passthroughs unchanged */
  --color-diff-add: var(--diff-add-fg);
  --color-diff-del: var(--diff-del-fg);

  --radius-sm: calc(var(--radius) * 0.625); /*  5px */
  --radius-md: calc(var(--radius) * 0.8); /*  6px */
  --radius-lg: var(--radius); /*  8px */
  --radius-xl: calc(var(--radius) * 1.5); /* 12px */
  --radius-2xl: calc(var(--radius) * 2.25); /* 18px */

  --font-sans: "Instrument Sans Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono:
    "JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace;
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
  button:not(:disabled),
  [role="button"]:not(:disabled) {
    cursor: pointer;
  }
}
```

### 11.2 Migration checklist

| #   | Step                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Swap `@fontsource-variable/outfit` → `@fontsource-variable/jetbrains-mono` in `packages/ui/package.json`.                                                                                                                                                       |
| 2   | Restructure theme blocks to `:root, .dark` and `.light`. `theme-provider.tsx` needs **no change** — it already writes an explicit class and defaults to `"system"`, so all three of its tests keep passing. This step only fixes the white pre-hydration flash. |
| 3   | Delete `--font-heading`. Verified zero consumers: declared at `globals.css:121`, referenced nowhere.                                                                                                                                                            |
| 4   | Audit light-on-primary assumptions — `--primary-foreground` is now dark. Verified single consumer: `packages/ui/src/components/button.tsx:11`.                                                                                                                  |
| 5   | Delete `--chart-1…5` and their `@theme inline` passthroughs. Verified zero consumers outside the stylesheet.                                                                                                                                                    |
| 6   | Add a required `icon` field to the adapter capability descriptor in `packages/contracts` (§4.3).                                                                                                                                                                |
| 7   | Collect official vendor marks into `packages/ui/src/assets/harnesses/` (§4.4).                                                                                                                                                                                  |
| 8   | Apply §3.2 tracking rules to heading styles. Absent today.                                                                                                                                                                                                      |

---

## 12. Decision log

Recorded so settled questions stay settled. Each was chosen over specific
alternatives.

| Decision            | Chosen                             | Over                                                                | Why                                                                                                                                                                                                                                |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accent hue          | Cyan-teal, hue 200                 | Brightened blue (250); violet (292)                                 | Blue lands within ~5° of t3.codes' accent. Violet is the most crowded hue in dev tooling and sits on Cursor's brand color. Vendor marks bring vendor color into the transcript, so aide's accent must be a hue no vendor owns.     |
| Base mode           | Dark default, light shipped        | Light-first (the shadcn default)                                    | Local developer tool that lives beside a terminal. Both reference sites are dark-only.                                                                                                                                             |
| Neutrals            | Hue-250 tint at C≈0.006            | Pure achromatic; the stock hue-286 mix                              | The original file mixed two neutral families with no rule, so surfaces drifted violet. A single tinted ramp relates surfaces to the accent.                                                                                        |
| App typeface        | Instrument Sans alone              | Adding a heading face; swapping to Host Grotesk or Geist            | The app's largest type is ~19px, where neutral grotesques are indistinguishable. A second font is a load cost for no visible gain.                                                                                                 |
| Outfit              | Removed                            | Keeping it                                                          | Geometric, wide, near-circular bowls fighting Instrument Sans's rhythm. Zero consumers.                                                                                                                                            |
| Display face        | Instrument Serif italic, site only | Instrument Sans 600 at large sizes                                  | Same superfamily, so the pairing is designed. Both reference sites are pure sans/mono — a serif keeps the site from reading as a clone. Zero cost to the app.                                                                      |
| Mono                | Short allowlist                    | Full second register ("sans for language, mono for machine output") | Mono costs width and tone across a long transcript. Restricting it makes a monospaced line _mean_ machine-issued and copyable.                                                                                                     |
| Harness identity    | Official vendor marks, as-is       | Six aide-assigned categorical hues                                  | A vendor's mark is unambiguous and self-updating; an invented color is a mapping every user must learn and breaks when a seventh harness arrives. Using marks unmodified also removes the trademark risk, which lay in recoloring. |
| Theme default       | `"system"`                         | Forcing dark                                                        | Respects a stated OS preference and requires no provider change or test churn.                                                                                                                                                     |
| Name casing         | `aide`, always lowercase           | "Aide" in prose, lowercase wordmark only                            | Matches opencode's convention; one rule with no exceptions is easier to hold.                                                                                                                                                      |
| Radius              | 8px base, capped 18px              | 10px base scaling to 26px                                           | The 26px top end is pill-adjacent and belongs on a marketing page, not a dense transcript.                                                                                                                                         |
| Elevation           | Neutral-ramp surfaces              | Drop shadows                                                        | On a canvas at L 0.145 a shadow is nearly invisible; a 0.04 lightness step is not.                                                                                                                                                 |
| Categorical palette | None                               | `--chart-1…5`                                                       | Five samples of one blue is a sequential scale, not a categorical one. With harness color dropped, aide has no categorical need at all.                                                                                            |

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

import type {
  FileMatch,
  HarnessCommand,
  HarnessSkill,
  Invocation,
} from "@workspace/contracts"

/**
 * Text rules for the composer's two pickers, kept pure so they are testable
 * without a DOM:
 *
 * - `/name args` invokes a harness command or skill. The picker is open while
 *   the name is still being typed (a leading slash, no space yet).
 * - `@query` searches the session's files. Picking one replaces the token
 *   with a Markdown link whose target is relative to the session's working
 *   directory.
 */

export type SlashEntry = {
  kind: Invocation["kind"]
  name: string
  description?: string
  argumentHint?: string
}

export function slashEntries(
  commands: HarnessCommand[] = [],
  skills: HarnessSkill[] = []
): SlashEntry[] {
  return [
    ...commands.map((command) => ({
      kind: "command" as const,
      name: command.name,
      ...(command.description ? { description: command.description } : {}),
      ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
    })),
    ...skills.map((skill) => ({
      kind: "skill" as const,
      name: skill.id,
      ...(skill.description ? { description: skill.description } : {}),
    })),
  ]
}

/** The partial name while a slash command is being typed, else undefined. */
export function slashQuery(text: string): string | undefined {
  const match = /^\/([^\s/]*)$/.exec(text)
  return match ? match[1] : undefined
}

export function filterSlashEntries(
  entries: SlashEntry[],
  query: string,
  limit = 8
): SlashEntry[] {
  const needle = query.toLowerCase()
  const starts = entries.filter((entry) =>
    entry.name.toLowerCase().startsWith(needle)
  )
  const contains = entries.filter(
    (entry) =>
      !entry.name.toLowerCase().startsWith(needle) &&
      entry.name.toLowerCase().includes(needle)
  )
  return [...starts, ...contains].slice(0, limit)
}

/**
 * What a send means. `/name args` becomes an invocation with `args` as the
 * content when the instance offers that name; anything else is a plain
 * message, including a slash the harness would not recognise.
 */
export function parseSend(
  text: string,
  entries: SlashEntry[]
): { content: string; invocation?: Invocation } {
  const trimmed = text.trim()
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed)
  if (!match) return { content: trimmed }
  const name = match[1]!
  const entry =
    entries.find(
      (candidate) => candidate.kind === "command" && candidate.name === name
    ) ?? entries.find((candidate) => candidate.name === name)
  if (!entry) return { content: trimmed }
  return {
    content: (match[2] ?? "").trim(),
    invocation: { kind: entry.kind, name: entry.name },
  }
}

export type MentionToken = { query: string; start: number; end: number }

/** The `@query` token that ends at the caret, if there is one. */
export function mentionAt(
  text: string,
  caret: number
): MentionToken | undefined {
  const before = text.slice(0, caret)
  const match = /(^|\s)@([^\s@]*)$/.exec(before)
  if (!match) return undefined
  const start = before.length - match[2]!.length - 1
  return { query: match[2]!, start, end: caret }
}

/** A Markdown link target; angle brackets keep spaces and parentheses intact. */
export function markdownTarget(path: string): string {
  // `#` would read as a URL fragment and `%` as an escape, so both are
  // percent-encoded; the preview handler decodes them back.
  const encoded = path.replace(/%/g, "%25").replace(/#/g, "%23")
  return /[\s()<>]/.test(encoded)
    ? `<${encoded.replace(/[<>]/g, "")}>`
    : encoded
}

export function fileLink(file: FileMatch): string {
  return `[${file.name.replace(/[[\]]/g, "")}](${markdownTarget(file.path)})`
}

/** Replaces the mention token with a link to the file; returns the new caret. */
export function insertFileLink(
  text: string,
  token: MentionToken,
  file: FileMatch
): { text: string; caret: number } {
  const link = `${fileLink(file)} `
  const next = text.slice(0, token.start) + link + text.slice(token.end)
  return { text: next, caret: token.start + link.length }
}

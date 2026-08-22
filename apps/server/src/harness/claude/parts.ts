import type {
  Part,
  ToolCategory,
  ToolPart,
  ToolStatus,
} from "@workspace/contracts"

import type { ClaudeContentBlock, ClaudeRawStreamEvent } from "./query"

/**
 * Part synthesis for the Claude Agent SDK.
 *
 * OpenCode emits part-level updates. The Agent SDK emits message-level
 * assistant messages carrying Anthropic content blocks, plus raw `stream_event`
 * frames. Nothing upstream carries an Aide part id or an `index`, so this
 * module derives both by diffing successive deliveries — it cannot relabel.
 *
 * The three facts that shape the diff:
 *
 * 1. One API assistant turn may produce several assistant messages sharing a
 *    `message.id`, each carrying a different segment of the content. Matching
 *    blocks by their position inside the delivered array would therefore alias
 *    a later segment's first block onto the first segment's first block.
 * 2. The same message may be re-delivered. Re-delivery must land on the parts
 *    it landed on last time, not create duplicates.
 * 3. A block already reserved from a `content_block_start` frame is empty until
 *    its deltas arrive, and the completed block that follows carries the full
 *    text. So an existing block matches an incoming one when the incoming text
 *    *extends* it — equality and growth are the same rule.
 *
 * `tool_use` blocks sidestep all of this: their `id` is stable and unique, so
 * they are matched by it directly.
 */

type BlockKind = "text" | "reasoning" | "tool"

type BlockRecord = {
  partId: string
  index: number
  kind: BlockKind
  /** Accumulated text for `text` and `reasoning` blocks. */
  text: string
  /** Whether this block has been emitted as a part yet. */
  published: boolean
  toolUseId?: string
  name?: string
  category?: ToolCategory
  source?: { kind: "mcp"; server: string }
  input?: unknown
  status?: ToolStatus
  output?: string
}

export type SynthesizedDelta = {
  partId: string
  field: "text" | "reasoning" | "input"
  text: string
}

export type PartSynthesizer = {
  /** Applies one raw stream frame; returns the live delta it represents, if any. */
  applyStreamEvent(event: ClaudeRawStreamEvent): {
    delta?: SynthesizedDelta
    parts: Part[]
  }
  /** Diffs a completed assistant message; returns only the parts that changed. */
  applyAssistantMessage(
    apiMessageId: string,
    blocks: ClaudeContentBlock[]
  ): Part[]
  /** Applies `tool_result` blocks from a user message onto their tool parts. */
  applyToolResults(blocks: ClaudeContentBlock[]): Part[]
  /** Every part synthesized so far, in index order. */
  parts(): Part[]
}

const MCP_TOOL_PREFIX = "mcp__"

const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  bash: "shell",
  bashoutput: "shell",
  killshell: "shell",
  read: "file_read",
  glob: "file_read",
  notebookread: "file_read",
  write: "file_write",
  edit: "file_write",
  multiedit: "file_write",
  notebookedit: "file_write",
  grep: "search",
  websearch: "web",
  webfetch: "web",
  task: "agent",
  agent: "agent",
}

/** MCP tools arrive as `mcp__<server>__<tool>`; everything else is a builtin. */
export function toolIdentity(name: string): {
  category: ToolCategory
  source?: { kind: "mcp"; server: string }
} {
  if (name.startsWith(MCP_TOOL_PREFIX)) {
    const server = name.slice(MCP_TOOL_PREFIX.length).split("__")[0]
    return server
      ? { category: "mcp", source: { kind: "mcp", server } }
      : { category: "mcp" }
  }
  return { category: TOOL_CATEGORIES[name.toLowerCase()] ?? "other" }
}

function blockKind(block: ClaudeContentBlock): BlockKind | undefined {
  switch (block.type) {
    case "text":
      return "text"
    case "thinking":
    case "redacted_thinking":
      return "reasoning"
    case "tool_use":
    case "server_tool_use":
    case "mcp_tool_use":
      return "tool"
    default:
      return undefined
  }
}

function blockText(block: ClaudeContentBlock): string {
  if (block.type === "text") return block.text ?? ""
  if (block.type === "thinking") return block.thinking ?? ""
  // A redacted thinking block has no readable text; it still occupies a part so
  // the transcript shows that the model thought here.
  return ""
}

/** Tool results arrive as a string, a block array, or an arbitrary payload. */
export function stringifyToolOutput(content: unknown): string {
  if (content === undefined || content === null) return ""
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === "string") return entry
        if (entry && typeof entry === "object" && "text" in entry) {
          const text = (entry as { text?: unknown }).text
          if (typeof text === "string") return text
        }
        return JSON.stringify(entry)
      })
      .join("\n")
  }
  return JSON.stringify(content)
}

export function createPartSynthesizer(messageId: string): PartSynthesizer {
  /** Recorded blocks per API message id, in the order they were first seen. */
  const byApiMessage = new Map<string, BlockRecord[]>()
  const byToolUseId = new Map<string, BlockRecord>()
  const ordered: BlockRecord[] = []
  /** Stream-frame index to record, valid only within the current API message. */
  const byStreamIndex = new Map<number, BlockRecord>()
  let streamingApiMessageId = ""

  const create = (apiMessageId: string, kind: BlockKind): BlockRecord => {
    const index = ordered.length
    const record: BlockRecord = {
      partId: `${messageId}-part-${index}`,
      index,
      kind,
      text: "",
      published: false,
    }
    ordered.push(record)
    const recorded = byApiMessage.get(apiMessageId) ?? []
    recorded.push(record)
    byApiMessage.set(apiMessageId, recorded)
    return record
  }

  const toPart = (record: BlockRecord): Part => {
    if (record.kind === "tool") {
      const part: ToolPart = {
        id: record.partId,
        messageId,
        index: record.index,
        type: "tool",
        name: record.name ?? "tool",
        category: record.category ?? "other",
        status: record.status ?? "pending",
        ...(record.source ? { source: record.source } : {}),
        ...(record.input === undefined ? {} : { input: record.input }),
        ...(record.output === undefined ? {} : { output: record.output }),
      }
      return part
    }
    return {
      id: record.partId,
      messageId,
      index: record.index,
      type: record.kind === "reasoning" ? "reasoning" : "text",
      text: record.text,
    }
  }

  const adoptTool = (
    apiMessageId: string,
    block: ClaudeContentBlock
  ): BlockRecord => {
    const toolUseId = block.id ?? `${apiMessageId}-tool-${ordered.length}`
    const existing = byToolUseId.get(toolUseId)
    const record = existing ?? create(apiMessageId, "tool")
    record.toolUseId = toolUseId
    byToolUseId.set(toolUseId, record)
    if (block.name) record.name = block.name
    if (record.name && record.category === undefined) {
      const identity = toolIdentity(record.name)
      record.category = identity.category
      if (identity.source) record.source = identity.source
    }
    if (block.server_name) {
      record.source = { kind: "mcp", server: block.server_name }
      record.category = "mcp"
    }
    return record
  }

  return {
    applyStreamEvent(event) {
      const parts: Part[] = []
      switch (event.type) {
        case "message_start": {
          streamingApiMessageId = event.message?.id ?? streamingApiMessageId
          byStreamIndex.clear()
          return { parts }
        }
        case "content_block_start": {
          const block = event.content_block
          const kind = block ? blockKind(block) : undefined
          if (!block || kind === undefined || event.index === undefined) {
            return { parts }
          }
          const apiMessageId = streamingApiMessageId || messageId
          if (kind === "tool") {
            const record = adoptTool(apiMessageId, block)
            record.status ??= "pending"
            byStreamIndex.set(event.index, record)
            record.published = true
            parts.push(toPart(record))
            return { parts }
          }
          // Reserve the part now so the deltas that follow, and the completed
          // block that follows them, all land on the same id.
          const record = create(apiMessageId, kind)
          record.text = blockText(block)
          byStreamIndex.set(event.index, record)
          return { parts }
        }
        case "content_block_delta": {
          if (event.index === undefined) return { parts }
          const record = byStreamIndex.get(event.index)
          if (!record) return { parts }
          const delta = event.delta
          if (delta?.type === "text_delta" && delta.text !== undefined) {
            record.text += delta.text
            return {
              parts,
              delta: { partId: record.partId, field: "text", text: delta.text },
            }
          }
          if (
            delta?.type === "thinking_delta" &&
            delta.thinking !== undefined
          ) {
            record.text += delta.thinking
            return {
              parts,
              delta: {
                partId: record.partId,
                field: "reasoning",
                text: delta.thinking,
              },
            }
          }
          if (
            delta?.type === "input_json_delta" &&
            delta.partial_json !== undefined
          ) {
            return {
              parts,
              delta: {
                partId: record.partId,
                field: "input",
                text: delta.partial_json,
              },
            }
          }
          return { parts }
        }
        default:
          return { parts }
      }
    },

    applyAssistantMessage(apiMessageId, blocks) {
      const recorded = byApiMessage.get(apiMessageId) ?? []
      const consumed = new Set<BlockRecord>()
      const changed: Part[] = []

      for (const block of blocks) {
        const kind = blockKind(block)
        if (kind === undefined) continue

        if (kind === "tool") {
          const record = adoptTool(apiMessageId, block)
          const before = JSON.stringify([record.input, record.status])
          if (block.input !== undefined) record.input = block.input
          // A complete tool_use block means the input is settled and the
          // runtime is about to execute it; the result flips it terminal.
          if (record.status === undefined || record.status === "pending") {
            record.status = "running"
          }
          if (JSON.stringify([record.input, record.status]) !== before) {
            record.published = true
            changed.push(toPart(record))
          }
          continue
        }

        const text = blockText(block)
        const match = recorded.find(
          (candidate) =>
            candidate.kind === kind &&
            !consumed.has(candidate) &&
            text.startsWith(candidate.text)
        )
        const record = match ?? create(apiMessageId, kind)
        consumed.add(record)
        if (record.published && record.text === text) {
          // Re-delivery of an unchanged block: same part, nothing to emit. A
          // block reserved from the stream is not published yet even when the
          // deltas already carried its full text, so it still emits here.
          continue
        }
        record.text = text
        if (!record.published && text === "") {
          // A block that has never carried text yet — an interrupted thinking
          // block, or one whose content is withheld — would render as an empty
          // labelled box. It publishes if and when text actually arrives.
          continue
        }
        record.published = true
        changed.push(toPart(record))
      }

      return changed
    },

    applyToolResults(blocks) {
      const changed: Part[] = []
      for (const block of blocks) {
        if (block.type !== "tool_result" || !block.tool_use_id) continue
        const record = byToolUseId.get(block.tool_use_id)
        if (!record) continue
        record.status = block.is_error ? "failed" : "completed"
        record.output = stringifyToolOutput(block.content)
        record.published = true
        changed.push(toPart(record))
      }
      return changed
    },

    parts() {
      return ordered.map(toPart)
    },
  }
}

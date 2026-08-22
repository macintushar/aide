import { describe, expect, it } from "vitest"
import type { Part, ToolPart } from "@workspace/contracts"

import {
  createPartSynthesizer,
  stringifyToolOutput,
  toolIdentity,
} from "./parts"

const MESSAGE_ID = "turn-1-assistant"
const API_MESSAGE_ID = "msg_01"

function textOf(part: Part): string {
  return part.type === "text" || part.type === "reasoning" ? part.text : ""
}

function toolOf(part: Part): ToolPart {
  if (part.type !== "tool")
    throw new Error(`expected a tool part, got ${part.type}`)
  return part
}

describe("claude part synthesis: stable ids", () => {
  it("assigns each block a distinct part id and a monotonic index", () => {
    const synth = createPartSynthesizer(MESSAGE_ID)

    const parts = synth.applyAssistantMessage(API_MESSAGE_ID, [
      { type: "thinking", thinking: "considering" },
      { type: "text", text: "hello" },
    ])

    expect(parts.map((part) => part.id)).toEqual([
      `${MESSAGE_ID}-part-0`,
      `${MESSAGE_ID}-part-1`,
    ])
    expect(parts.map((part) => part.index)).toEqual([0, 1])
    expect(parts.map((part) => part.type)).toEqual(["reasoning", "text"])
    expect(parts.every((part) => part.messageId === MESSAGE_ID)).toBe(true)
  })

  it("keeps a re-delivered message on the parts it already produced", () => {
    const synth = createPartSynthesizer(MESSAGE_ID)
    const blocks = [{ type: "text", text: "hello" }]

    const first = synth.applyAssistantMessage(API_MESSAGE_ID, blocks)
    const second = synth.applyAssistantMessage(API_MESSAGE_ID, blocks)

    expect(first).toHaveLength(1)
    // Nothing changed, so nothing is re-emitted — and no duplicate part exists.
    expect(second).toHaveLength(0)
    expect(synth.parts()).toHaveLength(1)
  })

  it("appends rather than aliases when one message id arrives in segments", () => {
    const synth = createPartSynthesizer(MESSAGE_ID)

    synth.applyAssistantMessage(API_MESSAGE_ID, [
      { type: "text", text: "first" },
    ])
    const second = synth.applyAssistantMessage(API_MESSAGE_ID, [
      { type: "text", text: "second" },
    ])

    // Both segments carry a block at position 0; matching by position would
    // have overwritten the first part instead of adding a second.
    expect(second[0].id).toBe(`${MESSAGE_ID}-part-1`)
    expect(synth.parts().map(textOf)).toEqual(["first", "second"])
  })

  it("treats a longer redelivery of the same block as growth, not a new part", () => {
    const synth = createPartSynthesizer(MESSAGE_ID)

    synth.applyAssistantMessage(API_MESSAGE_ID, [{ type: "text", text: "par" }])
    const grown = synth.applyAssistantMessage(API_MESSAGE_ID, [
      { type: "text", text: "partial" },
    ])

    expect(grown).toHaveLength(1)
    expect(grown[0].id).toBe(`${MESSAGE_ID}-part-0`)
    expect(synth.parts()).toHaveLength(1)
    expect(textOf(synth.parts()[0])).toBe("partial")
  })

  it("keeps two identical texts in one delivery as two parts", () => {
    const synth = createPartSynthesizer(MESSAGE_ID)

    const parts = synth.applyAssistantMessage(API_MESSAGE_ID, [
      { type: "text", text: "same" },
      { type: "text", text: "same" },
    ])

    expect(parts.map((part) => part.id)).toEqual([
      `${MESSAGE_ID}-part-0`,
      `${MESSAGE_ID}-part-1`,
    ])
  })

  it("matches a tool block by its tool_use id across messages", () => {
    const synth = createPartSynthesizer(MESSAGE_ID)

    synth.applyAssistantMessage("msg_a", [
      {
        type: "tool_use",
        id: "toolu_1",
        name: "Bash",
        input: { command: "ls" },
      },
    ])
    const again = synth.applyAssistantMessage("msg_b", [
      {
        type: "tool_use",
        id: "toolu_1",
        name: "Bash",
        input: { command: "ls" },
      },
    ])

    expect(again).toHaveLength(0)
    expect(synth.parts()).toHaveLength(1)
  })
})

describe("claude part synthesis: streaming", () => {
  it("reserves a part on content_block_start so its deltas and its final block share an id", () => {
    const synth = createPartSynthesizer(MESSAGE_ID)

    synth.applyStreamEvent({
      type: "message_start",
      message: { id: API_MESSAGE_ID },
    })
    synth.applyStreamEvent({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    })
    const delta = synth.applyStreamEvent({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "streamed" },
    })
    const settled = synth.applyAssistantMessage(API_MESSAGE_ID, [
      { type: "text", text: "streamed" },
    ])

    expect(delta.delta).toEqual({
      partId: `${MESSAGE_ID}-part-0`,
      field: "text",
      text: "streamed",
    })
    // The completed block still publishes: the deltas were live-only.
    expect(settled).toHaveLength(1)
    expect(settled[0].id).toBe(delta.delta!.partId)
    expect(synth.parts()).toHaveLength(1)
  })

  it("maps thinking deltas to the reasoning field and tool input deltas to input", () => {
    const synth = createPartSynthesizer(MESSAGE_ID)
    synth.applyStreamEvent({
      type: "message_start",
      message: { id: API_MESSAGE_ID },
    })
    synth.applyStreamEvent({
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "" },
    })
    synth.applyStreamEvent({
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "toolu_1", name: "Read" },
    })

    const thinking = synth.applyStreamEvent({
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "hmm" },
    })
    const input = synth.applyStreamEvent({
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '{"file' },
    })

    expect(thinking.delta?.field).toBe("reasoning")
    expect(input.delta?.field).toBe("input")
  })

  it("does not publish a block that never carried any text", () => {
    const synth = createPartSynthesizer(MESSAGE_ID)

    // What an interrupted thinking block looks like: reserved, then delivered
    // empty because the content never arrived.
    const published = synth.applyAssistantMessage(API_MESSAGE_ID, [
      { type: "thinking", thinking: "" },
    ])

    expect(published).toHaveLength(0)
  })

  it("publishes a block the moment it does carry text", () => {
    const synth = createPartSynthesizer(MESSAGE_ID)

    synth.applyAssistantMessage(API_MESSAGE_ID, [{ type: "text", text: "" }])
    const published = synth.applyAssistantMessage(API_MESSAGE_ID, [
      { type: "text", text: "now it says something" },
    ])

    expect(published).toHaveLength(1)
    expect(textOf(published[0])).toBe("now it says something")
    // Still the one part it reserved, not a second one.
    expect(synth.parts()).toHaveLength(1)
  })

  it("ignores a delta for an index no block was started at", () => {
    const synth = createPartSynthesizer(MESSAGE_ID)

    const applied = synth.applyStreamEvent({
      type: "content_block_delta",
      index: 7,
      delta: { type: "text_delta", text: "orphan" },
    })

    expect(applied.delta).toBeUndefined()
    expect(synth.parts()).toHaveLength(0)
  })
})

describe("claude part synthesis: tool lifecycle", () => {
  it("walks one part from pending through running to completed", () => {
    const synth = createPartSynthesizer(MESSAGE_ID)
    synth.applyStreamEvent({
      type: "message_start",
      message: { id: API_MESSAGE_ID },
    })

    const started = synth.applyStreamEvent({
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_1", name: "Bash" },
    })
    const running = synth.applyAssistantMessage(API_MESSAGE_ID, [
      {
        type: "tool_use",
        id: "toolu_1",
        name: "Bash",
        input: { command: "ls" },
      },
    ])
    const done = synth.applyToolResults([
      { type: "tool_result", tool_use_id: "toolu_1", content: "a\nb" },
    ])

    expect(toolOf(started.parts[0]).status).toBe("pending")
    expect(toolOf(running[0]).status).toBe("running")
    expect(toolOf(running[0]).input).toEqual({ command: "ls" })
    expect(toolOf(done[0]).status).toBe("completed")
    expect(toolOf(done[0]).output).toBe("a\nb")
    // One tool, one part, three states.
    const ids = new Set(
      [started.parts[0], running[0], done[0]].map((part) => part.id)
    )
    expect(ids.size).toBe(1)
  })

  it("marks an errored tool result as failed", () => {
    const synth = createPartSynthesizer(MESSAGE_ID)
    synth.applyAssistantMessage(API_MESSAGE_ID, [
      { type: "tool_use", id: "toolu_1", name: "Bash", input: {} },
    ])

    const failed = synth.applyToolResults([
      {
        type: "tool_result",
        tool_use_id: "toolu_1",
        content: "exit 1",
        is_error: true,
      },
    ])

    expect(toolOf(failed[0]).status).toBe("failed")
    expect(toolOf(failed[0]).output).toBe("exit 1")
  })

  it("ignores a tool result for a tool it never saw", () => {
    const synth = createPartSynthesizer(MESSAGE_ID)

    expect(
      synth.applyToolResults([
        { type: "tool_result", tool_use_id: "unknown", content: "x" },
      ])
    ).toHaveLength(0)
  })
})

describe("claude tool identity", () => {
  it("categorizes builtin tools", () => {
    expect(toolIdentity("Bash").category).toBe("shell")
    expect(toolIdentity("Read").category).toBe("file_read")
    expect(toolIdentity("Write").category).toBe("file_write")
    expect(toolIdentity("Grep").category).toBe("search")
    expect(toolIdentity("WebFetch").category).toBe("web")
    expect(toolIdentity("Task").category).toBe("agent")
    expect(toolIdentity("SomethingNew").category).toBe("other")
  })

  it("reads the server name out of an MCP tool name", () => {
    expect(toolIdentity("mcp__linear__list_issues")).toEqual({
      category: "mcp",
      source: { kind: "mcp", server: "linear" },
    })
  })

  it("carries the MCP source onto the synthesized part", () => {
    const synth = createPartSynthesizer(MESSAGE_ID)
    const parts = synth.applyAssistantMessage(API_MESSAGE_ID, [
      { type: "tool_use", id: "toolu_1", name: "mcp__linear__list_issues" },
    ])

    expect(toolOf(parts[0]).source).toEqual({ kind: "mcp", server: "linear" })
    expect(toolOf(parts[0]).category).toBe("mcp")
  })
})

describe("claude tool output stringification", () => {
  it("passes strings through and flattens content blocks", () => {
    expect(stringifyToolOutput("plain")).toBe("plain")
    expect(
      stringifyToolOutput([
        { type: "text", text: "one" },
        { type: "text", text: "two" },
      ])
    ).toBe("one\ntwo")
  })

  it("renders an absent or structured payload without throwing", () => {
    expect(stringifyToolOutput(undefined)).toBe("")
    expect(stringifyToolOutput({ ok: true })).toBe('{"ok":true}')
  })
})

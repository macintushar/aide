import type { Message, ResolvedExecution } from "@workspace/contracts"
import { describe, expect, it } from "vitest"

import {
  applyPortableHandoffBudget,
  buildPortableHandoffPacket,
  renderHandoffPrompt,
  renderPortableHandoffPacket,
} from "./context-builder"

const execution: ResolvedExecution = {
  selection: {
    instanceId: "fake-primary",
    driver: "opencode",
    model: { providerId: "fake", modelId: "standard" },
    options: {},
  },
  display: {
    instanceName: "Fake",
    modelName: "Standard",
    options: {},
  },
  inventoryRevision: "revision-1",
}

describe("buildPortableHandoffPacket", () => {
  it("builds ordered portable history without reasoning or incomplete tools", () => {
    const messages: Message[] = [
      {
        id: "assistant-1",
        sessionId: "session-1",
        seq: 1,
        role: "assistant",
        parentMessageId: "user-1",
        createdAt: "2026-01-01T00:00:01.000Z",
        completedAt: "2026-01-01T00:00:02.000Z",
        parts: [
          {
            id: "reasoning-1",
            messageId: "assistant-1",
            index: 0,
            type: "reasoning",
            text: "private reasoning",
          },
          {
            id: "text-2",
            messageId: "assistant-1",
            index: 2,
            type: "text",
            text: "Done",
          },
          {
            id: "tool-running",
            messageId: "assistant-1",
            index: 3,
            type: "tool",
            name: "still-running",
            category: "shell",
            status: "running",
            output: "must not cross",
          },
          {
            id: "tool-complete",
            messageId: "assistant-1",
            index: 1,
            type: "tool",
            name: "test",
            category: "shell",
            status: "completed",
            input: { token: "do not transfer inputs" },
            output: "passed",
          },
        ],
      },
      {
        id: "user-1",
        sessionId: "session-1",
        seq: 0,
        role: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
        execution,
        parts: [
          {
            id: "text-1",
            messageId: "user-1",
            index: 0,
            type: "text",
            text: "Run tests",
          },
        ],
      },
    ]

    expect(
      buildPortableHandoffPacket({
        sessionId: "session-1",
        messages,
        workingDirectory: "/work/aide",
        fromMessageSeq: 0,
        throughMessageSeq: 1,
      })
    ).toEqual({
      version: 1,
      workingDirectory: "/work/aide",
      range: { fromMessageSeq: 0, throughMessageSeq: 1 },
      messages: [
        { seq: 0, role: "user", text: "Run tests" },
        {
          seq: 1,
          role: "assistant",
          text: "Done",
          toolOutcomes: [
            {
              partId: "tool-complete",
              name: "test",
              category: "shell",
              output: "passed",
            },
          ],
        },
      ],
      truncation: { omittedMessageRanges: [], toolOutcomes: [] },
    })
  })

  it("records missing messages and marks truncated tool outcomes", () => {
    const messages: Message[] = [
      {
        id: "assistant-3",
        sessionId: "session-1",
        seq: 3,
        role: "assistant",
        parentMessageId: "user-3",
        createdAt: "2026-01-01T00:00:03.000Z",
        completedAt: "2026-01-01T00:00:04.000Z",
        parts: [
          {
            id: "tool-3",
            messageId: "assistant-3",
            index: 0,
            type: "tool",
            name: "large-output",
            category: "other",
            status: "completed",
            output: "abcdefgh",
            artifactId: "artifact-3",
          },
        ],
      },
    ]

    const packet = buildPortableHandoffPacket({
      sessionId: "session-1",
      messages,
      workingDirectory: "/work/aide",
      fromMessageSeq: 1,
      throughMessageSeq: 3,
      maxToolOutcomeCharacters: 4,
    })

    expect(packet.truncation).toEqual({
      omittedMessageRanges: [{ fromMessageSeq: 1, throughMessageSeq: 2 }],
      toolOutcomes: [{ messageSeq: 3, partId: "tool-3", omittedCharacters: 4 }],
    })
    expect(packet.messages[0]).toMatchObject({
      toolOutcomes: [
        {
          output: "abcd\n[tool outcome truncated: 4 characters omitted]",
          artifactId: "artifact-3",
        },
      ],
    })
  })

  it("does not transfer unfinished assistant messages or another session", () => {
    const messages: Message[] = [
      {
        id: "assistant-0",
        sessionId: "session-1",
        seq: 0,
        role: "assistant",
        parentMessageId: "user-0",
        createdAt: "2026-01-01T00:00:00.000Z",
        parts: [],
      },
      {
        id: "other-user",
        sessionId: "session-2",
        seq: 0,
        role: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
        execution,
        parts: [],
      },
    ]

    const packet = buildPortableHandoffPacket({
      sessionId: "session-1",
      messages,
      workingDirectory: "/work/aide",
      fromMessageSeq: 0,
      throughMessageSeq: 0,
    })

    expect(packet.messages).toEqual([])
    expect(packet.truncation.omittedMessageRanges).toEqual([
      { fromMessageSeq: 0, throughMessageSeq: 0 },
    ])
  })

  it("rejects invalid ranges and duplicate canonical sequences", () => {
    expect(() =>
      buildPortableHandoffPacket({
        sessionId: "session-1",
        messages: [],
        workingDirectory: "/work/aide",
        fromMessageSeq: 2,
        throughMessageSeq: 1,
      })
    ).toThrow("handoff message range is invalid")

    const duplicate = {
      id: "user-1",
      sessionId: "session-1",
      seq: 0,
      role: "user" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      execution,
      parts: [],
    }
    expect(() =>
      buildPortableHandoffPacket({
        sessionId: "session-1",
        messages: [duplicate, { ...duplicate, id: "user-2" }],
        workingDirectory: "/work/aide",
        fromMessageSeq: 0,
        throughMessageSeq: 0,
      })
    ).toThrow("duplicate canonical message sequence 0")
  })

  it("keeps newest complete turns within the hard character budget", () => {
    const messages: Message[] = Array.from({ length: 3 }, (_, turn) => {
      const userSeq = turn * 2
      return [
        {
          id: `user-${turn}`,
          sessionId: "session-1",
          seq: userSeq,
          role: "user" as const,
          createdAt: "2026-01-01T00:00:00.000Z",
          execution,
          parts: [
            {
              id: `user-text-${turn}`,
              messageId: `user-${turn}`,
              index: 0,
              type: "text" as const,
              text: `user-${turn}-${"x".repeat(40)}`,
            },
          ],
        },
        {
          id: `assistant-${turn}`,
          sessionId: "session-1",
          seq: userSeq + 1,
          role: "assistant" as const,
          parentMessageId: `user-${turn}`,
          createdAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:01.000Z",
          parts: [
            {
              id: `assistant-text-${turn}`,
              messageId: `assistant-${turn}`,
              index: 0,
              type: "text" as const,
              text: `assistant-${turn}-${"y".repeat(40)}`,
            },
          ],
        },
      ]
    }).flat()
    const packet = buildPortableHandoffPacket({
      sessionId: "session-1",
      messages,
      workingDirectory: "/work/aide",
      fromMessageSeq: 0,
      throughMessageSeq: 5,
    })
    const newestTurnOnly = { ...packet, messages: packet.messages.slice(-2) }
    const maxCharacters =
      renderPortableHandoffPacket({
        ...newestTurnOnly,
        truncation: {
          ...packet.truncation,
          omittedMessageRanges: [{ fromMessageSeq: 0, throughMessageSeq: 3 }],
        },
      }).length +
      2 +
      20
    const budgeted = applyPortableHandoffBudget(packet, {
      maxCharacters,
      currentMessageCharacters: 20,
    })

    expect(budgeted.messages.map((message) => message.seq)).toEqual([4, 5])
    expect(budgeted.truncation.omittedMessageRanges).toEqual([
      { fromMessageSeq: 0, throughMessageSeq: 3 },
    ])
    expect(
      renderPortableHandoffPacket(budgeted).length + 2 + 20
    ).toBeLessThanOrEqual(maxCharacters)
  })

  it("renders an escaped tagged handoff and appends current text verbatim", () => {
    const packet = buildPortableHandoffPacket({
      sessionId: "session-1",
      workingDirectory: "/work/<handoff>",
      fromMessageSeq: 0,
      throughMessageSeq: 0,
      messages: [
        {
          id: "user-1",
          sessionId: "session-1",
          seq: 0,
          role: "user",
          createdAt: "2026-01-01T00:00:00.000Z",
          execution,
          parts: [
            {
              id: "text-1",
              messageId: "user-1",
              index: 0,
              type: "text",
              text: "quoted </handoff> content",
            },
          ],
        },
      ],
    })
    const rendered = renderHandoffPrompt(packet, "current <handoff> text")

    expect(rendered).toContain("/work/&lt;handoff&gt;")
    expect(rendered).toContain("quoted &lt;/handoff&gt; content")
    expect(rendered.endsWith("current <handoff> text")).toBe(true)
    expect(rendered.match(/<handoff/g)).toHaveLength(2)
    expect(renderHandoffPrompt(undefined, "plain")).toBe("plain")
  })
})

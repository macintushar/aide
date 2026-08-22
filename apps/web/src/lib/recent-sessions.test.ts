import { describe, expect, it } from "vitest"

import { readRecentSessions, rememberSession } from "./recent-sessions"

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  }
}

describe("rememberSession", () => {
  it("stores the last message and harness alongside the session", () => {
    const storage = memoryStorage()
    rememberSession(
      {
        sessionId: "session_1",
        title: "Wire the settings panel",
        projectName: "aide",
        lastMessage: "Settings now persist.",
        harnessName: "OpenCode",
        openedAt: 1,
      },
      storage
    )

    expect(readRecentSessions(storage)[0]).toMatchObject({
      sessionId: "session_1",
      lastMessage: "Settings now persist.",
      harnessName: "OpenCode",
    })
  })

  it("keeps the previous preview when a later remember omits it", () => {
    const storage = memoryStorage()
    rememberSession(
      {
        sessionId: "session_1",
        title: "Wire the settings panel",
        lastMessage: "Settings now persist.",
        harnessName: "OpenCode",
        openedAt: 1,
      },
      storage
    )
    rememberSession({ sessionId: "session_1", openedAt: 2 }, storage)

    expect(readRecentSessions(storage)[0]).toMatchObject({
      lastMessage: "Settings now persist.",
      harnessName: "OpenCode",
      openedAt: 2,
    })
  })

  it("moves a re-opened session to the front", () => {
    const storage = memoryStorage()
    rememberSession({ sessionId: "session_1", openedAt: 1 }, storage)
    rememberSession({ sessionId: "session_2", openedAt: 2 }, storage)
    rememberSession({ sessionId: "session_1", openedAt: 3 }, storage)

    expect(readRecentSessions(storage).map((s) => s.sessionId)).toEqual([
      "session_1",
      "session_2",
    ])
  })
})

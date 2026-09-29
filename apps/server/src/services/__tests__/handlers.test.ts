import { commandFixtures } from "@workspace/contracts"
import { describe, expect, it, vi } from "vitest"

import type { ExternalCommandContext } from "../../commands"
import type { AideDb } from "../../db"
import { createCoreCommandHandlers } from ".././handlers"
import type { ProjectService } from ".././project"
import type { TurnService } from ".././turn"

const context = {
  defer: vi.fn(),
  markDispatching: vi.fn(),
  markDispatched: vi.fn(),
  markUncertain: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
} as unknown as ExternalCommandContext

const db = {} as AideDb

function fixture(name: string) {
  const found = commandFixtures().find((command) => command.name === name)
  if (!found) throw new Error(`no fixture for ${name}`)
  return found
}

function localHandler(handler: unknown): {
  handle(command: unknown, db: AideDb): unknown
} {
  return handler as { handle(command: unknown, db: AideDb): unknown }
}

function externalHandler(handler: unknown): {
  handle(command: unknown, context: unknown): unknown
} {
  return handler as { handle(command: unknown, context: unknown): unknown }
}

describe("createCoreCommandHandlers", () => {
  it("maps local project and session commands to their services", async () => {
    const projects = {
      open: vi.fn().mockReturnValue({ id: "project" }),
      createSession: vi.fn().mockReturnValue({ id: "session" }),
      renameSession: vi.fn().mockReturnValue({ title: "Renamed" }),
      deleteSession: vi.fn().mockReturnValue({ deleted: true }),
    } as unknown as ProjectService
    const handlers = createCoreCommandHandlers({
      projects,
      turns: {} as TurnService,
    })

    await localHandler(handlers["project.open"]).handle(
      fixture("project.open"),
      db
    )
    await localHandler(handlers["session.create"]).handle(
      fixture("session.create"),
      db
    )
    await localHandler(handlers["session.rename"]).handle(
      fixture("session.rename"),
      db
    )
    await localHandler(handlers["session.delete"]).handle(
      fixture("session.delete"),
      db
    )

    expect(projects.open).toHaveBeenCalledWith(
      "/Users/tushar/projects/aide",
      "aide",
      db
    )
    expect(projects.createSession).toHaveBeenCalledWith(
      "proj_1",
      "New session",
      db
    )
    expect(projects.renameSession).toHaveBeenCalledWith("ses_1", "Renamed", db)
    expect(projects.deleteSession).toHaveBeenCalledWith("ses_1", db)
  })

  it("marks project and session commands as transactional, except create", () => {
    const handlers = createCoreCommandHandlers({
      projects: {} as ProjectService,
      turns: {} as TurnService,
    })

    expect(
      handlers["project.open"]?.kind === "local" &&
        handlers["project.open"].transactional
    ).toBe(true)
    // A worktree session runs git before it commits, so create cannot hold
    // the receipt transaction open.
    expect(
      handlers["session.create"]?.kind === "local" &&
        handlers["session.create"].transactional
    ).toBeFalsy()
    expect(
      handlers["session.rename"]?.kind === "local" &&
        handlers["session.rename"].transactional
    ).toBe(true)
    expect(
      handlers["session.delete"]?.kind === "local" &&
        handlers["session.delete"].transactional
    ).toBe(true)
  })

  it("maps fork, restore, worktree and steer commands to their services", async () => {
    const projects = {
      forkSession: vi.fn().mockResolvedValue({ id: "fork" }),
      removeWorktree: vi.fn().mockResolvedValue({ id: "ses_1" }),
      createWorktreeSession: vi.fn().mockResolvedValue({ id: "wt" }),
    } as unknown as ProjectService
    const turns = {
      restore: vi.fn().mockResolvedValue({ restored: [], removed: [] }),
      steer: vi.fn(),
    } as unknown as TurnService
    const handlers = createCoreCommandHandlers({ projects, turns })

    await localHandler(handlers["session.fork"]).handle(
      fixture("session.fork"),
      db
    )
    await localHandler(handlers["session.restore"]).handle(
      fixture("session.restore"),
      db
    )
    await localHandler(handlers["worktree.remove"]).handle(
      fixture("worktree.remove"),
      db
    )
    await localHandler(handlers["session.create"]).handle(
      { ...fixture("session.create"), worktree: { branch: "aide/x" } },
      db
    )
    await externalHandler(handlers["turn.steer"]).handle(
      fixture("turn.steer"),
      context
    )

    expect(projects.forkSession).toHaveBeenCalledWith({
      sessionId: "ses_1",
      throughTurnId: "turn_1",
      worktree: { branch: "aide/fork" },
    })
    expect(turns.restore).toHaveBeenCalledWith("ses_1", "turn_1")
    expect(projects.removeWorktree).toHaveBeenCalledWith("ses_1", false)
    expect(projects.createWorktreeSession).toHaveBeenCalledWith(
      "proj_1",
      { branch: "aide/x" },
      "New session"
    )
    expect(turns.steer).toHaveBeenCalledWith({
      ...fixture("turn.steer"),
      context,
    })
  })

  it("maps external turn and request commands and defers only turn submission", async () => {
    const turns = {
      submit: vi.fn(),
      interrupt: vi.fn(),
      respondToPermission: vi.fn(),
      respondToInput: vi.fn(),
    } as unknown as TurnService
    const handlers = createCoreCommandHandlers({
      projects: {} as ProjectService,
      turns,
    })

    await externalHandler(handlers["turn.send"]).handle(
      fixture("turn.send"),
      context
    )
    await externalHandler(handlers["turn.interrupt"]).handle(
      fixture("turn.interrupt"),
      context
    )
    await externalHandler(handlers["permission.respond"]).handle(
      fixture("permission.respond"),
      context
    )
    await externalHandler(handlers["input.respond"]).handle(
      fixture("input.respond"),
      context
    )

    expect(context.defer).toHaveBeenCalledOnce()
    expect(turns.submit).toHaveBeenCalledWith({
      ...fixture("turn.send"),
      context,
    })
    expect(turns.interrupt).toHaveBeenCalledWith("ses_1", "turn_1", context)
    expect(turns.respondToPermission).toHaveBeenCalledWith(
      "req_perm_1",
      { kind: "permission", optionId: "allow" },
      context
    )
    expect(turns.respondToInput).toHaveBeenCalledWith(
      "req_input_1",
      expect.objectContaining({ kind: "input" }),
      context
    )
  })

  it("leaves unsupported core command families unregistered", () => {
    const handlers = createCoreCommandHandlers({
      projects: {} as ProjectService,
      turns: {} as TurnService,
    })

    expect(handlers["project.updateDefaults"]).toBeUndefined()
    expect(handlers["inventory.refresh"]).toBeUndefined()
    expect(handlers["instance.start"]).toBeUndefined()
    expect(handlers["config.update"]).toBeUndefined()
    expect(handlers["mcp.reconnect"]).toBeUndefined()
  })
})

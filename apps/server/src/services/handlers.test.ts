import { commandFixtures } from "@workspace/contracts"
import { describe, expect, it, vi } from "vitest"

import type { ExternalCommandContext } from "../commands"
import type { AideDb } from "../db"
import { createCoreCommandHandlers } from "./handlers"
import type { ProjectService } from "./project"
import type { TurnService } from "./turn"

const context = {
  defer: vi.fn(),
  markDispatching: vi.fn(),
  markDispatched: vi.fn(),
  markUncertain: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
} as unknown as ExternalCommandContext

const db = {} as AideDb

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
    const commands = commandFixtures()

    await localHandler(handlers["project.open"]).handle(commands[0], db)
    await localHandler(handlers["session.create"]).handle(commands[2], db)
    await localHandler(handlers["session.rename"]).handle(commands[3], db)
    await localHandler(handlers["session.delete"]).handle(commands[4], db)

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

  it("marks project and session commands as transactional", () => {
    const handlers = createCoreCommandHandlers({
      projects: {} as ProjectService,
      turns: {} as TurnService,
    })

    expect(
      handlers["project.open"]?.kind === "local" &&
        handlers["project.open"].transactional
    ).toBe(true)
    expect(
      handlers["session.create"]?.kind === "local" &&
        handlers["session.create"].transactional
    ).toBe(true)
    expect(
      handlers["session.rename"]?.kind === "local" &&
        handlers["session.rename"].transactional
    ).toBe(true)
    expect(
      handlers["session.delete"]?.kind === "local" &&
        handlers["session.delete"].transactional
    ).toBe(true)
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
    const commands = commandFixtures()

    await externalHandler(handlers["turn.send"]).handle(commands[5], context)
    await externalHandler(handlers["turn.interrupt"]).handle(
      commands[6],
      context
    )
    await externalHandler(handlers["permission.respond"]).handle(
      commands[7],
      context
    )
    await externalHandler(handlers["input.respond"]).handle(
      commands[8],
      context
    )

    expect(context.defer).toHaveBeenCalledOnce()
    expect(turns.submit).toHaveBeenCalledWith({ ...commands[5], context })
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

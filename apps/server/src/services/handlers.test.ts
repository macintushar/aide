import { commandFixtures } from "@workspace/contracts"
import { describe, expect, it, vi } from "vitest"

import type { ExternalCommandContext } from "../commands"
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

    await handlers["project.open"]!.handle(commands[0] as never, context)
    await handlers["session.create"]!.handle(commands[2] as never, context)
    await handlers["session.rename"]!.handle(commands[3] as never, context)
    await handlers["session.delete"]!.handle(commands[4] as never, context)

    expect(projects.open).toHaveBeenCalledWith(
      "/Users/tushar/projects/aide",
      "aide"
    )
    expect(projects.createSession).toHaveBeenCalledWith("proj_1", "New session")
    expect(projects.renameSession).toHaveBeenCalledWith("ses_1", "Renamed")
    expect(projects.deleteSession).toHaveBeenCalledWith("ses_1")
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

    await handlers["turn.send"]!.handle(commands[5] as never, context)
    await handlers["turn.interrupt"]!.handle(commands[6] as never, context)
    await handlers["permission.respond"]!.handle(commands[7] as never, context)
    await handlers["input.respond"]!.handle(commands[8] as never, context)

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

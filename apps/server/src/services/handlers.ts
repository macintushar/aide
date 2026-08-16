import type { Command, CommandName } from "@workspace/contracts"

import type { CommandHandlerRegistry } from "../commands"
import type { ProjectService } from "./project"
import type { TurnService } from "./turn"

type CommandFor<Name extends CommandName> = Extract<Command, { name: Name }>

export type CoreCommandServices = {
  projects: ProjectService
  turns: TurnService
}

export function createCoreCommandHandlers(
  services: CoreCommandServices
): CommandHandlerRegistry {
  return {
    "project.open": {
      kind: "local",
      handle(command: CommandFor<"project.open">) {
        return services.projects.open(command.directory, command.projectName)
      },
    },
    "session.create": {
      kind: "local",
      handle(command: CommandFor<"session.create">) {
        return services.projects.createSession(command.projectId, command.title)
      },
    },
    "session.rename": {
      kind: "local",
      handle(command: CommandFor<"session.rename">) {
        return services.projects.renameSession(command.sessionId, command.title)
      },
    },
    "session.delete": {
      kind: "local",
      handle(command: CommandFor<"session.delete">) {
        return services.projects.deleteSession(command.sessionId)
      },
    },
    "turn.send": {
      kind: "external",
      async handle(command: CommandFor<"turn.send">, context) {
        context.defer()
        await services.turns.submit({ ...command, context })
      },
    },
    "turn.interrupt": {
      kind: "external",
      async handle(command: CommandFor<"turn.interrupt">, context) {
        await services.turns.interrupt(
          command.sessionId,
          command.turnId,
          context
        )
      },
    },
    "permission.respond": {
      kind: "external",
      async handle(command: CommandFor<"permission.respond">, context) {
        await services.turns.respondToPermission(
          command.requestId,
          command.resolution,
          context
        )
      },
    },
    "input.respond": {
      kind: "external",
      async handle(command: CommandFor<"input.respond">, context) {
        await services.turns.respondToInput(
          command.requestId,
          command.resolution,
          context
        )
      },
    },
  }
}

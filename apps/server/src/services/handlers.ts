import type { Command, CommandName } from "@workspace/contracts"

import type { CommandHandlerRegistry } from "../commands"
import type { ConfigService } from "../config"
import type { InventoryService } from "../inventory"
import type { InstanceSupervisor } from "../supervisor"
import type { AdapterRegistry } from "./adapter-registry"
import type { ProjectService } from "./project"
import type { TurnService } from "./turn"

type CommandFor<Name extends CommandName> = Extract<Command, { name: Name }>

export type CoreCommandServices = {
  projects: ProjectService
  turns: TurnService
  /** Wave 2 supervision services. Their commands are registered only when present. */
  config?: ConfigService
  supervisor?: InstanceSupervisor
  inventory?: InventoryService
  registry?: AdapterRegistry
}

export function createCoreCommandHandlers(
  services: CoreCommandServices
): CommandHandlerRegistry {
  return {
    ...createSupervisionHandlers(services),
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

/**
 * Configuration and supervision commands.
 *
 * All of these are local: they complete inside the server in one transaction or
 * one supervised call, so the dispatcher's `accepted -> completed` fast path
 * applies and no durable dispatch state is needed. Reaching a harness with an
 * uncertain outcome is what makes a command external, and none of these do.
 */
function createSupervisionHandlers(
  services: CoreCommandServices
): CommandHandlerRegistry {
  const handlers: CommandHandlerRegistry = {}

  const { config, supervisor, inventory, registry } = services

  if (config) {
    handlers["config.update"] = {
      kind: "local",
      async handle(command: CommandFor<"config.update">) {
        const effective = await config.update(command)
        // A malformed instance is reported, not thrown: it disables only itself.
        return {
          instances: Object.keys(effective.instances),
          failures: effective.failures.map((failure) => failure.error),
        }
      },
    }
  }

  if (supervisor) {
    handlers["instance.start"] = {
      kind: "local",
      async handle(command: CommandFor<"instance.start">) {
        await supervisor.start(command.instanceId)
        return { status: supervisor.status(command.instanceId) }
      },
    }
    handlers["instance.stop"] = {
      kind: "local",
      async handle(command: CommandFor<"instance.stop">) {
        await supervisor.stop(command.instanceId)
        return { status: supervisor.status(command.instanceId) }
      },
    }
    handlers["instance.restart"] = {
      kind: "local",
      async handle(command: CommandFor<"instance.restart">) {
        await supervisor.restart(command.instanceId)
        return { status: supervisor.status(command.instanceId) }
      },
    }
  }

  if (inventory && registry) {
    handlers["inventory.refresh"] = {
      kind: "local",
      async handle(command: CommandFor<"inventory.refresh">) {
        const entry = registry.get(command.instanceId)
        const scope = entry.adapter.capabilities(entry.handle).inventoryScope
        const result = await inventory.refresh(
          {
            instanceId: command.instanceId,
            scope,
            ...(command.directory ? { directory: command.directory } : {}),
          },
          () =>
            entry.adapter.discover({
              handle: entry.handle,
              ...(scope === "directory" && command.directory
                ? { directory: command.directory }
                : {}),
            })
        )
        return result
      },
    }
  }

  return handlers
}

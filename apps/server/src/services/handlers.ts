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
      transactional: true,
      handle(command: CommandFor<"project.open">, db) {
        return services.projects.open(
          command.directory,
          command.projectName,
          db
        )
      },
    },
    "session.create": {
      // Not transactional: a worktree session runs git before it commits.
      kind: "local",
      handle(command: CommandFor<"session.create">, db) {
        if (command.worktree) {
          return services.projects.createWorktreeSession(
            command.projectId,
            command.worktree,
            command.title
          )
        }
        return services.projects.createSession(
          command.projectId,
          command.title,
          db
        )
      },
    },
    "session.fork": {
      kind: "local",
      handle(command: CommandFor<"session.fork">) {
        return services.projects.forkSession({
          sessionId: command.sessionId,
          ...(command.throughTurnId
            ? { throughTurnId: command.throughTurnId }
            : {}),
          ...(command.title ? { title: command.title } : {}),
          ...(command.worktree ? { worktree: command.worktree } : {}),
        })
      },
    },
    "session.restore": {
      kind: "local",
      handle(command: CommandFor<"session.restore">) {
        return services.turns.restore(command.sessionId, command.turnId)
      },
    },
    "session.compact": {
      kind: "local",
      handle(command: CommandFor<"session.compact">) {
        return services.turns.compact(command.sessionId)
      },
    },
    "subagent.stop": {
      kind: "local",
      async handle(command: CommandFor<"subagent.stop">) {
        await services.turns.stopSubagent(command)
        return { taskId: command.taskId }
      },
    },
    "worktree.remove": {
      kind: "local",
      handle(command: CommandFor<"worktree.remove">) {
        return services.projects.removeWorktree(
          command.sessionId,
          command.deleteBranch ?? false
        )
      },
    },
    "session.rename": {
      kind: "local",
      transactional: true,
      handle(command: CommandFor<"session.rename">, db) {
        return services.projects.renameSession(
          command.sessionId,
          command.title,
          db
        )
      },
    },
    "session.delete": {
      kind: "local",
      transactional: true,
      handle(command: CommandFor<"session.delete">, db) {
        return services.projects.deleteSession(command.sessionId, db)
      },
    },
    "turn.send": {
      kind: "external",
      async handle(command: CommandFor<"turn.send">, context) {
        context.defer()
        await services.turns.submit({ ...command, context })
      },
    },
    "turn.steer": {
      kind: "external",
      async handle(command: CommandFor<"turn.steer">, context) {
        await services.turns.steer({ ...command, context })
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

  if (supervisor) {
    handlers["mcp.reconnect"] = {
      kind: "local",
      async handle(command: CommandFor<"mcp.reconnect">) {
        return {
          servers: await supervisor.reconnectMcp(
            command.instanceId,
            command.serverName
          ),
        }
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

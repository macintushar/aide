import {
  configDefaultsSchema,
  instancesMapSchema,
  mcpServerConfigSchema,
  type ConfigDefaults,
  type DriverId,
  type GlobalConfigRecord,
  type InstanceConfig,
  type McpServerConfig,
  type ProjectConfigRecord,
} from "@workspace/contracts"

/**
 * The editable shape behind the settings forms, and its validation.
 *
 * There are no configuration files to edit — not in the repository, not in
 * `~/.aide`. The UI is the only writer and submits validated `config.update`
 * commands, so validating here against the same contracts the server enforces
 * is what keeps a bad form from becoming a rejected command.
 */

export type ConfigDraft = {
  projectsDirectory: string
  instances: InstanceConfig[]
  mcpServers: Array<{ name: string; config: McpServerConfig }>
  defaults: ConfigDefaults
}

export const DRIVERS: Array<{ id: DriverId; label: string }> = [
  { id: "opencode", label: "OpenCode" },
  { id: "claudeAgent", label: "Claude" },
]

export function emptyDraft(): ConfigDraft {
  return {
    projectsDirectory: "",
    instances: [],
    mcpServers: [],
    defaults: {},
  }
}

export function configToDraft(
  config: GlobalConfigRecord | ProjectConfigRecord
): ConfigDraft {
  return {
    projectsDirectory: config.projectsDirectory ?? "",
    instances: Object.values(config.instances ?? {}),
    mcpServers: Object.entries(config.mcpServers ?? {}).map(
      ([name, value]) => ({
        name,
        config: value,
      })
    ),
    defaults: config.defaults ?? {},
  }
}

export function newInstance(index: number): InstanceConfig {
  return {
    instanceId: `instance-${index + 1}`,
    driver: "opencode",
    enabled: true,
    autoStart: true,
    config: {},
  }
}

export function newMcpServer(index: number): {
  name: string
  config: McpServerConfig
} {
  return {
    name: `server-${index + 1}`,
    config: { type: "stdio", command: "" },
  }
}

export type DraftIssue = {
  /** `instances.<id>`, `mcpServers.<name>`, `defaults`, or `projectsDirectory`. */
  readonly path: string
  readonly message: string
}

export type DraftValidation = {
  readonly issues: DraftIssue[]
  /** The `config` payload for a `config.update` command, when valid. */
  readonly payload?: {
    projectsDirectory?: string
    instances: Record<string, InstanceConfig>
    mcpServers: Record<string, McpServerConfig>
    defaults: ConfigDefaults
  }
}

/**
 * Validates the draft the way the server will. Duplicate names are checked here
 * because the wire format is a map: two rows with one name would silently
 * become one entry.
 */
export function validateDraft(draft: ConfigDraft): DraftValidation {
  const issues: DraftIssue[] = []

  const instances: Record<string, InstanceConfig> = {}
  const seenInstanceIds = new Set<string>()
  for (const instance of draft.instances) {
    const id = instance.instanceId.trim()
    if (!id) {
      issues.push({
        path: "instances",
        message: "Every instance needs an id.",
      })
      continue
    }
    if (seenInstanceIds.has(id)) {
      issues.push({
        path: `instances.${id}`,
        message: `Duplicate instance id "${id}". Instance ids must be unique.`,
      })
      continue
    }
    seenInstanceIds.add(id)
    // The map key must equal the entry's instanceId; building the map from the
    // id is what makes that true by construction.
    instances[id] = { ...instance, instanceId: id }
  }

  const instancesResult = instancesMapSchema.safeParse(instances)
  if (!instancesResult.success) {
    for (const issue of instancesResult.error.issues) {
      issues.push({
        path: `instances.${issue.path.join(".")}`,
        message: issue.message,
      })
    }
  }

  const mcpServers: Record<string, McpServerConfig> = {}
  const seenServerNames = new Set<string>()
  for (const server of draft.mcpServers) {
    const name = server.name.trim()
    if (!name) {
      issues.push({
        path: "mcpServers",
        message: "Every MCP server needs a name.",
      })
      continue
    }
    if (seenServerNames.has(name)) {
      issues.push({
        path: `mcpServers.${name}`,
        message: `Duplicate MCP server name "${name}".`,
      })
      continue
    }
    seenServerNames.add(name)

    const parsed = mcpServerConfigSchema.safeParse(server.config)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({
          path: `mcpServers.${name}`,
          message: issue.message,
        })
      }
      continue
    }
    mcpServers[name] = parsed.data
  }

  const defaultsResult = configDefaultsSchema.safeParse(
    stripEmpty(draft.defaults)
  )
  if (!defaultsResult.success) {
    for (const issue of defaultsResult.error.issues) {
      issues.push({ path: "defaults", message: issue.message })
    }
  }

  if (issues.length > 0) return { issues }

  const projectsDirectory = draft.projectsDirectory.trim()
  return {
    issues: [],
    payload: {
      ...(projectsDirectory ? { projectsDirectory } : {}),
      instances,
      mcpServers,
      defaults: defaultsResult.success ? defaultsResult.data : {},
    },
  }
}

/** Blank form fields mean "unset", not "empty string". */
function stripEmpty(defaults: ConfigDefaults): ConfigDefaults {
  const entries = Object.entries(defaults).filter(
    ([, value]) => value !== undefined && value !== ""
  )
  return Object.fromEntries(entries) as ConfigDefaults
}

export function issuesFor(
  validation: DraftValidation,
  pathPrefix: string
): DraftIssue[] {
  return validation.issues.filter(
    (issue) =>
      issue.path === pathPrefix || issue.path.startsWith(`${pathPrefix}.`)
  )
}

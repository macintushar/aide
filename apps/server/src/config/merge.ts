import {
  configDefaultsSchema,
  instanceConfigSchema,
  type AideConfig,
  type AideError,
  type ConfigDefaults,
  type InstanceConfig,
  type McpServerConfig,
  type ProjectConfigRecord,
} from "@workspace/contracts"

/**
 * Configuration merge and precedence.
 *
 * This is deliberately not a shallow object spread. Each key merges by its own
 * documented rule, and it lives in one place because every downstream track
 * would otherwise re-derive precedence differently.
 *
 * 1. Scalar top-level fields take the project value, then global, then the
 *    application default.
 * 2. `instances` merges by `instanceId`; a project entry replaces the matching
 *    global entry as a complete record. Omitted fields do not inherit.
 * 3. `defaults` merges by documented field, project winning. Unknown fields are
 *    rejected (the schema is strict).
 * 4. Top-level `mcpServers` merges additively by name, project winning.
 * 5. An instance's own `mcpServers` is overlaid at send time — see the mcp
 *    registry, which also applies Aide-provided toolsets last.
 *
 * Per-instance validation is isolated: a malformed instance disables only
 * itself and is reported, never thrown.
 */

export type InstanceValidationFailure = {
  readonly instanceId: string
  readonly error: AideError
}

export type EffectiveConfig = {
  readonly projectsDirectory?: string
  /** Instances that passed structural validation, keyed by instanceId. */
  readonly instances: Record<string, InstanceConfig>
  readonly mcpServers: Record<string, McpServerConfig>
  readonly defaults: ConfigDefaults
  /** Instances that failed validation and are therefore disabled. */
  readonly failures: InstanceValidationFailure[]
}

/**
 * Validates the driver-specific `config` blob against the owning adapter's
 * `configSchema`. Returns an error to disable that instance alone.
 *
 * This is where per-instance isolation actually earns its keep. The record
 * schemas validate `instances` as a whole, so anything stored is structurally
 * sound; `config` is `unknown` to contracts by design and is only meaningful to
 * one adapter, which makes it the realistic source of a malformed instance.
 */
export type DriverConfigValidator = (
  instance: InstanceConfig
) => AideError | undefined

export type MergeInput = {
  global: AideConfig
  project?: ProjectConfigRecord
  validateDriverConfig?: DriverConfigValidator
}

function instanceValidationError(
  instanceId: string,
  message: string,
  detail?: unknown
): AideError {
  return {
    code: "invalid_instance_config",
    message,
    instanceId,
    retryable: false,
    ...(detail === undefined ? {} : { detail }),
  }
}

/**
 * Rule 2 in isolation: validate one candidate entry. The map key must equal the
 * entry's `instanceId` — requiring both keeps the serialized identity explicit
 * while preventing two competing identifiers.
 */
function validateInstance(
  key: string,
  candidate: unknown
): { ok: true; instance: InstanceConfig } | { ok: false; error: AideError } {
  const parsed = instanceConfigSchema.safeParse(candidate)
  if (!parsed.success) {
    return {
      ok: false,
      error: instanceValidationError(
        key,
        `instance "${key}" failed structural validation`,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      ),
    }
  }
  if (parsed.data.instanceId !== key) {
    return {
      ok: false,
      error: instanceValidationError(
        key,
        `instances map key "${key}" must equal instanceId "${parsed.data.instanceId}"`,
        { key, instanceId: parsed.data.instanceId }
      ),
    }
  }
  return { ok: true, instance: parsed.data }
}

/** Rule 3: merge by documented field, rejecting unknown fields. */
function mergeDefaults(
  global: ConfigDefaults | undefined,
  project: ConfigDefaults | undefined
): { defaults: ConfigDefaults; error?: AideError } {
  const merged: Record<string, unknown> = { ...global }
  for (const [key, value] of Object.entries(project ?? {})) {
    if (value !== undefined) merged[key] = value
  }

  const parsed = configDefaultsSchema.safeParse(merged)
  if (!parsed.success) {
    return {
      defaults: {},
      error: {
        code: "invalid_config_defaults",
        message: "merged defaults contain unknown or invalid fields",
        retryable: false,
        detail: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    }
  }
  return { defaults: parsed.data }
}

export class ConfigMergeError extends Error {
  readonly aideError: AideError

  constructor(aideError: AideError) {
    super(aideError.message)
    this.name = "ConfigMergeError"
    this.aideError = aideError
  }
}

/**
 * Assembles the effective configuration. Deterministic: the same records always
 * produce the same result, which is what lets a recompute after `config.update`
 * be compared against boot.
 *
 * Path, tilde, and environment resolution deliberately does NOT happen here —
 * see `resolveConfigPaths`, applied only after assembly.
 */
export function mergeConfig(input: MergeInput): EffectiveConfig {
  const { global, project, validateDriverConfig } = input
  const failures: InstanceValidationFailure[] = []

  // Rule 1: scalar top-level fields.
  const projectsDirectory =
    project?.projectsDirectory ?? global.projectsDirectory

  // Rule 2: instances by instanceId, project replacing the whole record.
  const candidates = new Map<string, unknown>()
  for (const [key, value] of Object.entries(global.instances ?? {})) {
    candidates.set(key, value)
  }
  for (const [key, value] of Object.entries(project?.instances ?? {})) {
    candidates.set(key, value)
  }

  const instances: Record<string, InstanceConfig> = {}
  for (const key of [...candidates.keys()].sort()) {
    const result = validateInstance(key, candidates.get(key))
    if (!result.ok) {
      failures.push({ instanceId: key, error: result.error })
      continue
    }
    // Driver defaults and driver-specific validation apply only after the
    // winning entry has passed structural validation.
    const driverError = validateDriverConfig?.(result.instance)
    if (driverError) {
      failures.push({ instanceId: key, error: driverError })
      continue
    }
    instances[key] = result.instance
  }

  // Rule 3: defaults by documented field.
  const defaultsResult = mergeDefaults(global.defaults, project?.defaults)
  if (defaultsResult.error) {
    throw new ConfigMergeError(defaultsResult.error)
  }

  // Rule 4: top-level mcpServers additively by name, project winning.
  const mcpServers: Record<string, McpServerConfig> = {
    ...global.mcpServers,
    ...project?.mcpServers,
  }

  return {
    ...(projectsDirectory === undefined ? {} : { projectsDirectory }),
    instances,
    mcpServers,
    defaults: defaultsResult.defaults,
    failures,
  }
}

/** The application default used when neither project nor global supplies one. */
export const DEFAULT_PROJECTS_DIRECTORY = "~/projects"

export function emptyGlobalConfig(): AideConfig {
  return { instances: {}, mcpServers: {}, defaults: {} }
}

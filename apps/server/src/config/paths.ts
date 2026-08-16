import { isAbsolute, resolve, sep } from "node:path"

import type { McpServerConfig } from "@workspace/contracts"

import type { EffectiveConfig } from "./merge"

/**
 * Deferred resolution.
 *
 * Paths, tildes, environment references, and relative command paths resolve
 * only *after* the effective configuration has been assembled. Doing it during
 * the merge would bake one layer's environment into a value another layer was
 * about to replace, and would make a recompute after `config.update` disagree
 * with boot.
 *
 * Everything here is a pure function of (assembled config, environment), so
 * recomputing always reproduces the boot result for the same inputs.
 */

export type ResolutionEnvironment = {
  /** Home directory used to expand a leading `~`. */
  homeDirectory: string
  /** Variables available to `${VAR}` / `$VAR` references. */
  variables: Record<string, string | undefined>
  /** Base directory relative command paths resolve against. */
  baseDirectory: string
}

const ENV_REFERENCE =
  /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g

/** Expands `${VAR}` and `$VAR`. An undefined variable resolves to an empty string. */
export function expandEnvironment(
  value: string,
  variables: Record<string, string | undefined>
): string {
  return value.replace(ENV_REFERENCE, (_match, braced, bare) => {
    const name = (braced ?? bare) as string
    return variables[name] ?? ""
  })
}

/** Expands a leading `~` or `~/`. A `~user` form is left untouched. */
export function expandTilde(value: string, homeDirectory: string): string {
  if (value === "~") return homeDirectory
  if (value.startsWith(`~${sep}`) || value.startsWith("~/")) {
    return resolve(homeDirectory, value.slice(2))
  }
  return value
}

function resolvePathValue(
  value: string,
  environment: ResolutionEnvironment
): string {
  return expandTilde(
    expandEnvironment(value, environment.variables),
    environment.homeDirectory
  )
}

/**
 * A bare command name (`node`, `uvx`) is left alone so the OS resolves it on
 * PATH. Anything that looks like a path — contains a separator, or starts with
 * `.` or `~` — is made absolute against the base directory.
 */
export function resolveCommandPath(
  command: string,
  environment: ResolutionEnvironment
): string {
  const expanded = resolvePathValue(command, environment)
  if (isAbsolute(expanded)) return expanded
  const looksLikePath =
    expanded.includes("/") || expanded.includes(sep) || expanded.startsWith(".")
  if (!looksLikePath) return expanded
  return resolve(environment.baseDirectory, expanded)
}

function resolveValues(
  values: Record<string, string> | undefined,
  environment: ResolutionEnvironment
): Record<string, string> | undefined {
  if (!values) return undefined
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      expandEnvironment(value, environment.variables),
    ])
  )
}

export function resolveMcpServer(
  config: McpServerConfig,
  environment: ResolutionEnvironment
): McpServerConfig {
  switch (config.type) {
    case "stdio":
      return {
        ...config,
        command: resolveCommandPath(config.command, environment),
        ...(config.args
          ? {
              args: config.args.map((arg) =>
                expandEnvironment(arg, environment.variables)
              ),
            }
          : {}),
        ...(config.env ? { env: resolveValues(config.env, environment) } : {}),
      }
    case "http":
    case "sse":
      return {
        ...config,
        url: expandEnvironment(config.url, environment.variables),
        ...(config.headers
          ? { headers: resolveValues(config.headers, environment) }
          : {}),
      }
    case "aide":
      return { ...config }
  }
}

function resolveMcpServers(
  servers: Record<string, McpServerConfig>,
  environment: ResolutionEnvironment
): Record<string, McpServerConfig> {
  return Object.fromEntries(
    Object.entries(servers).map(([name, config]) => [
      name,
      resolveMcpServer(config, environment),
    ])
  )
}

/**
 * Applies deferred resolution to an assembled configuration.
 *
 * Instance `config` is driver-specific and opaque to everything except that
 * driver's adapter, so it is passed through untouched — the adapter resolves
 * its own paths when it validates against its `configSchema`.
 */
export function resolveConfigPaths(
  config: EffectiveConfig,
  environment: ResolutionEnvironment
): EffectiveConfig {
  return {
    ...config,
    ...(config.projectsDirectory === undefined
      ? {}
      : {
          projectsDirectory: resolvePathValue(
            config.projectsDirectory,
            environment
          ),
        }),
    mcpServers: resolveMcpServers(config.mcpServers, environment),
    instances: Object.fromEntries(
      Object.entries(config.instances).map(([id, instance]) => [
        id,
        instance.mcpServers
          ? {
              ...instance,
              mcpServers: resolveMcpServers(instance.mcpServers, environment),
            }
          : instance,
      ])
    ),
  }
}

export function defaultResolutionEnvironment(
  overrides: Partial<ResolutionEnvironment> = {}
): ResolutionEnvironment {
  return {
    homeDirectory:
      overrides.homeDirectory ??
      process.env.HOME ??
      process.env.USERPROFILE ??
      "/",
    variables: overrides.variables ?? process.env,
    baseDirectory: overrides.baseDirectory ?? process.cwd(),
  }
}

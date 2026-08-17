export { createDriverConfigValidator } from "./driver-config"
export {
  ConfigMergeError,
  DEFAULT_PROJECTS_DIRECTORY,
  emptyGlobalConfig,
  mergeConfig,
  type DriverConfigValidator,
  type EffectiveConfig,
  type InstanceValidationFailure,
  type MergeInput,
} from "./merge"
export {
  defaultResolutionEnvironment,
  expandEnvironment,
  expandTilde,
  resolveCommandPath,
  resolveConfigPaths,
  resolveMcpServer,
  type ResolutionEnvironment,
} from "./paths"
export { createConfigRouter } from "./router"
export {
  ConfigService,
  type ConfigChangeListener,
  type ConfigServiceOptions,
  type ConfigTargetInput,
} from "./service"

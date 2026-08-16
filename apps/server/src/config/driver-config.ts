import type { StandardSchemaV1 } from "@standard-schema/spec"
import type { AideError, DriverId } from "@workspace/contracts"

import type { DriverConfigValidator } from "./merge"

/**
 * Builds the driver-config validator from the adapters the server knows about.
 *
 * Each adapter exports a runtime schema for its own `config` and validates it
 * at load; this walks that schema without the config service ever learning what
 * a driver's configuration looks like.
 */
export function createDriverConfigValidator(
  schemaFor: (driver: DriverId) => StandardSchemaV1 | undefined
): DriverConfigValidator {
  return (instance) => {
    const schema = schemaFor(instance.driver)
    if (!schema) {
      return {
        code: "driver_unavailable",
        message: `No adapter is registered for driver "${instance.driver}"`,
        instanceId: instance.instanceId,
        retryable: false,
      }
    }

    const result = schema["~standard"].validate(instance.config)
    if (result instanceof Promise) {
      // Every adapter schema in Aide is synchronous. An async one would make
      // boot-time validation await, which the merge deliberately is not.
      return {
        code: "invalid_instance_config",
        message: `Adapter for driver "${instance.driver}" uses an async config schema, which is not supported`,
        instanceId: instance.instanceId,
        retryable: false,
      }
    }

    if (result.issues) {
      return {
        code: "invalid_instance_config",
        message: `instance "${instance.instanceId}" has invalid ${instance.driver} configuration`,
        instanceId: instance.instanceId,
        retryable: false,
        detail: result.issues.map((issue) => ({
          path: (issue.path ?? [])
            .map((segment) =>
              typeof segment === "object"
                ? String(segment.key)
                : String(segment)
            )
            .join("."),
          message: issue.message,
        })),
      } satisfies AideError
    }

    return undefined
  }
}

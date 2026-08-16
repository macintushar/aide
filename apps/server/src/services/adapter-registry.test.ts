import { createFakeHarnessAdapter } from "../harness/fake"
import { describe, expect, it } from "vitest"

import { AdapterRegistry } from "./adapter-registry"

function instance(instanceId: string, driver: "opencode" | "claudeAgent") {
  return {
    instanceId,
    driver,
    displayName: instanceId,
    enabled: true,
    autoStart: true,
    config: {},
  } as const
}

async function entry(
  instanceId = "primary",
  driver: "opencode" | "claudeAgent" = "opencode"
) {
  const { adapter } = createFakeHarnessAdapter({ driver })
  const configured = instance(instanceId, driver)
  const handle = await adapter.start({ instance: configured })
  return { adapter, handle, instance: configured }
}

describe("AdapterRegistry", () => {
  it("registers, retrieves, lists, and unregisters instances by driver", async () => {
    const registry = new AdapterRegistry()
    const primary = await entry("primary", "opencode")
    const secondary = await entry("secondary", "claudeAgent")

    registry.register(primary)
    registry.register(secondary)

    expect(registry.get("primary")).toBe(primary)
    expect(registry.get("primary", "opencode")).toBe(primary)
    expect(registry.list()).toEqual([primary, secondary])
    expect(registry.list("claudeAgent")).toEqual([secondary])
    expect(new AdapterRegistry().list("opencode")).toEqual([])

    registry.unregister("primary")
    registry.unregister("missing")
    expect(registry.list("opencode")).toEqual([])
    expect(() => registry.get("primary")).toThrowError(
      expect.objectContaining({
        aideError: {
          code: "adapter_instance_unavailable",
          message: "Started adapter instance primary is unavailable",
          retryable: true,
        },
      })
    )
  })

  it("rejects duplicate instance IDs without corrupting driver indexes", async () => {
    const registry = new AdapterRegistry()
    const original = await entry("shared", "opencode")
    const duplicate = await entry("shared", "claudeAgent")
    registry.register(original)

    expect(() => registry.register(duplicate)).toThrowError(
      expect.objectContaining({
        aideError: expect.objectContaining({
          code: "adapter_instance_already_registered",
        }),
      })
    )
    expect(registry.get("shared")).toBe(original)
    expect(registry.list("opencode")).toEqual([original])
    expect(registry.list("claudeAgent")).toEqual([])
  })

  it("rejects inconsistent registrations and driver-constrained lookups", async () => {
    const registry = new AdapterRegistry()
    const valid = await entry()

    expect(() =>
      registry.register({
        ...valid,
        handle: { ...valid.handle, instanceId: "other" },
      })
    ).toThrowError(
      expect.objectContaining({
        aideError: expect.objectContaining({
          code: "adapter_registration_mismatch",
        }),
      })
    )

    registry.register(valid)
    expect(() => registry.get("primary", "claudeAgent")).toThrowError(
      expect.objectContaining({
        aideError: expect.objectContaining({
          code: "adapter_instance_unavailable",
        }),
      })
    )
  })
})

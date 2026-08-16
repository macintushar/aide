import type { DriverId, InstanceConfig } from "@workspace/contracts"

import type { HarnessAdapter, InstanceHandle } from "../harness/types"
import { CoreServiceError } from "./errors"

export type RegisteredAdapter = {
  readonly adapter: HarnessAdapter
  readonly handle: InstanceHandle
  readonly instance: InstanceConfig
}

export class AdapterRegistry {
  readonly #instances = new Map<string, RegisteredAdapter>()
  readonly #drivers = new Map<DriverId, Set<string>>()

  register(entry: RegisteredAdapter): void {
    if (
      entry.adapter.driver !== entry.handle.driver ||
      entry.instance.driver !== entry.handle.driver ||
      entry.instance.instanceId !== entry.handle.instanceId
    ) {
      throw new CoreServiceError(
        "adapter_registration_mismatch",
        `Adapter registration for ${entry.handle.instanceId} has inconsistent identity`
      )
    }
    this.#instances.set(entry.handle.instanceId, entry)
    const instances =
      this.#drivers.get(entry.handle.driver) ?? new Set<string>()
    instances.add(entry.handle.instanceId)
    this.#drivers.set(entry.handle.driver, instances)
  }

  get(instanceId: string, driver?: DriverId): RegisteredAdapter {
    const entry = this.#instances.get(instanceId)
    if (!entry || (driver !== undefined && entry.handle.driver !== driver)) {
      throw new CoreServiceError(
        "adapter_instance_unavailable",
        `Started adapter instance ${instanceId} is unavailable`,
        true
      )
    }
    return entry
  }

  list(driver?: DriverId): RegisteredAdapter[] {
    const ids = driver ? this.#drivers.get(driver) : this.#instances.keys()
    return [...(ids ?? [])]
      .map((id) => this.#instances.get(id)!)
      .filter(Boolean)
  }

  unregister(instanceId: string): void {
    const entry = this.#instances.get(instanceId)
    if (!entry) return
    this.#instances.delete(instanceId)
    this.#drivers.get(entry.handle.driver)?.delete(instanceId)
  }
}

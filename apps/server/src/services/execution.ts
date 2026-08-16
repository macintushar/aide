import type {
  ExecutionSelection,
  HarnessInventory,
  ResolvedExecution,
} from "@workspace/contracts"

import type { AideDb } from "../db"
import { inventoryCacheRepo } from "../db"
import { AdapterRegistry } from "./adapter-registry"
import { CoreServiceError } from "./errors"

export class ExecutionResolver {
  readonly #db: AideDb
  readonly #registry: AdapterRegistry

  constructor(db: AideDb, registry: AdapterRegistry) {
    this.#db = db
    this.#registry = registry
  }

  async discover(
    instanceId: string,
    directory: string
  ): Promise<HarnessInventory> {
    const entry = this.#registry.get(instanceId)
    const inventory = await entry.adapter.discover({
      handle: entry.handle,
      directory,
    })
    if (
      inventory.instanceId !== instanceId ||
      inventory.driver !== entry.handle.driver
    ) {
      throw new CoreServiceError(
        "invalid_inventory_identity",
        `Inventory returned inconsistent identity for ${instanceId}`
      )
    }
    return inventoryCacheRepo.put(this.#db, directory, inventory)
  }

  async resolve(
    selection: ExecutionSelection,
    directory: string
  ): Promise<ResolvedExecution> {
    const entry = this.#registry.get(selection.instanceId, selection.driver)
    const inventory = await this.discover(selection.instanceId, directory)
    if (inventory.stale) {
      throw new CoreServiceError(
        "inventory_stale",
        "Execution inventory is stale",
        true
      )
    }

    const model = inventory.models.find(
      (candidate) =>
        candidate.modelId === selection.model.modelId &&
        candidate.providerId === selection.model.providerId
    )
    if (!model) {
      throw new CoreServiceError(
        "model_unavailable",
        `Model ${selection.model.modelId} is unavailable on ${selection.instanceId}`
      )
    }

    const agent = selection.agent
      ? inventory.agents.find((candidate) => candidate.id === selection.agent)
      : undefined
    if (selection.agent && !agent) {
      throw new CoreServiceError(
        "agent_unavailable",
        `Agent ${selection.agent} is unavailable`
      )
    }
    if (
      selection.agent &&
      model.supportedAgents &&
      !model.supportedAgents.includes(selection.agent)
    ) {
      throw new CoreServiceError(
        "agent_unsupported",
        `Agent ${selection.agent} does not support model ${model.modelId}`
      )
    }

    const mode = selection.interactionMode
      ? inventory.interactionModes.find(
          (candidate) => candidate.id === selection.interactionMode
        )
      : undefined
    if (selection.interactionMode && !mode) {
      throw new CoreServiceError(
        "interaction_mode_unavailable",
        `Interaction mode ${selection.interactionMode} is unavailable`
      )
    }

    const descriptors = new Map(
      model.optionDescriptors.map((item) => [item.id, item])
    )
    const displayOptions: ResolvedExecution["display"]["options"] = {}
    for (const [key, value] of Object.entries(selection.options)) {
      const descriptor = descriptors.get(key)
      const option = descriptor?.options.find(
        (candidate) => candidate.id === value
      )
      if (!descriptor || !option) {
        throw new CoreServiceError(
          "execution_option_unavailable",
          `Option ${key}=${value} is unavailable for model ${model.modelId}`
        )
      }
      displayOptions[key] = {
        label: descriptor.label,
        valueLabel: option.label,
      }
    }
    for (const descriptor of model.optionDescriptors) {
      if (
        !(descriptor.id in selection.options) &&
        descriptor.defaultValue === undefined
      )
        continue
      if (descriptor.id in selection.options) continue
      const option = descriptor.options.find(
        (candidate) => candidate.id === descriptor.defaultValue
      )
      if (!option) continue
      selection = {
        ...selection,
        options: { ...selection.options, [descriptor.id]: option.id },
      }
      displayOptions[descriptor.id] = {
        label: descriptor.label,
        valueLabel: option.label,
      }
    }

    return {
      selection: structuredClone(selection),
      display: {
        instanceName: entry.instance.displayName ?? selection.instanceId,
        modelName: model.displayName,
        ...(agent ? { agentName: agent.label } : {}),
        ...(mode ? { interactionModeName: mode.label } : {}),
        options: displayOptions,
      },
      inventoryRevision: inventory.revision,
    }
  }
}

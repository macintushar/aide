import type {
  ConfigDefaults,
  ExecutionSelection,
  HarnessInventory,
  HarnessModel,
  InstanceSnapshotEntry,
  OptionDescriptor,
} from "@workspace/contracts"

import { sendBlockedReason } from "@/features/instances/instances-store"

/**
 * Composer selection rules, kept pure and away from the popover so the
 * precedence in PLAN.md's "User Experience" section is testable on its own.
 *
 * Nothing here invents a value: every instance, model, agent, mode, and option
 * comes from adapter-reported inventory or from configuration.
 */
export type PickableInstance = {
  entry: InstanceSnapshotEntry
  inventory: HarnessInventory
  models: HarnessModel[]
  /** Set when this instance cannot take a turn; the picker shows it inert. */
  blockedReason?: string
}

export function pickableInstances(
  entries: InstanceSnapshotEntry[]
): PickableInstance[] {
  return entries.flatMap((entry) => {
    if (!entry.inventory) return []
    return [
      {
        entry,
        inventory: entry.inventory,
        models: entry.inventory.models,
        blockedReason: sendBlockedReason(entry),
      },
    ]
  })
}

export function findInstance(
  instances: PickableInstance[],
  instanceId: string | undefined
): PickableInstance | undefined {
  return instances.find(
    (candidate) => candidate.entry.instanceId === instanceId
  )
}

export function findModel(
  instance: PickableInstance | undefined,
  model: ExecutionSelection["model"] | undefined
): HarnessModel | undefined {
  if (!instance || !model) return undefined
  return instance.models.find(
    (candidate) =>
      candidate.modelId === model.modelId &&
      (candidate.providerId ?? undefined) === (model.providerId ?? undefined)
  )
}

function defaultModel(instance: PickableInstance): HarnessModel | undefined {
  return instance.models.find((model) => model.isDefault) ?? instance.models[0]
}

function defaultOptions(model: HarnessModel): Record<string, string> {
  const options: Record<string, string> = {}
  for (const descriptor of model.optionDescriptors) {
    const value = defaultOptionValue(descriptor)
    if (value !== undefined) options[descriptor.id] = value
  }
  return options
}

function defaultOptionValue(descriptor: OptionDescriptor): string | undefined {
  if (
    descriptor.defaultValue !== undefined &&
    descriptor.options.some((option) => option.id === descriptor.defaultValue)
  ) {
    return descriptor.defaultValue
  }
  const preferred =
    descriptor.options.find((option) => option.isDefault) ??
    descriptor.options[0]
  return preferred?.id
}

function defaultAgent(
  instance: PickableInstance,
  model: HarnessModel
): string | undefined {
  if (!instance.inventory.capabilities.agentSelection) return undefined
  const allowed = agentsFor(instance, model)
  return (allowed.find((agent) => agent.isDefault) ?? allowed[0])?.id
}

export function agentsFor(instance: PickableInstance, model: HarnessModel) {
  const supported = model.supportedAgents
  if (!supported) return instance.inventory.agents
  return instance.inventory.agents.filter((agent) =>
    supported.includes(agent.id)
  )
}

export function interactionModesFor(instance: PickableInstance) {
  return instance.inventory.interactionModes.length > 0
    ? instance.inventory.interactionModes
    : instance.inventory.capabilities.interactionModes
}

function defaultInteractionMode(
  instance: PickableInstance
): string | undefined {
  const modes = interactionModesFor(instance)
  return (modes.find((mode) => mode.isDefault) ?? modes[0])?.id
}

/** The harness's own defaults — precedence level 5. */
export function harnessDefaultSelection(
  instance: PickableInstance,
  model = defaultModel(instance)
): ExecutionSelection | undefined {
  if (!model) return undefined
  return {
    instanceId: instance.entry.instanceId,
    driver: instance.entry.driver,
    model: modelRef(model),
    agent: defaultAgent(instance, model),
    interactionMode: defaultInteractionMode(instance),
    options: defaultOptions(model),
  }
}

export function modelRef(model: HarnessModel): ExecutionSelection["model"] {
  return model.providerId
    ? { providerId: model.providerId, modelId: model.modelId }
    : { modelId: model.modelId }
}

/**
 * Levels 2–5 of the precedence list. Level 1, the live composer selection,
 * belongs to the composer's own state and is applied by the caller.
 */
export function resolveInitialSelection({
  instances,
  lastSent,
  projectDefaults,
  userDefaults,
}: {
  instances: PickableInstance[]
  lastSent?: ExecutionSelection
  projectDefaults?: ConfigDefaults
  userDefaults?: ConfigDefaults
}): ExecutionSelection | undefined {
  const candidates: (ExecutionSelection | ConfigDefaults | undefined)[] = [
    lastSent,
    projectDefaults,
    userDefaults,
  ]

  for (const candidate of candidates) {
    const selection = selectionFromCandidate(instances, candidate)
    if (selection) return selection
  }

  const sendable =
    instances.find((instance) => !instance.blockedReason) ?? instances[0]
  return sendable ? harnessDefaultSelection(sendable) : undefined
}

function selectionFromCandidate(
  instances: PickableInstance[],
  candidate: ExecutionSelection | ConfigDefaults | undefined
): ExecutionSelection | undefined {
  if (!candidate?.instanceId) return undefined
  const instance = findInstance(instances, candidate.instanceId)
  if (!instance) return undefined

  const model = findModel(instance, candidate.model) ?? defaultModel(instance)
  if (!model) return undefined

  const base = harnessDefaultSelection(instance, model)
  if (!base) return undefined

  return {
    ...base,
    agent: keepValidAgent(instance, model, candidate.agent) ?? base.agent,
    interactionMode:
      keepValidInteractionMode(instance, candidate.interactionMode) ??
      base.interactionMode,
    options: mergeOptions(model, candidate.options),
  }
}

/**
 * Switching model clears options the new model does not accept and falls back
 * to its defaults, while a still-valid agent or mode survives the change.
 */
export function selectModel(
  current: ExecutionSelection | undefined,
  instance: PickableInstance,
  model: HarnessModel
): ExecutionSelection | undefined {
  const base = harnessDefaultSelection(instance, model)
  if (!base) return undefined
  if (!current) return base

  const sameInstance = current.instanceId === instance.entry.instanceId

  return {
    ...base,
    agent: sameInstance
      ? (keepValidAgent(instance, model, current.agent) ?? base.agent)
      : base.agent,
    interactionMode: sameInstance
      ? (keepValidInteractionMode(instance, current.interactionMode) ??
        base.interactionMode)
      : base.interactionMode,
    options: mergeOptions(model, sameInstance ? current.options : undefined),
  }
}

export function selectAgent(
  current: ExecutionSelection,
  agent: string
): ExecutionSelection {
  return { ...current, agent }
}

export function selectInteractionMode(
  current: ExecutionSelection,
  interactionMode: string
): ExecutionSelection {
  return { ...current, interactionMode }
}

export function selectOption(
  current: ExecutionSelection,
  optionId: string,
  value: string
): ExecutionSelection {
  return { ...current, options: { ...current.options, [optionId]: value } }
}

function keepValidAgent(
  instance: PickableInstance,
  model: HarnessModel,
  agent: string | undefined
): string | undefined {
  if (!agent) return undefined
  if (!instance.inventory.capabilities.agentSelection) return undefined
  return agentsFor(instance, model).some((candidate) => candidate.id === agent)
    ? agent
    : undefined
}

function keepValidInteractionMode(
  instance: PickableInstance,
  interactionMode: string | undefined
): string | undefined {
  if (!interactionMode) return undefined
  return interactionModesFor(instance).some(
    (candidate) => candidate.id === interactionMode
  )
    ? interactionMode
    : undefined
}

function mergeOptions(
  model: HarnessModel,
  current: Record<string, string> | undefined
): Record<string, string> {
  const options: Record<string, string> = {}
  for (const descriptor of model.optionDescriptors) {
    const carried = current?.[descriptor.id]
    const valid =
      carried !== undefined &&
      descriptor.options.some((option) => option.id === carried)
    const value = valid ? carried : defaultOptionValue(descriptor)
    if (value !== undefined) options[descriptor.id] = value
  }
  return options
}

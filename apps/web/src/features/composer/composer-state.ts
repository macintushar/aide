import type {
  ConfigDefaults,
  ExecutionSelection,
  HarnessModel,
  InstanceSnapshotEntry,
  OptionDescriptor,
  SelectOption,
} from "@workspace/contracts"

import { sendBlockedReason } from "@/features/instances/instances-store"

/**
 * What the composer shows, derived rather than declared.
 *
 * Two rules drive everything here:
 *
 * 1. **The adapter describes the controls; the UI renders them.** Instance,
 *    model, and whichever of agent or mode the active instance advertises, then
 *    one control per `OptionDescriptor` on the selected model. No descriptor id
 *    is named anywhere in this file or the component that consumes it, so a
 *    harness can add an option without a UI change.
 * 2. **Nothing is invented.** Every value offered, and every value chosen when
 *    the user has not chosen one, comes from configuration or from
 *    adapter-reported inventory. When no source supplies a value, the control
 *    has none — it does not get a made-up one.
 *
 * Resolution is a pure function of the sources plus the user's draft, which is
 * also what makes invalidation fall out for free: a control's value survives a
 * model change only if it is still one of the new model's offered values.
 */

export const COMPOSER_CONTROL_IDS = {
  instance: "instance",
  model: "model",
  agent: "agent",
  mode: "mode",
} as const

export type ComposerControl = {
  id: string
  label: string
  options: SelectOption[]
  value: string | undefined
}

/** Whatever the user has explicitly picked in the composer, and nothing more. */
export type ComposerDraft = {
  instanceId?: string
  modelId?: string
  agent?: string
  interactionMode?: string
  options?: Record<string, string>
}

export type ComposerSources = {
  instances: InstanceSnapshotEntry[]
  /** The most recent send in this Aide session. */
  lastSent?: ExecutionSelection
  projectDefaults?: ConfigDefaults
  userDefaults?: ConfigDefaults
}

export type ComposerView = {
  controls: ComposerControl[]
  instance: InstanceSnapshotEntry | undefined
  model: HarnessModel | undefined
  /** Undefined whenever the composer cannot produce a complete, valid send. */
  selection: ExecutionSelection | undefined
  /** Set when sending is blocked; the message says what to do about it. */
  blockedReason: string | undefined
}

export const EMPTY_DRAFT: ComposerDraft = {}

/** The first candidate the offered values actually contain. */
function pick(
  candidates: Array<string | undefined>,
  isOffered: (value: string) => boolean
): string | undefined {
  for (const candidate of candidates) {
    if (candidate !== undefined && isOffered(candidate)) return candidate
  }
  return undefined
}

function optionIds(options: SelectOption[]): (value: string) => boolean {
  const ids = new Set(options.map((option) => option.id))
  return (value) => ids.has(value)
}

function reportedDefault(options: SelectOption[]): string | undefined {
  return (options.find((option) => option.isDefault) ?? options[0])?.id
}

function instanceOptions(instances: InstanceSnapshotEntry[]): SelectOption[] {
  return instances.map((entry) => ({
    id: entry.instanceId,
    label: entry.displayName ?? entry.instanceId,
  }))
}

function modelOptions(models: HarnessModel[]): SelectOption[] {
  return models.map((model) => ({
    id: model.modelId,
    label: model.displayName,
    ...(model.isDefault ? { isDefault: true } : {}),
  }))
}

function descriptorValue(
  descriptor: OptionDescriptor,
  draft: ComposerDraft,
  sources: ComposerSources
): string | undefined {
  const isOffered = optionIds(descriptor.options)
  return pick(
    [
      draft.options?.[descriptor.id],
      sources.lastSent?.options[descriptor.id],
      sources.projectDefaults?.options?.[descriptor.id],
      sources.userDefaults?.options?.[descriptor.id],
      descriptor.defaultValue,
      // An option flagged as the default is reported; the first option in the
      // list is not, so a descriptor that names neither simply has no value
      // until the user picks one.
      descriptor.options.find((option) => option.isDefault)?.id,
    ],
    isOffered
  )
}

export function resolveComposer(
  sources: ComposerSources,
  draft: ComposerDraft = EMPTY_DRAFT
): ComposerView {
  const instances = sources.instances.filter((entry) => entry.enabled)
  const instanceChoices = instanceOptions(instances)
  const instanceId = pick(
    [
      draft.instanceId,
      sources.lastSent?.instanceId,
      sources.projectDefaults?.instanceId,
      sources.userDefaults?.instanceId,
      instanceChoices[0]?.id,
    ],
    optionIds(instanceChoices)
  )
  const instance = instances.find((entry) => entry.instanceId === instanceId)

  const controls: ComposerControl[] = [
    {
      id: COMPOSER_CONTROL_IDS.instance,
      label: "Instance",
      options: instanceChoices,
      value: instanceId,
    },
  ]

  if (!instance) {
    return {
      controls,
      instance: undefined,
      model: undefined,
      selection: undefined,
      blockedReason:
        instances.length === 0
          ? "No enabled harness instance is configured. Add one in settings to send."
          : "Select a harness instance to send.",
    }
  }

  const inventory = instance.inventory
  const models = inventory?.models ?? []
  const modelChoices = modelOptions(models)
  const modelId = pick(
    [
      draft.modelId,
      sources.lastSent?.model.modelId,
      sources.projectDefaults?.model?.modelId,
      sources.userDefaults?.model?.modelId,
      reportedDefault(modelChoices),
    ],
    optionIds(modelChoices)
  )
  const model = models.find((entry) => entry.modelId === modelId)

  controls.push({
    id: COMPOSER_CONTROL_IDS.model,
    label: "Model",
    options: modelChoices,
    value: modelId,
  })

  // Agent and Mode are different axes. An instance advertises which it has, and
  // a control it does not advertise is not rendered — never collapsed into the
  // other one.
  if (inventory?.capabilities.agentSelection) {
    const agentChoices = agentChoicesFor(inventory.agents, model)
    controls.push({
      id: COMPOSER_CONTROL_IDS.agent,
      label: "Agent",
      options: agentChoices,
      value: pick(
        [
          draft.agent,
          sources.lastSent?.agent,
          sources.projectDefaults?.agent,
          sources.userDefaults?.agent,
          reportedDefault(agentChoices),
        ],
        optionIds(agentChoices)
      ),
    })
  }

  const modeChoices = inventory?.interactionModes ?? []
  if (modeChoices.length > 0) {
    controls.push({
      id: COMPOSER_CONTROL_IDS.mode,
      label: "Mode",
      options: modeChoices,
      value: pick(
        [
          draft.interactionMode,
          sources.lastSent?.interactionMode,
          sources.projectDefaults?.interactionMode,
          sources.userDefaults?.interactionMode,
          reportedDefault(modeChoices),
        ],
        optionIds(modeChoices)
      ),
    })
  }

  // Everything past Mode is generated from the selected model's descriptors.
  const options: Record<string, string> = {}
  for (const descriptor of model?.optionDescriptors ?? []) {
    const value = descriptorValue(descriptor, draft, sources)
    if (value !== undefined) options[descriptor.id] = value
    controls.push({
      id: descriptor.id,
      label: descriptor.label,
      options: descriptor.options,
      value,
    })
  }

  const blockedReason = sendBlockedReason(instance) ?? missingSelection(model)
  const agentControl = controls.find(
    (control) => control.id === COMPOSER_CONTROL_IDS.agent
  )
  const modeControl = controls.find(
    (control) => control.id === COMPOSER_CONTROL_IDS.mode
  )

  return {
    controls,
    instance,
    model,
    blockedReason,
    selection:
      blockedReason || !model
        ? undefined
        : {
            instanceId: instance.instanceId,
            driver: instance.driver,
            model: {
              ...(model.providerId ? { providerId: model.providerId } : {}),
              modelId: model.modelId,
            },
            ...(agentControl?.value ? { agent: agentControl.value } : {}),
            ...(modeControl?.value
              ? { interactionMode: modeControl.value }
              : {}),
            options,
          },
  }
}

/**
 * A model may narrow the agents it works with, and an agent that the selected
 * model does not support must not be offered for a new message.
 */
function agentChoicesFor(
  agents: SelectOption[],
  model: HarnessModel | undefined
): SelectOption[] {
  if (!model?.supportedAgents) return agents
  const supported = new Set(model.supportedAgents)
  return agents.filter((agent) => supported.has(agent.id))
}

function missingSelection(model: HarnessModel | undefined): string | undefined {
  return model
    ? undefined
    : "This instance has not reported a model yet, so sending is disabled."
}

/**
 * Records the user's choice. A model change drops the option values chosen
 * under the previous model rather than carrying them across: `resolveComposer`
 * re-derives each one from the new model's descriptors, so a still-valid value
 * comes back on its own and an incompatible one is replaced by that
 * descriptor's default.
 */
export function applyComposerChange(
  draft: ComposerDraft,
  controlId: string,
  value: string
): ComposerDraft {
  switch (controlId) {
    case COMPOSER_CONTROL_IDS.instance:
      // A different instance means different inventory entirely.
      return { instanceId: value }
    case COMPOSER_CONTROL_IDS.model:
      return { ...draft, modelId: value, options: {} }
    case COMPOSER_CONTROL_IDS.agent:
      return { ...draft, agent: value }
    case COMPOSER_CONTROL_IDS.mode:
      return { ...draft, interactionMode: value }
    default:
      return { ...draft, options: { ...draft.options, [controlId]: value } }
  }
}

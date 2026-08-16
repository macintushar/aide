import { useEffect, useState } from "react"

import {
  createCommandClient,
  newCommandId,
} from "@/lib/transport/command-client"
import { createReadClient } from "@/lib/transport/read-client"

import { configToDraft, type DraftValidation } from "./config-draft"
import { SettingsForm, type SettingsTarget } from "./settings-form"

type ReadClient = Pick<
  ReturnType<typeof createReadClient>,
  "getConfig" | "getProjectConfig"
>
type CommandClient = Pick<ReturnType<typeof createCommandClient>, "send">

export type SettingsBoundaryProps = {
  target?: SettingsTarget
  readClient?: ReadClient
  commandClient?: CommandClient
}

const defaultReadClient = createReadClient()
const defaultCommandClient = createCommandClient()

export function SettingsBoundary({
  target = { kind: "global" },
  readClient = defaultReadClient,
  commandClient = defaultCommandClient,
}: SettingsBoundaryProps) {
  const [draft, setDraft] = useState<ReturnType<typeof configToDraft>>()
  const [loadError, setLoadError] = useState<string>()
  const [saveError, setSaveError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const projectId = target.kind === "project" ? target.projectId : undefined

  useEffect(() => {
    let active = true
    setDraft(undefined)
    setLoadError(undefined)
    const request = projectId
      ? readClient.getProjectConfig(projectId)
      : readClient.getConfig()
    void request
      .then((config) => {
        if (active) setDraft(configToDraft(config))
      })
      .catch((error: unknown) => {
        if (active) setLoadError(errorMessage(error))
      })
    return () => {
      active = false
    }
  }, [projectId, readClient])

  async function save(payload: NonNullable<DraftValidation["payload"]>) {
    setSaving(true)
    setSaved(false)
    setSaveError(undefined)
    try {
      await commandClient.send({
        name: "config.update",
        commandId: newCommandId(),
        target,
        config: payload,
      })
      setSaved(true)
    } catch (error) {
      setSaveError(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  if (!draft && !loadError) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading settings…
      </p>
    )
  }

  if (!draft) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load settings: {loadError}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {saveError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not save settings: {saveError}
        </p>
      ) : null}
      {saved ? (
        <p
          role="status"
          className="text-sm text-emerald-700 dark:text-emerald-400"
        >
          Settings saved.
        </p>
      ) : null}
      <SettingsForm
        initial={draft}
        target={target}
        onSubmit={save}
        saving={saving}
      />
    </div>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error"
}

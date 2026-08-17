import {
  RiPulseLine,
  RiSettings3Line,
  RiTerminalBoxLine,
} from "@remixicon/react"

import {
  InstancesBoundary,
  type InstancesBoundaryProps,
} from "@/features/instances"
import {
  SettingsBoundary,
  type SettingsBoundaryProps,
} from "@/features/settings"
import { createCommandClient } from "@/lib/transport/command-client"
import { subscribeInstancesEvents } from "@/lib/transport/event-source"
import { createReadClient } from "@/lib/transport/read-client"

export type AppProps = {
  readClient?: InstancesBoundaryProps["readClient"] &
    SettingsBoundaryProps["readClient"]
  commandClient?: InstancesBoundaryProps["commandClient"] &
    SettingsBoundaryProps["commandClient"]
  subscribeInstances?: InstancesBoundaryProps["subscribe"]
}

const token = import.meta.env.VITE_AIDE_BEARER_TOKEN
const readClient = createReadClient(token ? { bearerToken: token } : {})
const commandClient = createCommandClient(token ? { bearerToken: token } : {})

export function App({
  readClient: reads = readClient,
  commandClient: commands = commandClient,
  subscribeInstances = subscribeInstancesEvents,
}: AppProps) {
  return (
    <div className="min-h-svh bg-[radial-gradient(circle_at_top_left,var(--color-primary)_0,transparent_24rem)] bg-fixed">
      <div className="min-h-svh bg-background/94">
        <header className="border-b border-border bg-background/80 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <RiTerminalBoxLine className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h1 className="font-heading text-lg font-semibold tracking-tight">
                  Aide
                </h1>
                <p className="text-[0.68rem] font-medium tracking-[0.18em] text-muted-foreground uppercase">
                  Control plane
                </p>
              </div>
            </div>
            <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
              Wave 2 · Local operations
            </span>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
          <div className="mb-8 max-w-2xl">
            <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-primary uppercase">
              <RiPulseLine className="size-4" aria-hidden="true" />
              Runtime overview
            </p>
            <h2 className="mt-3 font-heading text-3xl font-medium tracking-tight sm:text-4xl">
              Harness operations, without leaving your workspace.
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              Observe configured runtimes, issue authoritative lifecycle
              commands, and keep global execution settings in one place.
            </p>
          </div>

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(32rem,1.2fr)]">
            <section
              aria-labelledby="instances-heading"
              className="min-w-0 rounded-3xl border border-border bg-background/90 p-5 shadow-sm sm:p-6"
            >
              <div className="mb-5 flex items-start justify-between gap-4 border-b border-border pb-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase">
                    Operations
                  </p>
                  <h2
                    id="instances-heading"
                    className="mt-1 font-heading text-2xl font-medium"
                  >
                    Instances
                  </h2>
                </div>
                <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  Live
                </span>
              </div>
              <InstancesBoundary
                readClient={reads}
                commandClient={commands}
                subscribe={subscribeInstances}
              />
            </section>

            <section
              aria-labelledby="settings-heading"
              className="min-w-0 rounded-3xl border border-border bg-background/90 p-5 shadow-sm sm:p-6 lg:p-8"
            >
              <div className="mb-7 flex items-center gap-3 border-b border-border pb-5">
                <span className="grid size-9 place-items-center rounded-xl bg-muted text-muted-foreground">
                  <RiSettings3Line className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase">
                    Global configuration
                  </p>
                  <h2
                    id="settings-heading"
                    className="font-heading text-2xl font-medium"
                  >
                    Settings
                  </h2>
                </div>
              </div>
              <SettingsBoundary readClient={reads} commandClient={commands} />
            </section>
          </div>
        </main>
      </div>
    </div>
  )
}

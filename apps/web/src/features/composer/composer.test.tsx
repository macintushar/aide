import {
  instancesSnapshotFixture,
  inventoryFixture,
  type InstancesSnapshot,
} from "@workspace/contracts"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { describe, expect, it, vi } from "vitest"

import { InstancesProvider } from "@/features/instances"

import { Composer } from "./composer"

/** Two harnesses with real inventories, so the rail has something to switch. */
function snapshot(): InstancesSnapshot {
  const base = instancesSnapshotFixture()
  return {
    ...base,
    instances: [
      base.instances[0]!,
      {
        ...base.instances[1]!,
        status: "ready",
        auth: { status: "authenticated" },
        inventory: {
          ...inventoryFixture(),
          instanceId: "claude",
          driver: "claudeAgent",
          agents: [],
          capabilities: {
            ...inventoryFixture().capabilities,
            agentSelection: false,
          },
          models: [
            {
              modelId: "opus-5",
              displayName: "Claude Opus 5",
              isDefault: true,
              optionDescriptors: [],
            },
            {
              modelId: "sonnet-5",
              displayName: "Claude Sonnet 5",
              optionDescriptors: [],
            },
          ],
        },
      },
    ],
  }
}

function renderComposer(
  onSend = vi.fn(),
  instances: InstancesSnapshot = snapshot()
) {
  render(
    <TooltipProvider delay={0}>
      <InstancesProvider
        readClient={{ getInstances: async () => instances }}
        commandClient={{ send: vi.fn() }}
        subscribe={() => ({ close: vi.fn() })}
      >
        <Composer pending={false} onSend={onSend} />
      </InstancesProvider>
    </TooltipProvider>
  )
  return onSend
}

describe("Composer", () => {
  it("starts on the harness-reported defaults and sends that selection", async () => {
    const user = userEvent.setup()
    const onSend = renderComposer()

    expect(
      await screen.findByRole("button", { name: /GPT-5/ })
    ).toBeInTheDocument()

    await user.type(screen.getByLabelText("Message"), "ship it")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    expect(onSend).toHaveBeenCalledWith("ship it", {
      instanceId: "opencode",
      driver: "opencode",
      model: { providerId: "openai", modelId: "gpt-5" },
      agent: "build",
      interactionMode: undefined,
      options: { variant: "stable" },
    })
  })

  it("renders one select per reported option descriptor, and nothing else", async () => {
    renderComposer()

    expect(
      await screen.findByRole("combobox", { name: "Agent" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("combobox", { name: "Variant" })
    ).toBeInTheDocument()
    // OpenCode reports no interaction modes, so no Mode control exists.
    expect(
      screen.queryByRole("combobox", { name: "Mode" })
    ).not.toBeInTheDocument()
  })

  it("switches instance and model from the picker, dropping controls the new harness lacks", async () => {
    const user = userEvent.setup()
    renderComposer()

    await user.click(await screen.findByRole("button", { name: /GPT-5/ }))
    await user.click(screen.getByRole("tab", { name: "Claude" }))
    await user.click(
      within(screen.getByRole("listbox")).getByText("Claude Sonnet 5")
    )

    expect(
      screen.getByRole("button", { name: /Claude Sonnet 5/ })
    ).toBeInTheDocument()
    // Claude reports agentSelection: false, so that control goes away.
    expect(
      screen.queryByRole("combobox", { name: "Agent" })
    ).not.toBeInTheDocument()
  })

  it("filters models across every instance once you search", async () => {
    const user = userEvent.setup()
    renderComposer()

    await user.click(await screen.findByRole("button", { name: /GPT-5/ }))
    await user.type(screen.getByLabelText("Search models"), "sonnet")

    const options = within(screen.getByRole("listbox")).getAllByRole("option")
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent("Claude Sonnet 5")
  })

  it("blocks sending on an instance that cannot take a turn", async () => {
    const blocked = snapshot()
    renderComposer(vi.fn(), {
      ...blocked,
      instances: [
        {
          ...blocked.instances[0]!,
          auth: { status: "unauthenticated" },
        },
      ],
    })

    expect(await screen.findByRole("status")).toHaveTextContent(/Sign in/)
    expect(screen.getByLabelText("Message")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled()
  })
})

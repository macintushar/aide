import {
  inputRequestFixture,
  permissionRequestFixture,
  type Request,
} from "@workspace/contracts"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { RequestCard } from "./request-card"

function open(request: Request): Request {
  return { ...request, status: "open", resolution: undefined }
}

describe("RequestCard", () => {
  it("resolves a permission from its selected option", async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()

    render(
      <RequestCard
        request={open(permissionRequestFixture())}
        onResolve={onResolve}
      />
    )
    await user.click(screen.getByRole("button", { name: "Deny" }))

    expect(onResolve).toHaveBeenCalledWith({
      kind: "permission",
      optionId: "deny",
    })
  })

  it("submits multi-select and free-text answers", async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()

    render(
      <RequestCard
        request={open(inputRequestFixture())}
        onResolve={onResolve}
      />
    )
    await user.click(screen.getByRole("checkbox", { name: "Fast" }))
    await user.type(
      screen.getByRole("textbox", { name: "Any notes?" }),
      "Ship it"
    )
    await user.click(screen.getByRole("button", { name: "Submit answers" }))

    expect(onResolve).toHaveBeenCalledWith({
      kind: "input",
      answers: {
        approach: { optionIds: ["safe", "fast"] },
        notes: { text: "Ship it" },
      },
    })
  })

  it("renders resolved and cancelled requests compactly", () => {
    const { rerender } = render(
      <RequestCard
        request={permissionRequestFixture()}
        onResolve={() => undefined}
      />
    )
    expect(screen.getByText("resolved")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Allow" })
    ).not.toBeInTheDocument()

    rerender(
      <RequestCard
        request={{ ...inputRequestFixture(), status: "cancelled" }}
        onResolve={() => undefined}
      />
    )
    expect(screen.getByText("cancelled")).toBeInTheDocument()
  })
})

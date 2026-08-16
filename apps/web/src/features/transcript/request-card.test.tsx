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

  it("toggles a multi-select option off again", async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(
      <RequestCard
        request={open(inputRequestFixture())}
        onResolve={onResolve}
      />
    )
    const fast = screen.getByRole("checkbox", { name: "Fast" })

    await user.click(fast)
    await user.click(fast)
    await user.click(screen.getByRole("button", { name: "Submit answers" }))

    expect(onResolve).toHaveBeenCalledWith({
      kind: "input",
      answers: {
        approach: { optionIds: ["safe"] },
        notes: { text: "" },
      },
    })
  })

  it("submits a single-line free-text-only question", async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    const request = open(inputRequestFixture())
    if (request.kind !== "input") throw new Error("Expected input request")
    request.payload.questions = [
      {
        id: "name",
        prompt: "Your name?",
        allowMultiple: false,
        allowFreeText: true,
      },
    ]
    render(<RequestCard request={request} onResolve={onResolve} />)

    await user.type(screen.getByRole("textbox", { name: "Your name?" }), "Ada")
    await user.click(screen.getByRole("button", { name: "Submit answers" }))

    expect(onResolve).toHaveBeenCalledWith({
      kind: "input",
      answers: { name: { text: "Ada" } },
    })
  })

  it("submits an empty answer for a question with no answer controls", async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    const request = open(inputRequestFixture())
    if (request.kind !== "input") throw new Error("Expected input request")
    request.payload.questions = [
      {
        id: "acknowledgement",
        prompt: "Continue?",
        allowMultiple: false,
        allowFreeText: false,
      },
    ]
    render(<RequestCard request={request} onResolve={onResolve} />)

    await user.click(screen.getByRole("button", { name: "Submit answers" }))

    expect(onResolve).toHaveBeenCalledWith({
      kind: "input",
      answers: { acknowledgement: {} },
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
    expect(screen.getByText("Input requested")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Submit answers" })
    ).not.toBeInTheDocument()
  })
})

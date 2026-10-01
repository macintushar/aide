import type {
  InputResolution,
  PermissionResolution,
  Request,
} from "@workspace/contracts"
import {
  RiCheckboxCircleLine,
  RiQuestionLine,
  RiShieldKeyholeLine,
} from "@remixicon/react"
import { Button } from "@workspace/ui/components/button"
import { useState, type FormEvent } from "react"

type RequestResolution = InputResolution | PermissionResolution

const CARD =
  "rounded-xl border border-warn/30 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--warn)_6%,var(--n2)),var(--n2)_45%)] p-4 shadow-card"

function CardHeading({
  icon,
  eyebrow,
  children,
}: {
  icon: React.ReactNode
  eyebrow: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-warn/12 text-warn [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-small font-medium text-warn">{eyebrow}</p>
        <h3 className="text-body font-semibold text-foreground">{children}</h3>
      </div>
    </div>
  )
}

function ResolvedRequest({ request }: { request: Request }) {
  const title =
    request.kind === "permission" ? request.payload.title : "Input requested"

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--n2)] px-3.5 py-2.5">
      <span className="flex min-w-0 items-center gap-2 text-ui text-[var(--n6)]">
        <RiCheckboxCircleLine
          className="size-4 shrink-0 text-[var(--n5)]"
          aria-hidden="true"
        />
        <span className="truncate">{title}</span>
      </span>
      <span className="shrink-0 rounded-full bg-[var(--n3)] px-2 py-0.5 text-small font-medium text-muted-foreground capitalize">
        {request.status}
      </span>
    </div>
  )
}

function PermissionCard({
  request,
  onResolve,
}: {
  request: Extract<Request, { kind: "permission" }>
  onResolve: (resolution: RequestResolution) => void
}) {
  return (
    <section className={CARD}>
      <CardHeading
        icon={<RiShieldKeyholeLine aria-hidden="true" />}
        eyebrow={`${request.payload.toolName} permission`}
      >
        {request.payload.title}
      </CardHeading>
      {request.payload.detail ? (
        <p className="mt-2 rounded-md bg-[var(--n0)] px-2.5 py-1.5 font-mono text-mono break-all text-[var(--n7)]">
          {request.payload.detail}
        </p>
      ) : null}
      {request.payload.boundary ? (
        <div
          data-testid="permission-boundary"
          className="mt-3 rounded-lg border border-danger/35 bg-danger/8 p-3"
        >
          <p className="text-ui font-medium text-danger">
            This reaches outside the project
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {request.payload.boundary.outsidePaths.map((path) => (
              <li key={path} className="font-mono text-mono break-all">
                {path}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-small text-muted-foreground">
            Project: {request.payload.boundary.projectDirectory}
          </p>
        </div>
      ) : null}
      {request.payload.diff ? (
        <pre className="mt-3 max-h-48 overflow-auto rounded-md border border-[var(--line)] bg-[var(--n0)] p-3 font-mono text-mono whitespace-pre-wrap text-[var(--n7)]">
          {request.payload.diff}
        </pre>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-warn/15 pt-3.5">
        {request.payload.options.map((option) => (
          <Button
            key={option.id}
            type="button"
            variant={option.isDefault ? "default" : "outline"}
            onClick={() =>
              onResolve({ kind: "permission", optionId: option.id })
            }
          >
            {option.label}
          </Button>
        ))}
      </div>
    </section>
  )
}

function InputCard({
  request,
  onResolve,
}: {
  request: Extract<Request, { kind: "input" }>
  onResolve: (resolution: RequestResolution) => void
}) {
  const [optionIds, setOptionIds] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      request.payload.questions.map((question) => [
        question.id,
        question.options
          ?.filter((option) => option.isDefault)
          .map((option) => option.id) ?? [],
      ])
    )
  )
  const [text, setText] = useState<Record<string, string>>({})

  function selectOption(
    questionId: string,
    optionId: string,
    multiple: boolean
  ) {
    setOptionIds((current) => {
      const selected = current[questionId] ?? []
      const next = multiple
        ? selected.includes(optionId)
          ? selected.filter((id) => id !== optionId)
          : [...selected, optionId]
        : [optionId]
      return { ...current, [questionId]: next }
    })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const answers = Object.fromEntries(
      request.payload.questions.map((question) => {
        const selected = optionIds[question.id] ?? []
        const answer: { optionIds?: string[]; text?: string } = {}
        if (question.options) answer.optionIds = selected
        if (question.allowFreeText) answer.text = text[question.id] ?? ""
        return [question.id, answer]
      })
    )
    onResolve({ kind: "input", answers })
  }

  return (
    <form className={CARD} onSubmit={submit}>
      <CardHeading
        icon={<RiQuestionLine aria-hidden="true" />}
        eyebrow="The agent is asking"
      >
        Input requested
      </CardHeading>
      <div className="mt-4 flex flex-col gap-5">
        {request.payload.questions.map((question) => (
          <fieldset key={question.id} className="flex flex-col gap-2">
            <legend className="mb-1 text-ui font-medium">
              {question.header ?? question.prompt}
            </legend>
            {question.header ? (
              <p className="text-ui text-muted-foreground">{question.prompt}</p>
            ) : null}
            {question.options?.map((option) => (
              <label
                key={option.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-[var(--line)] bg-[var(--n1)] px-3 py-2 text-ui transition-colors hover:border-[var(--line-strong)] has-checked:border-[var(--accent-dim)] has-checked:bg-accent-subtle"
              >
                <input
                  type={question.allowMultiple ? "checkbox" : "radio"}
                  name={question.id}
                  checked={(optionIds[question.id] ?? []).includes(option.id)}
                  onChange={() =>
                    selectOption(question.id, option.id, question.allowMultiple)
                  }
                  className="size-4 accent-primary"
                />
                {option.label}
              </label>
            ))}
            {question.allowFreeText ? (
              question.multiline ? (
                <textarea
                  aria-label={question.prompt}
                  rows={3}
                  value={text[question.id] ?? ""}
                  onChange={(event) =>
                    setText((current) => ({
                      ...current,
                      [question.id]: event.target.value,
                    }))
                  }
                  className="resize-y rounded-lg border border-[var(--line-strong)] bg-[var(--n0)] px-3 py-2 text-ui outline-none focus-visible:border-[var(--accent-dim)] focus-visible:ring-3 focus-visible:ring-[var(--accent-glow)]"
                />
              ) : (
                <input
                  aria-label={question.prompt}
                  type="text"
                  value={text[question.id] ?? ""}
                  onChange={(event) =>
                    setText((current) => ({
                      ...current,
                      [question.id]: event.target.value,
                    }))
                  }
                  className="h-9 rounded-lg border border-[var(--line-strong)] bg-[var(--n0)] px-3 text-ui outline-none focus-visible:border-[var(--accent-dim)] focus-visible:ring-3 focus-visible:ring-[var(--accent-glow)]"
                />
              )
            ) : null}
          </fieldset>
        ))}
      </div>
      <Button type="submit" className="mt-5 w-full sm:w-auto">
        Submit answers
      </Button>
    </form>
  )
}

export function RequestCard({
  request,
  onResolve,
}: {
  request: Request
  onResolve: (resolution: RequestResolution) => void
}) {
  if (request.status !== "open") return <ResolvedRequest request={request} />

  return request.kind === "permission" ? (
    <PermissionCard request={request} onResolve={onResolve} />
  ) : (
    <InputCard request={request} onResolve={onResolve} />
  )
}

import type {
  InputResolution,
  PermissionResolution,
  Request,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { useState, type FormEvent } from "react"

type RequestResolution = InputResolution | PermissionResolution

function ResolvedRequest({ request }: { request: Request }) {
  const title =
    request.kind === "permission" ? request.payload.title : "Input requested"

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <span className="truncate text-ui font-medium">{title}</span>
      <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-small font-medium text-muted-foreground capitalize">
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
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="text-label text-muted-foreground uppercase">
        {request.payload.toolName} permission
      </p>
      <h3 className="mt-1 text-body font-semibold">{request.payload.title}</h3>
      {request.payload.detail ? (
        <p className="mt-1 text-ui text-muted-foreground">
          {request.payload.detail}
        </p>
      ) : null}
      {request.payload.diff ? (
        <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-muted p-3 font-mono text-mono whitespace-pre-wrap">
          {request.payload.diff}
        </pre>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
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
    <form
      className="rounded-lg border border-border bg-card p-4 shadow-sm"
      onSubmit={submit}
    >
      <p className="text-label text-muted-foreground uppercase">
        Input requested
      </p>
      <div className="mt-3 flex flex-col gap-5">
        {request.payload.questions.map((question) => (
          <fieldset key={question.id} className="flex flex-col gap-2">
            <legend className="text-ui font-medium">
              {question.header ?? question.prompt}
            </legend>
            {question.header ? (
              <p className="text-ui text-muted-foreground">{question.prompt}</p>
            ) : null}
            {question.options?.map((option) => (
              <label
                key={option.id}
                className="flex items-center gap-2 text-ui"
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
                  className="resize-y rounded-md border border-input bg-background px-3 py-2 text-ui"
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
                  className="h-9 rounded-md border border-input bg-background px-3 text-ui"
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

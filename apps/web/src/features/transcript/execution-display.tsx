import type { ResolvedExecution } from "@workspace/contracts"

export function ExecutionDisplay({
  execution,
}: {
  execution: ResolvedExecution
}) {
  const { instanceName, modelName, agentName, interactionModeName, options } =
    execution.display

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted-foreground">
      <span className="font-medium text-foreground">{instanceName}</span>
      <span aria-hidden="true">/</span>
      <span className="font-medium text-foreground">{modelName}</span>
      {agentName ? (
        <>
          <span aria-hidden="true">/</span>
          <span>{agentName}</span>
        </>
      ) : null}
      {interactionModeName ? (
        <>
          <span aria-hidden="true">/</span>
          <span>{interactionModeName}</span>
        </>
      ) : null}
      {Object.entries(options).map(([id, option]) => (
        <span
          key={id}
          className="rounded-full border border-border px-2 py-0.5"
        >
          {option.label}: {option.valueLabel}
        </span>
      ))}
    </div>
  )
}

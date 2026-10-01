import type { ResolvedExecution } from "@workspace/contracts"

export function ExecutionDisplay({
  execution,
}: {
  execution: ResolvedExecution
}) {
  const { instanceName, modelName, agentName, interactionModeName, options } =
    execution.display

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-small text-[var(--n5)]">
      <span className="font-medium text-[var(--n7)]">{instanceName}</span>
      <Dot />
      <span className="text-[var(--n6)]">{modelName}</span>
      {agentName ? (
        <>
          <Dot />
          <span>{agentName}</span>
        </>
      ) : null}
      {interactionModeName ? (
        <>
          <Dot />
          <span>{interactionModeName}</span>
        </>
      ) : null}
      {Object.entries(options).map(([id, option]) => (
        <span
          key={id}
          className="rounded-full border border-[var(--line)] px-1.5 text-[0.6875rem]"
        >
          {option.label}: {option.valueLabel}
        </span>
      ))}
    </div>
  )
}

function Dot() {
  return (
    <span aria-hidden="true" className="text-[var(--n4)]">
      ·
    </span>
  )
}

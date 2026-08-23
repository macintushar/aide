import type {
  Message,
  Request,
  ResolvedExecution,
  Turn,
} from "@workspace/contracts"

import {
  turnDisplayState,
  type TurnDisplayState,
} from "@/features/transcript/turn-state"

/**
 * The composer's starting point is the most recently sent selection in this
 * session (PLAN.md precedence rule 2). Nothing here invents a value.
 */
export function latestExecution(
  messages: Message[]
): ResolvedExecution | undefined {
  return [...messages]
    .sort((left, right) => right.seq - left.seq)
    .find((message) => message.role === "user")?.execution
}

export function latestTurn(turns: Turn[]): Turn | undefined {
  return [...turns].sort((left, right) => right.seq - left.seq)[0]
}

export function latestTurnState(
  turns: Turn[],
  requests: Request[]
): TurnDisplayState | undefined {
  const turn = latestTurn(turns)
  return turn ? turnDisplayState(turn, requests) : undefined
}

import type {
  Project,
  Session,
  SessionActivity,
  SessionSummary,
  Turn,
} from "@workspace/contracts"

import type { AideDb } from "../db"
import { messagesRepo, requestsRepo, turnsRepo } from "../db"

const PREVIEW_CHARS = 200

/** One session's overview: where it stands, who ran it last, what it said. */
export function summarizeSession(
  db: AideDb,
  session: Session,
  project: Project
): SessionSummary {
  const turns = turnsRepo.listBySession(db, session.id)
  const openRequests = requestsRepo.listOpenBySession(db, session.id).length
  const messages = messagesRepo.listBySession(db, session.id)
  const latest = turns.at(-1)
  const open = turns.find((turn) => turn.status === "running")

  let costUsd: number | undefined
  for (const message of messages) {
    if (message.role === "assistant" && message.usage?.costUsd !== undefined) {
      costUsd = (costUsd ?? 0) + message.usage.costUsd
    }
  }

  const lastMessage = [...messages].reverse().find((message) =>
    message.parts.some((part) => part.type === "text" && part.text.trim())
  )
  const lastText = lastMessage?.parts.find((part) => part.type === "text")

  return {
    session,
    project: { id: project.id, name: project.name, directory: project.directory },
    activity: activityOf(turns, openRequests),
    openRequests,
    turnCount: turns.length,
    ...(latest
      ? {
          latestExecution: {
            driver: latest.execution.selection.driver,
            instanceName: latest.execution.display.instanceName,
            modelName: latest.execution.display.modelName,
          },
        }
      : {}),
    ...(lastMessage && lastText?.type === "text"
      ? {
          lastMessage: {
            role: lastMessage.role,
            text: lastText.text.trim().slice(0, PREVIEW_CHARS),
          },
        }
      : {}),
    ...(open?.startedAt ? { runningSince: open.startedAt } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  }
}

function activityOf(turns: Turn[], openRequests: number): SessionActivity {
  if (openRequests > 0) return "needs_input"
  if (turns.some((turn) => turn.status === "running")) return "running"
  if (turns.some((turn) => turn.status === "queued")) return "queued"
  const latest = turns.at(-1)
  if (!latest) return "idle"
  // Open statuses were handled above, so the latest turn has settled.
  return latest.status as Exclude<Turn["status"], "running" | "queued">
}

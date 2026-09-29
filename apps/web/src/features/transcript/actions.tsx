import { createContext, useContext } from "react"

/**
 * What the transcript can ask the session to do, provided once by the thread
 * instead of being threaded through every part. Each action is optional: a
 * transcript rendered without them (tests, the gallery) simply omits the
 * controls.
 */
export type TranscriptActions = {
  /** Preview a file from the session's working directory. */
  openFile?: (path: string) => void
  /** Show a tool's full output, stored as an artifact. */
  openArtifact?: (artifactId: string) => void
  /** Stop one running subagent of the current turn. */
  stopSubagent?: (taskId: string) => void
}

const TranscriptActionsContext = createContext<TranscriptActions>({})

export const TranscriptActionsProvider = TranscriptActionsContext.Provider

export function useTranscriptActions(): TranscriptActions {
  return useContext(TranscriptActionsContext)
}

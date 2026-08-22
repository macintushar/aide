import { useCallback, useEffect, useState } from "react"

import {
  isSurfaceId,
  SURFACES,
  type SurfaceId,
} from "@/components/shell/surfaces"
import { isPlainKeypress } from "@/lib/keyboard"

export type WorkspaceState = {
  sidebarOpen: boolean
  panelOpen: boolean
  surface: SurfaceId | null
}

const STORAGE_KEY = "aide.workspace"

const DEFAULT_STATE: WorkspaceState = {
  sidebarOpen: true,
  panelOpen: false,
  surface: null,
}

export function readWorkspaceState(
  storage: Storage = localStorage
): WorkspaceState {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_STATE
    const candidate = parsed as Record<string, unknown>
    return {
      sidebarOpen:
        typeof candidate.sidebarOpen === "boolean"
          ? candidate.sidebarOpen
          : DEFAULT_STATE.sidebarOpen,
      panelOpen:
        typeof candidate.panelOpen === "boolean"
          ? candidate.panelOpen
          : DEFAULT_STATE.panelOpen,
      surface: isSurfaceId(candidate.surface) ? candidate.surface : null,
    }
  } catch {
    return DEFAULT_STATE
  }
}

function persist(state: WorkspaceState, storage: Storage = localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Presentation state is disposable; never fail a toggle over it.
  }
}

export function useWorkspaceState() {
  const [state, setState] = useState<WorkspaceState>(() => readWorkspaceState())

  useEffect(() => {
    persist(state)
  }, [state])

  const toggleSidebar = useCallback(() => {
    setState((current) => ({ ...current, sidebarOpen: !current.sidebarOpen }))
  }, [])

  const togglePanel = useCallback(() => {
    setState((current) => ({ ...current, panelOpen: !current.panelOpen }))
  }, [])

  const openSurface = useCallback((surface: SurfaceId) => {
    setState((current) => ({ ...current, panelOpen: true, surface }))
  }, [])

  const closeSurface = useCallback(() => {
    setState((current) => ({ ...current, surface: null }))
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isPlainKeypress(event)) return

      if (event.key === "[") {
        event.preventDefault()
        toggleSidebar()
        return
      }

      if (event.key === "]") {
        event.preventDefault()
        togglePanel()
        return
      }

      const surface = SURFACES.find(
        (candidate) =>
          candidate.available && candidate.shortcut === event.key.toLowerCase()
      )
      if (surface && state.panelOpen) {
        event.preventDefault()
        openSurface(surface.id)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [openSurface, state.panelOpen, togglePanel, toggleSidebar])

  return { ...state, toggleSidebar, togglePanel, openSurface, closeSurface }
}

/**
 * Shared guard for global single-key shortcuts: never steal a keystroke that
 * the user meant for a field they are typing in.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  return (
    target.closest("input, textarea, select, [contenteditable='true']") !== null
  )
}

export function isPlainKeypress(event: KeyboardEvent): boolean {
  if (event.repeat) return false
  if (event.metaKey || event.ctrlKey || event.altKey) return false
  return !isEditableTarget(event.target)
}

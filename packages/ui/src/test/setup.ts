import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// Auto-cleanup only registers via globals, which we don't enable — do it explicitly.
afterEach(() => {
  cleanup()
})

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@workspace/ui/globals.css"
import { App } from "@/App"
import { Gallery } from "@/gallery/gallery"
import { demoReadClient } from "@/gallery/demo-data"
import { mockCommandClient, mockSubscribe } from "@/gallery/mock-data"
import { ThemeProvider } from "@/components/theme-provider"

// `gallery.html?app` renders the whole app over the demo workspace, so every
// screen can be seen and clicked without a server or a harness.
const demo = new URLSearchParams(window.location.search).has("app")

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      {demo ? (
        <App
          authenticated
          readClient={demoReadClient}
          commandClient={mockCommandClient}
          subscribeInstances={mockSubscribe}
          subscribeSession={mockSubscribe}
        />
      ) : (
        <Gallery />
      )}
    </ThemeProvider>
  </StrictMode>
)

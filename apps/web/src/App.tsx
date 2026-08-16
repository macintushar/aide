import { sessionSnapshotFixture } from "@workspace/contracts"

import { RequestCard } from "@/features/transcript/request-card"
import { Transcript } from "@/features/transcript/transcript"

const snapshot = sessionSnapshotFixture()

export function App() {
  return (
    <div className="min-h-svh bg-muted/20">
      <header className="border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <h1 className="font-heading text-xl font-semibold tracking-tight">
            Aide
          </h1>
          <span className="max-w-[60%] truncate text-sm text-muted-foreground">
            {snapshot.project.name}
          </span>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:py-10">
        <section className="min-w-0 rounded-3xl border border-border bg-background p-4 shadow-sm sm:p-6">
          <div className="mb-7 border-b border-border pb-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Session
            </p>
            <h2 className="mt-1 font-heading text-2xl font-medium">
              {snapshot.session.title}
            </h2>
          </div>
          <Transcript messages={snapshot.messages} />
        </section>
        <aside className="min-w-0">
          <h2 className="mb-3 font-heading text-lg font-medium">Requests</h2>
          <div className="flex flex-col gap-3">
            {snapshot.requests.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                onResolve={() => undefined}
              />
            ))}
          </div>
        </aside>
      </main>
    </div>
  )
}

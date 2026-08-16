import type { AideEvent, Snapshot } from "@workspace/contracts"

export function eventSseFrame(event: AideEvent): string {
  const id = event.delivery.durable ? `id: ${event.delivery.sequence}\n` : ""
  return `${id}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export function snapshotSseFrame(snapshot: Snapshot): string {
  return `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`
}

export function heartbeatSseFrame(comment = "heartbeat"): string {
  return `: ${comment}\n\n`
}

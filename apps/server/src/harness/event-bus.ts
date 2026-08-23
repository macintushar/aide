import type { AideEvent } from "@workspace/contracts"

/**
 * Fan-out for adapter event streams.
 *
 * `HarnessAdapter.events` promises that everything published after iteration
 * begins reaches the iterator, so a subscription buffers rather than drops when
 * nobody is awaiting `next()` yet: boot reconciliation subscribes and only then
 * decides whether to keep a turn, and a bus that discarded events in that gap
 * would strand the turn.
 */

type Subscription = {
  buffered: AideEvent[]
  closed: boolean
  waiters: Array<(result: IteratorResult<AideEvent>) => void>
}

export type EventBus = {
  publish(event: AideEvent): void
  close(): void
  subscribe(): AsyncIterable<AideEvent>
  subscriberCount(): number
}

export function createEventBus(): EventBus {
  const subscriptions = new Set<Subscription>()
  let closed = false

  const dispatch = (subscription: Subscription, event: AideEvent) => {
    if (subscription.closed) return
    const waiter = subscription.waiters.shift()
    if (waiter) {
      waiter({ value: event, done: false })
    } else {
      subscription.buffered.push(event)
    }
  }

  const finish = (subscription: Subscription) => {
    subscription.closed = true
    for (const waiter of subscription.waiters.splice(0)) {
      waiter({ value: undefined, done: true })
    }
  }

  return {
    publish(event) {
      if (closed) return
      for (const subscription of subscriptions) {
        dispatch(subscription, event)
      }
    },
    close() {
      closed = true
      for (const subscription of subscriptions) {
        finish(subscription)
      }
      subscriptions.clear()
    },
    subscribe() {
      const subscription: Subscription = {
        buffered: [],
        closed: false,
        waiters: [],
      }
      if (closed) {
        subscription.closed = true
      } else {
        subscriptions.add(subscription)
      }
      const iterator: AsyncIterator<AideEvent> = {
        next() {
          const event = subscription.buffered.shift()
          if (event) {
            return Promise.resolve({ value: event, done: false })
          }
          if (subscription.closed) {
            return Promise.resolve({ value: undefined, done: true })
          }
          return new Promise<IteratorResult<AideEvent>>((resolve) => {
            subscription.waiters.push(resolve)
          })
        },
        return() {
          subscriptions.delete(subscription)
          finish(subscription)
          return Promise.resolve({ value: undefined, done: true })
        },
      }
      return { [Symbol.asyncIterator]: () => iterator }
    },
    subscriberCount() {
      return subscriptions.size
    },
  }
}

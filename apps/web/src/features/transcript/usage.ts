import type { Usage } from "@workspace/contracts"

function compact(value: number): string {
  if (value < 1_000) return String(value)
  if (value < 1_000_000)
    return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(1)}M`
}

/** Cost with enough precision to be meaningful for a single turn. */
export function formatCost(costUsd: number): string {
  if (costUsd === 0) return "$0"
  if (costUsd < 0.01) return `$${costUsd.toFixed(4)}`
  return `$${costUsd.toFixed(2)}`
}

/** "1.2k in · 340 out · 80 cached · $0.0042", leaving out what is unknown. */
export function formatUsage(usage: Usage): string {
  const parts: string[] = []
  if (usage.inputTokens !== undefined) {
    parts.push(`${compact(usage.inputTokens)} in`)
  }
  if (usage.outputTokens !== undefined) {
    parts.push(`${compact(usage.outputTokens)} out`)
  }
  const cached = (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  if (cached > 0) parts.push(`${compact(cached)} cached`)
  if (usage.costUsd !== undefined) parts.push(formatCost(usage.costUsd))
  return parts.join(" · ")
}

/** Sums usage across turns; cost is summed only over turns that report it. */
export function sumUsage(usages: Usage[]): Usage | undefined {
  if (usages.length === 0) return undefined
  const total: Usage = {}
  for (const usage of usages) {
    for (const key of [
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
      "reasoningTokens",
      "costUsd",
    ] as const) {
      const value = usage[key]
      if (value !== undefined) total[key] = (total[key] ?? 0) + value
    }
  }
  return total
}

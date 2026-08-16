export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  const unbracketed =
    normalized.startsWith("[") && normalized.endsWith("]")
      ? normalized.slice(1, -1)
      : normalized
  if (unbracketed === "localhost" || unbracketed === "::1") {
    return true
  }
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(unbracketed)
}

export function loopbackOrigins(port: number): string[] {
  return [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ]
}

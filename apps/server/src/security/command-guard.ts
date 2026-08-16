import { timingSafeEqual } from "node:crypto"
import type { MiddlewareHandler } from "hono"

type CommandGuardOptions = {
  bearerToken: string
  allowedOrigins: string[]
}

function matchesBearerToken(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received, "utf8")
  const expectedBytes = Buffer.from(expected, "utf8")
  if (receivedBytes.length !== expectedBytes.length) {
    return false
  }
  return timingSafeEqual(receivedBytes, expectedBytes)
}

export function createCommandGuard(
  options: CommandGuardOptions
): MiddlewareHandler {
  return async (c, next) => {
    const authorization = c.req.header("Authorization")
    if (
      authorization === undefined ||
      !authorization.startsWith("Bearer ") ||
      !matchesBearerToken(
        authorization.slice("Bearer ".length),
        options.bearerToken
      )
    ) {
      return c.json({ error: "unauthorized" }, 401)
    }
    const origin = c.req.header("Origin")
    if (origin !== undefined && !options.allowedOrigins.includes(origin)) {
      return c.json({ error: "origin_not_allowed" }, 403)
    }
    await next()
  }
}

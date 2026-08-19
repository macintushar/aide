import { randomBytes } from "node:crypto"
import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

import { isLoopbackHost } from "./security/loopback"

if (process.env.AIDE_BEARER_TOKEN === undefined) {
  process.env.AIDE_BEARER_TOKEN = randomBytes(32).toString("hex")
}

export const env = createEnv({
  server: {
    HOST: z
      .string()
      .trim()
      .refine(isLoopbackHost, { error: "HOST must be a loopback address" })
      .default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    AIDE_BEARER_TOKEN: z.string().refine((value) => value.trim().length > 0, {
      error: "AIDE_BEARER_TOKEN must not be blank",
    }),
    DB_FILE_NAME: z
      .string()
      .refine((value) => value.trim().length > 0, {
        error: "DB_FILE_NAME must not be blank",
      })
      .default("./data/aide.sqlite"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})

import { randomBytes } from "node:crypto"
import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

if (process.env.AIDE_BEARER_TOKEN === undefined) {
  process.env.AIDE_BEARER_TOKEN = randomBytes(32).toString("hex")
}

export const env = createEnv({
  server: {
    HOST: z.string().min(1).default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    AIDE_BEARER_TOKEN: z.string().min(1),
    DB_FILE_NAME: z.string().min(1).default("./data/aide.sqlite"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})

import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

import { isLoopbackHost } from "./security/loopback"

export const env = createEnv({
  server: {
    HOST: z
      .string()
      .trim()
      .refine(isLoopbackHost, { error: "HOST must be a loopback address" })
      .default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
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

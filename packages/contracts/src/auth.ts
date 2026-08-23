import { z } from "zod"

import { timestampSchema } from "./primitives"

/**
 * A durable session credential issued by exchanging a bootstrap credential.
 * Bootstrap credentials never travel on data routes; this is what does.
 */
export const sessionCredentialSchema = z.object({
  sessionToken: z.string().min(1),
  expiresAt: timestampSchema,
})

export type SessionCredential = z.infer<typeof sessionCredentialSchema>

import { z } from "zod"

export const CONTRACTS_SCHEMA_VERSION = 1 as const

export const schemaVersionSchema = z.literal(CONTRACTS_SCHEMA_VERSION)

export const idSchema = z.string().min(1)

export const timestampSchema = z.iso.datetime()

export const driverIdSchema = z.enum(["opencode", "claudeAgent"])

export type DriverId = z.infer<typeof driverIdSchema>

export const selectOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  isDefault: z.boolean().optional(),
})

export type SelectOption = z.infer<typeof selectOptionSchema>

export const optionDescriptorSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.literal("select"),
  options: z.array(selectOptionSchema),
  defaultValue: z.string().optional(),
})

export type OptionDescriptor = z.infer<typeof optionDescriptorSchema>

export const aideErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  instanceId: z.string().min(1).optional(),
  retryable: z.boolean(),
  detail: z.unknown().optional(),
})

export type AideError = z.infer<typeof aideErrorSchema>

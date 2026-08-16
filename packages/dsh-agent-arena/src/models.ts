import { z } from 'zod'

const identifier = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
const timestamp = z.string().datetime()

export const ContestantSchema = z.object({
  id: identifier,
  label: z.string().trim().min(1).max(80),
  provider: z.string().trim().min(1).max(160),
  model: z.string().trim().min(1).max(240),
}).strict()

export const ValidationCommandSchema = z.object({
  command: z.string().trim().min(1).max(400),
  weight: z.number().positive().max(100).default(1),
  timeoutMs: z.number().int().min(1_000).max(900_000).default(300_000),
}).strict()

export const ArenaConfigSchema = z.object({
  objective: z.string().trim().min(1).max(12_000),
  repository: z.string().trim().min(1).max(4_096),
  contestants: z.array(ContestantSchema).min(2).max(4).superRefine((items, ctx) => {
    if (new Set(items.map(item => item.id)).size !== items.length) ctx.addIssue({ code: 'custom', message: 'Contestant ids must be unique.' })
  }),
  validation: z.array(ValidationCommandSchema).min(1).max(12),
  keepWorktrees: z.boolean().default(false),
}).strict()

export const ArenaStatusSchema = z.enum(['queued', 'preparing', 'running', 'validating', 'scoring', 'completed', 'cancelled', 'failed'])
export const ContestantStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled'])
export const ArenaEventSchema = z.object({
  at: timestamp,
  type: z.string().min(1).max(80),
  message: z.string().max(2_000),
  contestantId: identifier.optional(),
}).strict()
export const ValidationResultSchema = z.object({
  command: z.string().max(400),
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  output: z.string().max(80_000),
  weight: z.number().positive().max(100),
}).strict()
export const ContestantResultSchema = z.object({
  contestant: ContestantSchema,
  worktree: z.string().max(4_096),
  status: ContestantStatusSchema,
  diff: z.string().max(1_000_000),
  changedFiles: z.array(z.string().max(4_096)).max(10_000),
  validations: z.array(ValidationResultSchema).max(12),
  score: z.number().min(0).max(100),
  error: z.string().max(4_000).optional(),
}).strict()
export const ArenaMatchSchema = z.object({
  id: z.string().uuid(),
  config: ArenaConfigSchema,
  status: ArenaStatusSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
  events: z.array(ArenaEventSchema).max(10_000),
  contestants: z.array(ContestantResultSchema).min(2).max(4),
  winnerId: identifier.optional(),
  baseRevision: z.string().regex(/^[a-f0-9]{40,64}$/i).optional(),
  appliedRevision: z.string().regex(/^[a-f0-9]{40,64}$/i).optional(),
  error: z.string().max(4_000).optional(),
}).strict()

export type Contestant = z.infer<typeof ContestantSchema>
export type ValidationCommand = z.infer<typeof ValidationCommandSchema>
export type ArenaConfig = z.infer<typeof ArenaConfigSchema>
export type ArenaStatus = z.infer<typeof ArenaStatusSchema>
export type ArenaEvent = z.infer<typeof ArenaEventSchema>
export type ValidationResult = z.infer<typeof ValidationResultSchema>
export type ContestantResult = z.infer<typeof ContestantResultSchema>
export type ArenaMatch = z.infer<typeof ArenaMatchSchema>

export const StartRequestSchema = ArenaConfigSchema
export const CancelRequestSchema = z.object({ id: z.string().uuid() }).strict()
export const ApplyRequestSchema = CancelRequestSchema
export const ListRequestSchema = z.object({ limit: z.number().int().min(1).max(100) }).strict()

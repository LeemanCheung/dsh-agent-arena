import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import { Domain } from "@deepseek-ai/dsh-storage-domain";
import { Context } from "@deepseek-ai/cordis";
import { AgentRegistry } from "@deepseek-ai/dsh-agent";
import { SubprocessRuntime } from "@deepseek-ai/dsh-subprocess";
//#region src/models.d.ts
declare const ContestantSchema: z.ZodObject<{
  id: z.ZodString;
  label: z.ZodString;
  provider: z.ZodString;
  model: z.ZodString;
}, z.core.$strict>;
declare const ValidationCommandSchema: z.ZodObject<{
  command: z.ZodString;
  weight: z.ZodDefault<z.ZodNumber>;
  timeoutMs: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
declare const ArenaConfigSchema: z.ZodObject<{
  objective: z.ZodString;
  repository: z.ZodString;
  contestants: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    label: z.ZodString;
    provider: z.ZodString;
    model: z.ZodString;
  }, z.core.$strict>>;
  validation: z.ZodArray<z.ZodObject<{
    command: z.ZodString;
    weight: z.ZodDefault<z.ZodNumber>;
    timeoutMs: z.ZodDefault<z.ZodNumber>;
  }, z.core.$strict>>;
  keepWorktrees: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
declare const ArenaStatusSchema: z.ZodEnum<{
  queued: "queued";
  preparing: "preparing";
  running: "running";
  validating: "validating";
  scoring: "scoring";
  completed: "completed";
  cancelled: "cancelled";
  failed: "failed";
}>;
declare const ContestantStatusSchema: z.ZodEnum<{
  running: "running";
  completed: "completed";
  cancelled: "cancelled";
  failed: "failed";
  pending: "pending";
}>;
declare const ArenaEventSchema: z.ZodObject<{
  at: z.ZodString;
  type: z.ZodString;
  message: z.ZodString;
  contestantId: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
declare const ValidationResultSchema: z.ZodObject<{
  command: z.ZodString;
  exitCode: z.ZodNumber;
  durationMs: z.ZodNumber;
  output: z.ZodString;
  weight: z.ZodNumber;
}, z.core.$strict>;
declare const ContestantResultSchema: z.ZodObject<{
  contestant: z.ZodObject<{
    id: z.ZodString;
    label: z.ZodString;
    provider: z.ZodString;
    model: z.ZodString;
  }, z.core.$strict>;
  worktree: z.ZodString;
  status: z.ZodEnum<{
    running: "running";
    completed: "completed";
    cancelled: "cancelled";
    failed: "failed";
    pending: "pending";
  }>;
  diff: z.ZodString;
  changedFiles: z.ZodArray<z.ZodString>;
  validations: z.ZodArray<z.ZodObject<{
    command: z.ZodString;
    exitCode: z.ZodNumber;
    durationMs: z.ZodNumber;
    output: z.ZodString;
    weight: z.ZodNumber;
  }, z.core.$strict>>;
  score: z.ZodNumber;
  error: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
declare const ArenaMatchSchema: z.ZodObject<{
  id: z.ZodString;
  config: z.ZodObject<{
    objective: z.ZodString;
    repository: z.ZodString;
    contestants: z.ZodArray<z.ZodObject<{
      id: z.ZodString;
      label: z.ZodString;
      provider: z.ZodString;
      model: z.ZodString;
    }, z.core.$strict>>;
    validation: z.ZodArray<z.ZodObject<{
      command: z.ZodString;
      weight: z.ZodDefault<z.ZodNumber>;
      timeoutMs: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
    keepWorktrees: z.ZodDefault<z.ZodBoolean>;
  }, z.core.$strict>;
  status: z.ZodEnum<{
    queued: "queued";
    preparing: "preparing";
    running: "running";
    validating: "validating";
    scoring: "scoring";
    completed: "completed";
    cancelled: "cancelled";
    failed: "failed";
  }>;
  createdAt: z.ZodString;
  updatedAt: z.ZodString;
  events: z.ZodArray<z.ZodObject<{
    at: z.ZodString;
    type: z.ZodString;
    message: z.ZodString;
    contestantId: z.ZodOptional<z.ZodString>;
  }, z.core.$strict>>;
  contestants: z.ZodArray<z.ZodObject<{
    contestant: z.ZodObject<{
      id: z.ZodString;
      label: z.ZodString;
      provider: z.ZodString;
      model: z.ZodString;
    }, z.core.$strict>;
    worktree: z.ZodString;
    status: z.ZodEnum<{
      running: "running";
      completed: "completed";
      cancelled: "cancelled";
      failed: "failed";
      pending: "pending";
    }>;
    diff: z.ZodString;
    changedFiles: z.ZodArray<z.ZodString>;
    validations: z.ZodArray<z.ZodObject<{
      command: z.ZodString;
      exitCode: z.ZodNumber;
      durationMs: z.ZodNumber;
      output: z.ZodString;
      weight: z.ZodNumber;
    }, z.core.$strict>>;
    score: z.ZodNumber;
    error: z.ZodOptional<z.ZodString>;
  }, z.core.$strict>>;
  winnerId: z.ZodOptional<z.ZodString>;
  baseRevision: z.ZodOptional<z.ZodString>;
  appliedRevision: z.ZodOptional<z.ZodString>;
  error: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
type Contestant = z.infer<typeof ContestantSchema>;
type ValidationCommand = z.infer<typeof ValidationCommandSchema>;
type ArenaConfig = z.infer<typeof ArenaConfigSchema>;
type ArenaStatus = z.infer<typeof ArenaStatusSchema>;
type ArenaEvent = z.infer<typeof ArenaEventSchema>;
type ValidationResult = z.infer<typeof ValidationResultSchema>;
type ContestantResult = z.infer<typeof ContestantResultSchema>;
type ArenaMatch = z.infer<typeof ArenaMatchSchema>;
declare const StartRequestSchema: z.ZodObject<{
  objective: z.ZodString;
  repository: z.ZodString;
  contestants: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    label: z.ZodString;
    provider: z.ZodString;
    model: z.ZodString;
  }, z.core.$strict>>;
  validation: z.ZodArray<z.ZodObject<{
    command: z.ZodString;
    weight: z.ZodDefault<z.ZodNumber>;
    timeoutMs: z.ZodDefault<z.ZodNumber>;
  }, z.core.$strict>>;
  keepWorktrees: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
declare const CancelRequestSchema: z.ZodObject<{
  id: z.ZodString;
}, z.core.$strict>;
declare const ApplyRequestSchema: z.ZodObject<{
  id: z.ZodString;
}, z.core.$strict>;
declare const ListRequestSchema: z.ZodObject<{
  limit: z.ZodNumber;
}, z.core.$strict>;
//#endregion
//#region src/adapters.d.ts
declare class ArenaCapabilityError extends Error {
  constructor(capability: string);
}
interface CommandResult {
  code: number;
  output: string;
  durationMs: number;
  truncated: boolean;
}
interface ArenaExecutor {
  assertClean(repo: string): Promise<void>;
  createWorktree(repo: string, matchId: string, contestantId: string): Promise<string>;
  runContestant(result: ContestantResult, objective: string, signal: AbortSignal): Promise<void>;
  validate(worktree: string, config: ArenaConfig, signal: AbortSignal): Promise<ValidationResult[]>;
  diff(worktree: string): Promise<{
    diff: string;
    changedFiles: string[];
  }>;
  checkpoint(repo: string): Promise<string>;
  apply(repo: string, worktree: string): Promise<void>;
  cleanup(worktree: string, repository?: string): Promise<void>;
}
declare class DshAgentRunner {
  private readonly agents;
  constructor(agents: AgentRegistry);
  run(result: ContestantResult, objective: string, signal: AbortSignal): Promise<void>;
}
/** Git isolation and deterministic validation over DSH-managed process trees. */
declare class GitWorktreeExecutor implements ArenaExecutor {
  private readonly subprocess;
  private readonly runner;
  private readonly worktreeRoot;
  private readonly repositories;
  constructor(subprocess: SubprocessRuntime, runner: DshAgentRunner, worktreeRoot?: string);
  assertClean(repo: string): Promise<void>;
  createWorktree(repo: string, matchId: string, contestantId: string): Promise<string>;
  runContestant(result: ContestantResult, objective: string, signal: AbortSignal): Promise<void>;
  validate(worktree: string, config: ArenaConfig, signal: AbortSignal): Promise<ValidationResult[]>;
  diff(worktree: string): Promise<{
    diff: string;
    changedFiles: string[];
  }>;
  checkpoint(repo: string): Promise<string>;
  apply(repo: string, worktree: string): Promise<void>;
  cleanup(worktree: string, repository?: string): Promise<void>;
  private run;
}
declare function worktreeLabel(path: string): string;
//#endregion
//#region src/scoring.d.ts
/** Deterministic weighted pass rate, rounded to one decimal place. */
declare function scoreContestant(result: ContestantResult): number;
//#endregion
//#region src/arena-service.d.ts
interface ArenaStore {
  load(): Promise<ArenaMatch[]>;
  save(matches: ArenaMatch[]): Promise<void>;
}
declare class MemoryArenaStore implements ArenaStore {
  private value;
  load(): Promise<ArenaMatch[]>;
  save(matches: ArenaMatch[]): Promise<void>;
}
interface ArenaServiceOptions {
  executor: ArenaExecutor;
  store?: ArenaStore;
}
declare class ArenaService extends TypertRemoteService {
  private readonly executor;
  private readonly store;
  private readonly matches;
  private readonly controllers;
  private readonly runs;
  constructor(ctx: Context, options: ArenaServiceOptions);
  hydrate(): Promise<void>;
  list(limit: number): Promise<ArenaMatch[]>;
  get(id: string): Promise<ArenaMatch>;
  start(input: ArenaConfig): Promise<ArenaMatch>;
  shutdown(): Promise<void>;
  cancel(id: string): Promise<ArenaMatch>;
  applyWinner(id: string): Promise<ArenaMatch>;
  private requireMatch;
  private persist;
  private run;
  private runContestant;
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    agentArena: ArenaService;
  }
}
//#endregion
//#region src/state.d.ts
declare function isTerminal(status: ArenaStatus): status is "completed" | "cancelled" | "failed";
declare function canCancel(status: ArenaStatus): status is "preparing" | "running" | "validating" | "scoring";
//#endregion
//#region src/storage.d.ts
declare const arenaDomainSpec: {
  name: string;
  version: number;
  tables: {
    matches: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
      id: string;
      config: {
        objective: string;
        repository: string;
        contestants: {
          id: string;
          label: string;
          provider: string;
          model: string;
        }[];
        validation: {
          command: string;
          weight: number;
          timeoutMs: number;
        }[];
        keepWorktrees: boolean;
      };
      status: "queued" | "preparing" | "running" | "validating" | "scoring" | "completed" | "cancelled" | "failed";
      createdAt: string;
      updatedAt: string;
      events: {
        at: string;
        type: string;
        message: string;
        contestantId?: string | undefined;
      }[];
      contestants: {
        contestant: {
          id: string;
          label: string;
          provider: string;
          model: string;
        };
        worktree: string;
        status: "running" | "completed" | "cancelled" | "failed" | "pending";
        diff: string;
        changedFiles: string[];
        validations: {
          command: string;
          exitCode: number;
          durationMs: number;
          output: string;
          weight: number;
        }[];
        score: number;
        error?: string | undefined;
      }[];
      winnerId?: string | undefined;
      baseRevision?: string | undefined;
      appliedRevision?: string | undefined;
      error?: string | undefined;
    }>;
  };
};
declare class StorageArenaStore implements ArenaStore {
  private readonly domain;
  constructor(domain: Domain<typeof arenaDomainSpec>);
  load(): Promise<ArenaMatch[]>;
  save(matches: ArenaMatch[]): Promise<void>;
}
//#endregion
//#region src/index.d.ts
declare const inject: string[];
declare function apply(ctx: Context): Promise<void>;
//#endregion
export { ApplyRequestSchema, ArenaCapabilityError, ArenaConfig, ArenaConfigSchema, ArenaEvent, ArenaEventSchema, ArenaExecutor, ArenaMatch, ArenaMatchSchema, ArenaService, ArenaServiceOptions, ArenaStatus, ArenaStatusSchema, ArenaStore, CancelRequestSchema, CommandResult, Contestant, ContestantResult, ContestantResultSchema, ContestantSchema, ContestantStatusSchema, DshAgentRunner, GitWorktreeExecutor, ListRequestSchema, MemoryArenaStore, StartRequestSchema, StorageArenaStore, ValidationCommand, ValidationCommandSchema, ValidationResult, ValidationResultSchema, apply, arenaDomainSpec, canCancel, inject, isTerminal, scoreContestant, worktreeLabel };
//# sourceMappingURL=index.d.ts.map
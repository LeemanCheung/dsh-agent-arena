import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
//#region src/adapters.ts
var ArenaCapabilityError = class extends Error {
	constructor(capability) {
		super(`ARENA_ADAPTER_UNAVAILABLE: ${capability}`);
		this.name = "ArenaCapabilityError";
	}
};
function validationArgv(command) {
	if (/['"`;&|<>$\r\n]/u.test(command)) throw new Error(`Validation command contains unsupported shell syntax: ${command}`);
	const argv = command.trim().split(/\s+/u);
	if (argv.length === 0 || argv[0] === void 0) throw new Error("Validation command is empty.");
	return argv;
}
var DshAgentRunner = class {
	agents;
	constructor(agents) {
		this.agents = agents;
	}
	async run(result, objective, signal) {
		const handle = await this.agents.create({
			sessionId: SessionId(`arena-${randomUUID()}`),
			meta: {
				cwd: result.worktree,
				origin: "subagent"
			},
			agentOptions: {
				provider: result.contestant.provider,
				model: result.contestant.model
			},
			signal
		});
		try {
			await handle.agent.whenIdle();
			handle.agent.followup(createUserMessage({
				content: [{
					type: "text",
					text: objective
				}],
				source: {
					kind: "plugin",
					plugin: "dsh-agent-arena"
				}
			}));
			await handle.agent.whenIdle();
			if (signal.aborted) throw signal.reason;
		} finally {
			await handle.dispose();
		}
	}
};
/** Git isolation and deterministic validation over DSH-managed process trees. */
var GitWorktreeExecutor = class {
	subprocess;
	runner;
	worktreeRoot;
	repositories = /* @__PURE__ */ new Map();
	constructor(subprocess, runner, worktreeRoot = resolve(tmpdir(), "dsh-agent-arena")) {
		this.subprocess = subprocess;
		this.runner = runner;
		this.worktreeRoot = worktreeRoot;
	}
	async assertClean(repo) {
		const repository = resolve(repo);
		const result = await this.run(repository, [
			"git",
			"status",
			"--porcelain=v1"
		], void 0, 3e4);
		if (result.code !== 0) throw new Error(`Git status failed: ${result.output}`);
		if (result.output.trim().length > 0) throw new Error("Repository must be clean before an Arena match.");
	}
	async createWorktree(repo, matchId, contestantId) {
		const repository = resolve(repo);
		const worktree = this.expectedWorktree(matchId, contestantId);
		const parent = resolve(worktree, "..");
		const realRoot = await this.ensureWorktreeRoot();
		try {
			if ((await lstat(parent)).isSymbolicLink()) throw new Error("Arena match directory cannot be a symbolic link or junction.");
			this.assertRealContained(realRoot, await realpath(parent), "Arena match directory escapes the worktree root.");
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		}
		await mkdir(parent, { recursive: true });
		this.assertRealContained(realRoot, await realpath(parent), "Arena match directory escapes the worktree root.");
		try {
			await lstat(worktree);
			throw new Error(`Arena contestant worktree destination already exists: ${worktree}`);
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		}
		const result = await this.run(repository, [
			"git",
			"worktree",
			"add",
			"--detach",
			worktree,
			"HEAD"
		], void 0, 6e4);
		if (result.code !== 0) throw new Error(`Worktree create failed: ${result.output}`);
		this.repositories.set(worktree, repository);
		return worktree;
	}
	async runContestant(result, objective, signal) {
		await this.runner.run(result, objective, signal);
	}
	async validate(worktree, config, signal) {
		const results = [];
		for (const item of config.validation) {
			const result = await this.run(worktree, validationArgv(item.command), signal, item.timeoutMs);
			results.push({
				command: item.command,
				exitCode: result.code,
				durationMs: result.durationMs,
				output: result.output,
				weight: item.weight
			});
		}
		return results;
	}
	async diff(worktree) {
		const intent = await this.run(worktree, [
			"git",
			"add",
			"-N",
			"--",
			"."
		], void 0, 6e4);
		if (intent.code !== 0) throw new Error(`Could not stage intent-to-add entries: ${intent.output}`);
		const patch = await this.run(worktree, [
			"git",
			"diff",
			"HEAD",
			"--no-ext-diff",
			"--binary"
		], void 0, 6e4, void 0, 1e6);
		const names = await this.run(worktree, [
			"git",
			"diff",
			"HEAD",
			"--name-only"
		], void 0, 6e4);
		if (patch.code !== 0 || names.code !== 0) throw new Error("Could not collect Git diff.");
		if (patch.truncated) throw new Error("Contestant patch exceeds the 1 MB Arena review limit.");
		if (names.truncated) throw new Error("Changed-file list exceeds the Arena output limit.");
		return {
			diff: patch.output,
			changedFiles: names.output.trim().length === 0 ? [] : names.output.trim().split(/\r?\n/u)
		};
	}
	async checkpoint(repo) {
		const result = await this.run(resolve(repo), [
			"git",
			"rev-parse",
			"HEAD"
		], void 0, 3e4);
		if (result.code !== 0) throw new Error(result.output);
		return result.output.trim();
	}
	async apply(repo, worktree) {
		const patch = await this.run(worktree, [
			"git",
			"diff",
			"HEAD",
			"--binary"
		], void 0, 6e4, void 0, 1e6);
		if (patch.code !== 0) throw new Error(patch.output);
		if (patch.truncated) throw new Error("Winner patch exceeds the 1 MB Arena apply limit.");
		if (patch.output.length === 0) throw new Error("Winner produced no Git diff.");
		const check = await this.run(resolve(repo), [
			"git",
			"apply",
			"--check",
			"--whitespace=error",
			"-"
		], void 0, 6e4, patch.output);
		if (check.code !== 0) throw new Error(`Winner patch check failed: ${check.output}`);
		const applied = await this.run(resolve(repo), [
			"git",
			"apply",
			"--index",
			"--whitespace=error",
			"-"
		], void 0, 6e4, patch.output);
		if (applied.code !== 0) throw new Error(`Winner apply failed: ${applied.output}`);
	}
	async cleanup(worktree, repository) {
		const target = await this.cleanupTarget(worktree);
		if (target === void 0) return;
		const owner = this.repositories.get(target) ?? (repository === void 0 ? void 0 : resolve(repository));
		if (owner !== void 0) {
			await this.run(owner, [
				"git",
				"worktree",
				"remove",
				"--force",
				target
			], void 0, 6e4).catch(() => void 0);
			this.repositories.delete(target);
		}
		await rm(target, {
			recursive: true,
			force: true
		});
	}
	async cleanupTarget(worktree) {
		const root = resolve(this.worktreeRoot);
		const target = resolve(worktree);
		const rel = relative(root, target);
		const parts = rel.split(sep);
		if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || parts.length !== 2 || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(parts[0] ?? "") || !/^[a-z0-9][a-z0-9-]{0,31}$/u.test(parts[1] ?? "")) throw new Error(`Refusing to clean a path outside the Arena worktree root: ${worktree}`);
		let rootInfo;
		try {
			rootInfo = await lstat(root);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return void 0;
			throw error;
		}
		if (rootInfo.isSymbolicLink()) throw new Error("Refusing cleanup because the Arena worktree root is a symbolic link or junction.");
		try {
			if ((await lstat(target)).isSymbolicLink()) throw new Error(`Refusing to clean a symbolic-link worktree: ${worktree}`);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return void 0;
			throw error;
		}
		const realRoot = await realpath(root);
		const realTarget = await realpath(target);
		this.assertRealContained(realRoot, realTarget, `Refusing to clean a path outside the Arena worktree root: ${worktree}`);
		return target;
	}
	expectedWorktree(matchId, contestantId) {
		if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(matchId) || !/^[a-z0-9][a-z0-9-]{0,31}$/u.test(contestantId)) throw new Error("Invalid Arena match or contestant identity.");
		return resolve(this.worktreeRoot, matchId, contestantId);
	}
	async ensureWorktreeRoot() {
		const root = resolve(this.worktreeRoot);
		await mkdir(root, { recursive: true });
		if ((await lstat(root)).isSymbolicLink()) throw new Error("Arena worktree root cannot be a symbolic link or junction.");
		return realpath(root);
	}
	assertRealContained(realRoot, realTarget, message) {
		const rel = relative(realRoot, realTarget);
		if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(message);
	}
	async run(cwd, argv, signal, timeoutMs, stdin, outputLimit = 8e4) {
		const started = Date.now();
		const timeout = AbortSignal.timeout(timeoutMs);
		const combined = signal === void 0 ? timeout : AbortSignal.any([signal, timeout]);
		const child = this.subprocess.spawn({
			argv,
			cwd,
			stdio: {
				stdin: stdin === void 0 ? "ignore" : { data: stdin },
				stdout: { maxBytes: outputLimit },
				stderr: { maxBytes: outputLimit }
			},
			graceMs: 2e3,
			signal: combined
		});
		const outcome = await child.done;
		const stdout = child.collected.stdout?.readFrom(0);
		const stderr = child.collected.stderr?.readFrom(0);
		if (timeout.aborted && !signal?.aborted) throw new Error(`Command timed out after ${timeoutMs} ms: ${argv[0]}`);
		if (signal?.aborted) throw signal.reason;
		const truncated = stdout?.lossy === true || stderr?.lossy === true;
		const output = `${stdout?.text ?? ""}${stderr?.text ?? ""}`.slice(-outputLimit);
		return {
			code: outcome.exitCode ?? -1,
			output,
			durationMs: Date.now() - started,
			truncated
		};
	}
};
function worktreeLabel(path) {
	return basename(path);
}
//#endregion
//#region src/models.ts
const identifier = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
const timestamp = z.string().datetime();
const ContestantSchema = z.object({
	id: identifier,
	label: z.string().trim().min(1).max(80),
	provider: z.string().trim().min(1).max(160),
	model: z.string().trim().min(1).max(240)
}).strict();
const ValidationCommandSchema = z.object({
	command: z.string().trim().min(1).max(400),
	weight: z.number().positive().max(100).default(1),
	timeoutMs: z.number().int().min(1e3).max(9e5).default(3e5)
}).strict();
const ArenaConfigSchema = z.object({
	objective: z.string().trim().min(1).max(12e3),
	repository: z.string().trim().min(1).max(4096),
	contestants: z.array(ContestantSchema).min(2).max(4).superRefine((items, ctx) => {
		if (new Set(items.map((item) => item.id)).size !== items.length) ctx.addIssue({
			code: "custom",
			message: "Contestant ids must be unique."
		});
	}),
	validation: z.array(ValidationCommandSchema).min(1).max(12),
	keepWorktrees: z.boolean().default(false)
}).strict();
const ArenaStatusSchema = z.enum([
	"queued",
	"preparing",
	"running",
	"validating",
	"scoring",
	"completed",
	"cancelled",
	"failed"
]);
const ContestantStatusSchema = z.enum([
	"pending",
	"running",
	"completed",
	"failed",
	"cancelled"
]);
const ArenaEventSchema = z.object({
	at: timestamp,
	type: z.string().min(1).max(80),
	message: z.string().max(2e3),
	contestantId: identifier.optional()
}).strict();
const ValidationResultSchema = z.object({
	command: z.string().max(400),
	exitCode: z.number().int(),
	durationMs: z.number().int().nonnegative(),
	output: z.string().max(8e4),
	weight: z.number().positive().max(100)
}).strict();
const ContestantResultSchema = z.object({
	contestant: ContestantSchema,
	worktree: z.string().max(4096),
	status: ContestantStatusSchema,
	diff: z.string().max(1e6),
	changedFiles: z.array(z.string().max(4096)).max(1e4),
	validations: z.array(ValidationResultSchema).max(12),
	score: z.number().min(0).max(100),
	error: z.string().max(4e3).optional()
}).strict();
const ArenaMatchSchema = z.object({
	id: z.string().uuid(),
	config: ArenaConfigSchema,
	status: ArenaStatusSchema,
	createdAt: timestamp,
	updatedAt: timestamp,
	events: z.array(ArenaEventSchema).max(1e4),
	contestants: z.array(ContestantResultSchema).min(2).max(4),
	winnerId: identifier.optional(),
	baseRevision: z.string().regex(/^[a-f0-9]{40,64}$/i).optional(),
	appliedRevision: z.string().regex(/^[a-f0-9]{40,64}$/i).optional(),
	error: z.string().max(4e3).optional()
}).strict();
/** No generic command can prove an arbitrary repository is correct; users must choose project-specific checks. */
const DEFAULT_VALIDATION_COMMANDS = [];
const StartRequestSchema = ArenaConfigSchema;
const CancelRequestSchema = z.object({ id: z.string().uuid() }).strict();
const ApplyRequestSchema = CancelRequestSchema;
const ListRequestSchema = z.object({ limit: z.number().int().min(1).max(100) }).strict();
//#endregion
//#region src/scoring.ts
/** Deterministic weighted pass rate, rounded to one decimal place. */
function scoreContestant(result) {
	const total = result.validations.reduce((sum, item) => sum + item.weight, 0);
	const passed = result.validations.filter((item) => item.exitCode === 0).reduce((sum, item) => sum + item.weight, 0);
	return total === 0 ? 0 : Math.round(passed / total * 1e3) / 10;
}
//#endregion
//#region src/state.ts
function isTerminal(status) {
	return status === "completed" || status === "cancelled" || status === "failed";
}
function canCancel(status) {
	return status === "preparing" || status === "running" || status === "validating" || status === "scoring";
}
//#endregion
//#region src/arena-service.ts
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) {
			if (kind === "field") initializers.unshift(_);
			else descriptor[key] = _;
		}
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
var MemoryArenaStore = class {
	value = [];
	async load() {
		return structuredClone(this.value);
	}
	async save(matches) {
		this.value = structuredClone(matches);
	}
};
function now() {
	return (/* @__PURE__ */ new Date()).toISOString();
}
function appendEvent(match, type, message, contestantId) {
	const item = {
		at: now(),
		type,
		message,
		...contestantId === void 0 ? {} : { contestantId }
	};
	match.events.push(item);
	match.updatedAt = item.at;
}
let ArenaService = (() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _list_decorators;
	let _get_decorators;
	let _start_decorators;
	let _cancel_decorators;
	let _applyWinner_decorators;
	return class ArenaService extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_list_decorators = [Remote("list")];
			_get_decorators = [Remote("get")];
			_start_decorators = [Remote("start")];
			_cancel_decorators = [Remote("cancel")];
			_applyWinner_decorators = [Remote("applyWinner")];
			__esDecorate(this, null, _list_decorators, {
				kind: "method",
				name: "list",
				static: false,
				private: false,
				access: {
					has: (obj) => "list" in obj,
					get: (obj) => obj.list
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _get_decorators, {
				kind: "method",
				name: "get",
				static: false,
				private: false,
				access: {
					has: (obj) => "get" in obj,
					get: (obj) => obj.get
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _start_decorators, {
				kind: "method",
				name: "start",
				static: false,
				private: false,
				access: {
					has: (obj) => "start" in obj,
					get: (obj) => obj.start
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _cancel_decorators, {
				kind: "method",
				name: "cancel",
				static: false,
				private: false,
				access: {
					has: (obj) => "cancel" in obj,
					get: (obj) => obj.cancel
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _applyWinner_decorators, {
				kind: "method",
				name: "applyWinner",
				static: false,
				private: false,
				access: {
					has: (obj) => "applyWinner" in obj,
					get: (obj) => obj.applyWinner
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		executor = __runInitializers(this, _instanceExtraInitializers);
		store;
		matches = /* @__PURE__ */ new Map();
		controllers = /* @__PURE__ */ new Map();
		runs = /* @__PURE__ */ new Map();
		constructor(ctx, options) {
			super(ctx, "agentArena");
			this.executor = options.executor;
			this.store = options.store ?? new MemoryArenaStore();
		}
		async hydrate() {
			let changed = false;
			for (const match of await this.store.load()) {
				if (match.status === "queued" || canCancel(match.status)) {
					match.status = "failed";
					match.error = "Arena Host restarted before this match completed.";
					appendEvent(match, "failed", match.error);
					for (const result of match.contestants) {
						if (result.worktree.length === 0) continue;
						await this.executor.cleanup(result.worktree, match.config.repository).catch((error) => {
							appendEvent(match, "cleanup-failed", error instanceof Error ? error.message : String(error), result.contestant.id);
						});
						result.worktree = "";
					}
					changed = true;
				}
				this.matches.set(match.id, match);
			}
			if (changed) await this.persist();
		}
		async list(limit) {
			const bounded = Math.max(1, Math.min(100, limit));
			return [...this.matches.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, bounded).map((match) => structuredClone(match));
		}
		async get(id) {
			const match = this.matches.get(id);
			if (match === void 0) throw new Error(`Arena match not found: ${id}`);
			return structuredClone(match);
		}
		async start(input) {
			const config = ArenaConfigSchema.parse(input);
			const id = randomUUID();
			const createdAt = now();
			const match = {
				id,
				config,
				status: "queued",
				createdAt,
				updatedAt: createdAt,
				events: [],
				contestants: config.contestants.map((contestant) => ({
					contestant,
					worktree: "",
					status: "pending",
					diff: "",
					changedFiles: [],
					validations: [],
					score: 0
				}))
			};
			this.matches.set(id, match);
			await this.persist();
			const running = this.run(match);
			this.runs.set(match.id, running);
			running.then(() => {
				this.runs.delete(match.id);
			}, () => {
				this.runs.delete(match.id);
			});
			return structuredClone(match);
		}
		async shutdown() {
			for (const controller of this.controllers.values()) controller.abort("Arena service is stopping.");
			await Promise.allSettled(this.runs.values());
		}
		async cancel(id) {
			const match = this.requireMatch(id);
			const controller = this.controllers.get(id);
			if (controller !== void 0 && canCancel(match.status)) {
				controller.abort();
				appendEvent(match, "cancel-requested", "Cancellation requested.");
				await this.persist();
			}
			return structuredClone(match);
		}
		async applyWinner(id) {
			const match = this.requireMatch(id);
			if (match.status !== "completed" || match.winnerId === void 0) throw new Error("Only a completed match with a winner can be applied.");
			const winner = match.contestants.find((item) => item.contestant.id === match.winnerId);
			if (winner === void 0) throw new Error("Winner record is unavailable.");
			await this.executor.assertClean(match.config.repository);
			const currentRevision = await this.executor.checkpoint(match.config.repository);
			if (match.baseRevision === void 0 || currentRevision !== match.baseRevision) throw new Error("Repository HEAD changed after this match started; rerun the match before applying a winner.");
			await this.executor.apply(match.config.repository, winner.worktree);
			match.appliedRevision = currentRevision;
			appendEvent(match, "winner-applied", `Applied ${winner.contestant.label} at checkpoint ${currentRevision}.`, winner.contestant.id);
			if (!match.config.keepWorktrees) {
				await this.executor.cleanup(winner.worktree, match.config.repository);
				winner.worktree = "";
			}
			await this.persist();
			return structuredClone(match);
		}
		requireMatch(id) {
			const match = this.matches.get(id);
			if (match === void 0) throw new Error(`Arena match not found: ${id}`);
			return match;
		}
		async persist() {
			await this.store.save([...this.matches.values()]);
		}
		async run(match) {
			const controller = new AbortController();
			this.controllers.set(match.id, controller);
			try {
				match.status = "preparing";
				appendEvent(match, "preparing", "Checking clean Git repository.");
				await this.executor.assertClean(match.config.repository);
				match.baseRevision = await this.executor.checkpoint(match.config.repository);
				for (const result of match.contestants) {
					result.worktree = await this.executor.createWorktree(match.config.repository, match.id, result.contestant.id);
					appendEvent(match, "worktree-ready", "Created isolated worktree.", result.contestant.id);
				}
				await this.persist();
				match.status = "running";
				await Promise.all(match.contestants.map((result) => this.runContestant(match, result, controller.signal)));
				if (controller.signal.aborted) {
					match.status = "cancelled";
					appendEvent(match, "cancelled", "All contestants were stopped.");
					return;
				}
				match.status = "scoring";
				const candidates = match.contestants.filter((item) => item.status === "completed").sort((left, right) => right.score - left.score || left.contestant.id.localeCompare(right.contestant.id));
				if (candidates[0] === void 0) delete match.winnerId;
				else match.winnerId = candidates[0].contestant.id;
				match.status = candidates.length === 0 ? "failed" : "completed";
				appendEvent(match, match.status, candidates.length === 0 ? "No contestant completed successfully." : "Deterministic scoring completed.");
			} catch (error) {
				match.status = controller.signal.aborted ? "cancelled" : "failed";
				match.error = error instanceof Error ? error.message : String(error);
				appendEvent(match, match.status, match.error);
			} finally {
				this.controllers.delete(match.id);
				await this.persist();
				if (!match.config.keepWorktrees) {
					const retainedWinner = match.status === "completed" && match.appliedRevision === void 0 ? match.winnerId : void 0;
					await Promise.all(match.contestants.filter((result) => result.worktree.length > 0 && result.contestant.id !== retainedWinner).map(async (result) => {
						await this.executor.cleanup(result.worktree, match.config.repository).catch(() => void 0);
						result.worktree = "";
					}));
					await this.persist();
				}
			}
		}
		async runContestant(match, result, signal) {
			result.status = "running";
			appendEvent(match, "contestant-started", `${result.contestant.label} started.`, result.contestant.id);
			try {
				await this.executor.runContestant(result, match.config.objective, signal);
				if (signal.aborted) {
					result.status = "cancelled";
					return;
				}
				match.status = "validating";
				result.validations = await this.executor.validate(result.worktree, match.config, signal);
				const diff = await this.executor.diff(result.worktree);
				result.diff = diff.diff;
				result.changedFiles = diff.changedFiles;
				result.score = scoreContestant(result);
				result.status = "completed";
				appendEvent(match, "contestant-finished", `${result.contestant.label} scored ${result.score}.`, result.contestant.id);
			} catch (error) {
				result.status = signal.aborted ? "cancelled" : "failed";
				result.error = error instanceof Error ? error.message : String(error);
				appendEvent(match, "contestant-failed", result.error, result.contestant.id);
			}
		}
	};
})();
//#endregion
//#region src/storage.ts
const arenaDomainSpec = defineDomain({
	name: "agent_arena",
	version: 1,
	tables: { matches: domainTable(ArenaMatchSchema) }
});
var StorageArenaStore = class {
	domain;
	constructor(domain) {
		this.domain = domain;
	}
	async load() {
		return [...this.domain.table("matches").entries()].map(([, match]) => structuredClone(match));
	}
	async save(matches) {
		const table = this.domain.table("matches");
		const retained = new Set(matches.map((match) => match.id));
		for (const [id] of table.entries()) if (!retained.has(id)) await table.delete(id);
		for (const match of matches) await table.put(match.id, structuredClone(match));
	}
};
//#endregion
//#region src/index.ts
const inject = [
	"agents",
	"subprocess",
	"storageDomain"
];
async function apply(ctx) {
	const domain = await ctx.storageDomain.open(arenaDomainSpec);
	const executor = new GitWorktreeExecutor(ctx.subprocess, new DshAgentRunner(ctx.agents));
	const arena = new ArenaService(ctx, {
		executor,
		store: new StorageArenaStore(domain)
	});
	await arena.hydrate();
	ctx.effect(() => async () => {
		await arena.shutdown();
		await domain.close();
	}, "agent-arena: stop matches and close durable domain");
}
//#endregion
export { ApplyRequestSchema, ArenaCapabilityError, ArenaConfigSchema, ArenaEventSchema, ArenaMatchSchema, ArenaService, ArenaStatusSchema, CancelRequestSchema, ContestantResultSchema, ContestantSchema, ContestantStatusSchema, DEFAULT_VALIDATION_COMMANDS, DshAgentRunner, GitWorktreeExecutor, ListRequestSchema, MemoryArenaStore, StartRequestSchema, StorageArenaStore, ValidationCommandSchema, ValidationResultSchema, apply, arenaDomainSpec, canCancel, inject, isTerminal, scoreContestant, worktreeLabel };

//# sourceMappingURL=index.js.map
# dsh-agent-arena

English | [中文](README.zh-CN.md)

A DSH coding arena for comparing 2–4 configured models in isolated Git worktrees, validating their changes deterministically, reviewing every diff, and explicitly applying one winner.

## Screenshot

![Agent Arena results and diff review](https://raw.githubusercontent.com/LeemanCheung/dsh-agent-arena/main/assets/screenshots/overview.png)

> Generated with GPT Image from the implemented Client layout and feature set; runtime appearance follows the active DSH theme and viewport.

## Execution and persistence

- Creates detached worktrees under the operating system temporary directory, outside the compared repository.
- Starts each contestant with the public `ctx.agents.create`, `SessionId`, `createUserMessage`, and `Agent.followup` APIs.
- Executes Git and validation argv through `ctx.subprocess.spawn`; a shell is never used and shell operators are rejected.
- Persists match reports through `storageDomain`. An interrupted nonterminal match is marked failed after Host restart.
- Polls the generated `agentArena` Remote namespace in Settings and supports Start, Cancel, diff review, and Apply winner without browser globals.

## Scoring and application

Each validation has a positive weight. A contestant score is the percentage of total validation weight that exits successfully; score ties use contestant id as a stable deterministic tie-breaker. No LLM judge is used.

A match requires clean `git status --porcelain=v1` before worktrees are created. The winner worktree remains available until explicit application. Apply repeats the cleanliness check, verifies that `HEAD` still equals the recorded base revision, runs `git apply --check`, then `git apply --index --whitespace=error`. Arena never auto-applies, commits, pushes, or rewrites history.

## Validation command syntax

The Settings field accepts conservative whitespace-separated argv such as `corepack pnpm test` or `git status --porcelain=v1`. Quotes, shell variables, pipes, redirections, command separators, backticks, and newlines are rejected. Configure commands whose arguments do not require shell quoting.

## Install

```powershell
dsh plugin --profile web add github:LeemanCheung/dsh-agent-arena
```

Restart the existing DSH Web process and refresh its page. The selected profile must provide `agents`, `subprocess`, `storageDomain`, Typert Remotes, Settings, and at least two usable provider/model routes..

## Model Experience

Every contestant receives the user-entered Arena objective as one user message in its own session and worktree. Token and KV-cache usage therefore scales with 2–4 independent contestant sessions. Validation, scoring, comparison, cancellation, persistence, and application do not call another model.

## Known limitations

Validation argv uses a deliberately conservative tokenizer and cannot represent arguments containing whitespace. Cancellation depends on the selected provider honoring the supplied abort signal. The Host captures binary-capable `git diff HEAD`, so staged, unstaged, and intent-to-add files are reviewed and applied consistently. Patches over the 1 MB review/apply bound are rejected before mutation rather than truncated.

## Development

From the repository root run `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm build`, and `corepack pnpm pack:check`.

MIT. See [LICENSE](LICENSE).

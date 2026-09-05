# Changelog

## 1.0.1 — 2026-09-05

- Restrict recursive worktree cleanup to the dedicated Arena temporary root and validate both the expected path shape and resolved filesystem location.
- Start with no generic scoring command, requiring project-specific validation instead of awarding a misleading default 100 score from `git status`.
- Preserve subprocess failure exit codes in validation results and cover the behavior with a regression test.
- Migrate the browser client to the DSH 0.1.2 Renderer/Cordis API and update Host peers to 0.1.2-rc.1.
- Produce stable, invocation-directory-independent Host and Client artifacts and verify portable source maps before packing.
- Reject pre-existing contestant worktree destinations before Git sees them, including empty symbolic links and Windows junctions.
- Rebuild committed release artifacts on Windows and Linux CI and fail when tracked or untracked output differs.
- Record `web` compatibility with DSH 0.1.2-rc.1 after Windows Host, Client, Remote, Settings, and form-state UI verification on the QA and existing local profiles; no real model match was run.
- Normalize source maps without checkout-specific source contents so Windows and Linux rebuild gates compare the same release artifacts.

## 1.0.0 — 2026-08-16

- Initial Arena Host service, Typert Remote endpoints, schemas, state/events, cancellation, weighted scoring, report data, clean Git/worktree lifecycle, checkpointed winner apply, and cleanup.
- Added public-API-only DSH agent adapter boundary and explicit persistence/command adapters.
- Added Settings Arena UI, Remote mount, bilingual documentation, MIT license, and unit coverage.
- Documented rc.6 gaps: no public Arena-safe message/session factory, durable storage binding, or PNG share-card rasterizer.

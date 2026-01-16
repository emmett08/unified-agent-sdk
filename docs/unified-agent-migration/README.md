# Unified Agent Migration (Zero UI/UX Impact)

Goal: replace the current routing + agent execution stack in this repo with `@neuralsea/unified-agent-sdk@0.1.0` while ensuring **ZERO UI/UX impact** for the VS Code extension.

This documentation is evidence-driven from:
- This repo’s current runner contracts and UI event protocol.
- The `unified-agent-sdk` source as of `@neuralsea/unified-agent-sdk@0.1.0`.

## What “zero UI/UX impact” means here
- The Runner webviews/panels continue receiving the **same** `RunnerEvent` types/fields and in broadly the same order.
- Existing behavior that depends on **tool names** (notably file-write detection) continues to work.
- Routing semantics (provider preferences, fallbacks, availability) remain compatible enough that user-facing behavior does not change unexpectedly.

## Index
- `01-current-contracts.md` — current execution + UI-visible contracts in this repo
- `02-unified-agent-sdk-survey.md` — what unified-agent-sdk provides today (0.1.0)
- `03-gap-analysis.md` — mismatches that would change UI/UX if unaddressed
- `04-required-changes-unified-agent-sdk.md` — additions/bug fixes to unified-agent-sdk to preserve UI/UX
- `05-required-changes-this-repo.md` — where/what changes in this repo (bounded, why)
- `06-ui-exposable-provider-features.md` — provider-specific features to surface in UI (memory, reasoning, usage, etc.)
- `07-rollout-and-tests.md` — rollout plan, tests to run (no extension-host tests)

## Evidence policy
Where a recommendation depends on upstream provider capabilities (AI SDK/Auggie/Ollama) that are not verified in source here, the doc marks it as **Unavailable** and provides a safe “mechanism” to support it without guessing.

# AGENTS.md

Guidance for AI coding agents working in this repository.

## Purpose

This repo is a local MCP server for AI image generation and editing, with extra focus on transparency-safe asset output for layered UI/X workflows.

Primary goals:
- keep the MCP contract small and predictable
- prefer practical output quality over abstract architecture
- protect transparent-asset workflows with validation and repair

## Repo Priorities

When making changes, optimize in this order:
1. Correct image/output behavior
2. Stable MCP tool contracts
3. Clear tests
4. Minimal implementation surface
5. Performance

## Current Product Shape

The server exposes exactly two tools:
- `image.generate`
- `image.edit`

Current notable behavior:
- `image.generate` supports optional `reference_image_paths`
- `image.edit` supports multimodal image input
- both tools run through the same transparency pipeline
- transparent requests prefer native alpha, then requested chroma key, then inferred solid-background extraction

## Working Rules

- Read the existing implementation before proposing structural changes.
- Prefer extending `src/transparency.ts` over scattering image heuristics across the codebase.
- Keep provider-specific logic inside `src/google.ts`; keep provider-agnostic image/output logic elsewhere.
- Preserve backward compatibility of tool outputs unless a schema change is intentional and documented.
- Add or update tests for behavior changes, especially around transparency handling.
- Do not assume provider-native transparency is reliable.

## Important Files

- `src/server.ts`: MCP tool schemas and handler wiring
- `src/google.ts`: Gemini multimodal request construction and response parsing
- `src/transparency.ts`: transparency validation, extraction, and fallback logic
- `src/files.ts`: prompt guidance, image file IO, and output persistence
- `src/types.ts`: public/internal types used across the server
- `test/*.test.ts`: behavior locks
- `README.md`: external usage contract
- `PROJECT_STATE.md`: current status, risks, and next steps
- `ARCHITECTURE.md`: flow-level implementation notes

## Change Guidance

Good changes:
- stronger transparency diagnostics
- more robust solid-background extraction
- clearer provider fallback behavior
- reference-image steering improvements
- tests that capture failure modes seen in real usage

Avoid unless explicitly requested:
- broad framework churn
- adding extra providers without isolating the abstraction cleanly
- weakening transparency checks just to make more outputs pass
- embedding project-specific prompt style rules into the MCP layer

## Validation

Run after meaningful changes:

```bash
node ./node_modules/tsx/dist/cli.mjs --test test/**/*.test.ts
node ./node_modules/typescript/bin/tsc -p . --noEmit
cmd /c npm run build
```

## Notes For Future Agents

- This project is intended to be friendly to AI-assisted iteration.
- Keep docs current when behavior changes.
- If a real-world prompt/provider failure is discovered, add a regression test when feasible.

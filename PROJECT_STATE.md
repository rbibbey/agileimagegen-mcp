# Project State

Last updated: 2026-03-22

## Summary

`agileimagegen-mcp` is a local MCP server for Gemini-powered image generation and editing. It is optimized for practical asset production, especially transparent-background outputs for layered interface work.

The repo is currently in an early but functional state:
- the server builds
- the test suite passes
- the repo is pushed to GitHub
- transparency handling is implemented and shared across generate/edit flows

## Current Capabilities

- `image.generate`
  - text-driven image generation
  - optional multimodal steering via `reference_image_paths`
  - prompt-level size guidance
  - transparency request handling

- `image.edit`
  - multimodal image edit requests
  - shared transparency pipeline with generate

- transparency pipeline
  - accepts usable provider-native alpha
  - prefers a requested chroma key background of `#01FF01`
  - falls back to inferring a different solid border color
  - rejects fake or low-confidence transparency results
  - emits structured diagnostics

## Known Constraints

- only Google/Gemini is implemented as a provider today
- transparency extraction is strong for clean solid backgrounds, not for complex natural matting
- checkerboard/fake transparency rejection is heuristic-based
- prompt specialization is intentionally left to higher-level workflows/skills

## Key Files

- `src/server.ts`
- `src/google.ts`
- `src/transparency.ts`
- `src/files.ts`
- `src/types.ts`

## Validation Status

Expected validation commands:

```bash
node ./node_modules/tsx/dist/cli.mjs --test test/**/*.test.ts
node ./node_modules/typescript/bin/tsc -p . --noEmit
cmd /c npm run build
```

## Recommended Next Work

- test the pipeline through the Slappy Butts UI generation workflow
- collect real provider failures and turn them into regression tests
- improve diagnostics around inferred-background extraction confidence
- consider optional stronger segmentation/matting only if solid-background workflows prove insufficient

## Open Questions

- how often do providers return usable native alpha in real production prompts?
- how often do providers ignore the requested key but still return a removable solid background?
- do we need per-workflow prompt presets outside this MCP layer?

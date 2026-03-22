# Architecture

## Overview

The repo is a thin MCP server that wraps Gemini image generation/editing with local filesystem IO and a provider-agnostic transparency pipeline.

## Main Flow

### `image.generate`

1. Validate input through the MCP schema in `src/server.ts`
2. Add prompt guidance in `src/files.ts`
3. Optionally load `reference_image_paths`
4. Send the request through `src/google.ts`
5. Run the result through `src/transparency.ts`
6. Save the final bytes to disk via `src/files.ts`
7. Return structured metadata to the caller

### `image.edit`

1. Validate input through the MCP schema in `src/server.ts`
2. Load `input_image_paths` from disk
3. Send a multimodal edit request through `src/google.ts`
4. Run the result through the same `src/transparency.ts` pipeline
5. Save the final bytes to disk
6. Return structured metadata

## Module Responsibilities

### `src/server.ts`

- MCP server creation
- tool schema definitions
- handler orchestration
- error sanitization

### `src/google.ts`

- provider request construction
- multimodal content formatting
- Gemini response parsing

### `src/transparency.ts`

- native alpha validation
- requested-key extraction
- inferred solid-background fallback
- transparency diagnostics
- rejection of low-confidence outputs

### `src/files.ts`

- prompt guidance construction
- input file loading
- output directory resolution
- saved-image metadata

## Design Boundaries

- provider-specific request/response handling belongs in `src/google.ts`
- transparency logic should remain provider-agnostic
- high-level prompt strategy belongs outside this repo unless it is directly tied to output correctness

## Why The Transparency Pipeline Exists

Provider-native transparency is often unreliable for practical asset generation. The local pipeline improves output quality by:
- validating real alpha when it exists
- enforcing a preferred removable background
- inferring a removable solid background when providers drift
- rejecting outputs that would be misleading in layered UI workflows

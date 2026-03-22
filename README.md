# agileimagegen-mcp

Thin MCP server for Gemini image generation and image editing using a Google AI Studio API key.

This project is designed for fast AI-assisted iteration. For repo-specific guidance, see [AGENTS.md](/C:/git/agileimagegen-mcp/AGENTS.md), [PROJECT_STATE.md](/C:/git/agileimagegen-mcp/PROJECT_STATE.md), and [ARCHITECTURE.md](/C:/git/agileimagegen-mcp/ARCHITECTURE.md).

## What It Does

- Exposes exactly 2 MCP tools: `image.generate` and `image.edit`
- Uses `@google/genai` with `GOOGLE_API_KEY`
- Runs as a local `stdio` MCP server
- Can also run from Docker with the same env contract
- Saves generated images to disk and returns structured metadata
- Supports reference-guided generation with anchor images
- Uses a shared transparency pipeline across generate and edit

## Requirements

- Node.js 20+
- A Google AI Studio API key with access to Gemini image-capable models

## Environment

Copy `.env.example` to `.env` and fill in your key:

```env
GOOGLE_API_KEY=your-google-ai-studio-api-key
AGILEIMAGEGEN_DEFAULT_MODEL=gemini-2.5-flash-image
AGILEIMAGEGEN_OUTPUT_DIR=./output
AGILEIMAGEGEN_LOG_LEVEL=info
AGILEIMAGEGEN_SAVE_PROMPTS=false
```

Notes:
- `GOOGLE_API_KEY` is required.
- `AGILEIMAGEGEN_DEFAULT_MODEL` can be overridden per tool call.
- `AGILEIMAGEGEN_OUTPUT_DIR` is where generated images are written by default.
- `.env` is gitignored and should stay local.

## Local Development

Install dependencies:

```bash
cmd /c npm install
```

Run in dev mode:

```bash
cmd /c npm run dev
```

Build:

```bash
cmd /c npm run build
```

Run the built server:

```bash
cmd /c npm start
```

Run tests:

```bash
cmd /c npm test
```

Run live smoke tests:

```bash
cmd /c npm run smoke:generate
cmd /c npm run smoke:edit
```

## Docker

Build:

```bash
docker build -t agileimagegen-mcp .
```

Run:

```bash
docker run --rm -i --env-file .env -v "${PWD}/output:/app/output" agileimagegen-mcp
```

The container expects to run as a `stdio` MCP server, so use `-i` and wire it through your MCP client.

## MCP Client Example

Example local `stdio` MCP config:

```json
{
  "mcpServers": {
    "agileimagegen": {
      "command": "node",
      "args": ["C:/git/agileimagegen-mcp/dist/server.js"],
      "cwd": "C:/git/agileimagegen-mcp",
      "env": {
        "GOOGLE_API_KEY": "your-key-here"
      }
    }
  }
}
```

If you prefer `.env`, keep the `cwd` pointed at this repo so the server can load it locally.

## Tools

### `image.generate`

Input:

```json
{
  "prompt": "Arcade grime sewer cartoon logo",
  "model": "gemini-2.5-flash-image",
  "reference_image_paths": ["C:/temp/input/anchor-logo.png"],
  "size": "square",
  "background": "transparent",
  "transparency_mode": "repair",
  "transparency_threshold": "balanced",
  "filename_hint": "sewer-logo",
  "output_dir": "C:/temp/output"
}
```

Supported size inputs:
- preset: `square`, `landscape`, `portrait`, `widescreen`
- explicit: `WIDTHxHEIGHT`
- or `width` + `height`

Transparency controls:
- `transparency_mode`: `off`, `validate`, or `repair`
- `transparency_threshold`: `balanced` or `strict`

Reference guidance:
- `reference_image_paths`: optional local anchor images used to steer `image.generate`
- when present, generate requests are sent as multimodal requests instead of text-only prompts

Defaults:
- `background: "transparent"` implies `transparency_mode: "repair"`
- otherwise transparency handling defaults to `off`
- transparent workflows prefer a chroma-key background color of `#01FF01`, but can also accept good native alpha or infer and remove a different solid border color when the provider drifts
- `image.edit` and `image.generate` both run through the same transparency validation/extraction pipeline

### `image.edit`

Input:

```json
{
  "prompt": "Make this sign grimier and add a toxic green edge glow",
  "input_image_paths": ["C:/temp/input/sign.png"],
  "model": "gemini-2.5-flash-image",
  "transparency_mode": "repair",
  "transparency_threshold": "balanced",
  "filename_hint": "sign-edit",
  "output_dir": "C:/temp/output"
}
```

For `image.edit`, transparency repair runs by default when the prompt implies transparent or alpha output.

## Tool Output Shape

Both tools return structured content in this shape:

```json
{
  "path": "C:/git/agileimagegen-mcp/output/123456-sewer-logo.png",
  "mime_type": "image/png",
  "model": "gemini-2.5-flash-image",
  "provider": "google",
  "prompt_summary": "Arcade grime sewer cartoon logo",
  "warnings": [],
  "width": 1024,
  "height": 1024,
  "transparency": {
    "requested": true,
    "mode": "repair",
    "threshold": "balanced",
    "source_mime_type": "image/jpeg",
    "has_alpha": true,
    "alpha_pixel_ratio": 0.44,
    "fully_transparent_ratio": 0.39,
    "opaque_border_ratio": 0.02,
    "checkerboard_detected": false,
    "key_color": "#01FF01",
    "key_color_match_ratio": 0.91,
    "background_mode": "keyed",
    "repair_attempted": true,
    "repair_succeeded": true,
    "warnings": []
  }
}
```

## Design Notes

- Width, height, size, and transparent background are passed as prompt guidance because Gemini image-capable models may not honor them as hard output controls in all cases.
- When transparency is requested, the server uses a tiered strategy: accept usable native alpha first, otherwise prefer the requested `#01FF01` chroma-key background, then fall back to inferring and removing a different solid border color.
- Provider-native transparency is still validated before use; opaque outputs are converted to transparency only when the background is cleanly separable.
- Transparency diagnostics are returned to the caller so layered asset workflows can reason about confidence, repair attempts, and failure modes.
- Prompt specialization is intentionally out of scope for this repo. Project-specific prompt rules should live in the caller’s skill/workflow layer.
- Error messages are sanitized so normal failures do not leak raw API keys.

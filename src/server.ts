#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { loadConfig, logMessage } from "./config.js";
import {
  buildPromptWithGuidance,
  readInputImages,
  resolveOutputDirectory,
  saveImageBytes,
  summarizePrompt,
} from "./files.js";
import { createGoogleImageClient } from "./google.js";
import { processTransparency } from "./transparency.js";
import type {
  GoogleImageClient,
  ImageEditInput,
  ImageGenerateInput,
  ServerConfig,
  ToolResult,
} from "./types.js";

const provider = "google" as const;

const generateInputSchema = {
  prompt: z.string().min(1),
  model: z.string().min(1).optional(),
  reference_image_paths: z.array(z.string().min(1)).min(1).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  size: z.string().min(1).optional(),
  background: z.enum(["transparent", "opaque", "auto"]).optional(),
  transparency_mode: z.enum(["off", "validate", "repair"]).optional(),
  transparency_threshold: z.enum(["strict", "balanced"]).optional(),
  filename_hint: z.string().min(1).optional(),
  output_dir: z.string().min(1).optional(),
};

const editInputSchema = {
  prompt: z.string().min(1),
  input_image_paths: z.array(z.string().min(1)).min(1),
  model: z.string().min(1).optional(),
  filename_hint: z.string().min(1).optional(),
  output_dir: z.string().min(1).optional(),
  transparency_mode: z.enum(["off", "validate", "repair"]).optional(),
  transparency_threshold: z.enum(["strict", "balanced"]).optional(),
};

const outputSchema = {
  path: z.string(),
  mime_type: z.string(),
  model: z.string(),
  provider: z.literal(provider),
  prompt_summary: z.string(),
  warnings: z.array(z.string()),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  transparency: z
    .object({
      requested: z.boolean(),
      mode: z.enum(["off", "validate", "repair"]),
      threshold: z.enum(["strict", "balanced"]),
      source_mime_type: z.string(),
      has_alpha: z.boolean(),
      alpha_pixel_ratio: z.number(),
      fully_transparent_ratio: z.number(),
      opaque_border_ratio: z.number(),
      checkerboard_detected: z.boolean(),
      key_color: z.string(),
      key_color_match_ratio: z.number(),
      background_mode: z.enum(["keyed", "transparent", "uniform", "checkerboard", "complex", "unknown"]),
      repair_attempted: z.boolean(),
      repair_succeeded: z.boolean(),
      failure_reason: z.string().optional(),
      warnings: z.array(z.string()),
    })
    .optional(),
};

function sanitizeError(error: unknown, debug = false): string {
  if (error instanceof Error) {
    if (debug) {
      return error.message;
    }

    return error.message.replace(/AIza[0-9A-Za-z\-_]+/g, "[REDACTED_API_KEY]");
  }

  return "Unknown image generation error.";
}

function formatToolResult(result: ToolResult) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
    structuredContent: result,
  };
}

function expectsTransparency(prompt: string, background?: "transparent" | "opaque" | "auto"): boolean {
  if (background === "transparent") {
    return true;
  }

  const normalized = prompt.toLowerCase();
  if (
    normalized.includes("no transparent") ||
    normalized.includes("without transparent") ||
    normalized.includes("opaque background")
  ) {
    return false;
  }

  return /\btransparent\b|\balpha\b/i.test(normalized);
}

function resolveTransparencyMode(
  requested: boolean,
  mode: "off" | "validate" | "repair" | undefined,
): "off" | "validate" | "repair" {
  if (mode) {
    return mode;
  }

  return requested ? "repair" : "off";
}

export function createHandlers(config: ServerConfig, googleClient: GoogleImageClient) {
  return {
    async generate(args: ImageGenerateInput) {
      const promptGuidance = buildPromptWithGuidance(args.prompt, args);
      const referenceImages = args.reference_image_paths
        ? readInputImages(args.reference_image_paths)
        : [];
      const transparencyRequested = expectsTransparency(args.prompt, args.background);
      const transparencyMode = resolveTransparencyMode(
        transparencyRequested || args.background === "transparent",
        args.transparency_mode,
      );
      const response = await googleClient.generateImage({
        prompt: promptGuidance.prompt,
        model: args.model || config.defaultModel,
        filenameHint: args.filename_hint,
        outputDir: args.output_dir,
        promptOptions: args,
        referenceImages,
      });

      const transparency = await processTransparency(
        Buffer.from(response.imageBase64, "base64"),
        response.mimeType,
        {
          requested: transparencyRequested || transparencyMode !== "off",
          mode: transparencyMode,
          threshold: args.transparency_threshold,
        },
      );
      if (transparency.diagnostics.failure_reason) {
        throw new Error(transparency.diagnostics.failure_reason);
      }

      const saved = saveImageBytes(
        transparency.bytes,
        transparency.mimeType,
        resolveOutputDirectory(config.outputDir, args.output_dir),
        args.filename_hint,
      );

      const result: ToolResult = {
        path: saved.path,
        mime_type: saved.mimeType,
        model: response.model,
        provider,
        prompt_summary: summarizePrompt(args.prompt),
        warnings: [
          ...promptGuidance.warnings,
          ...response.warnings,
          ...transparency.diagnostics.warnings,
        ],
        width: saved.width,
        height: saved.height,
        transparency: transparency.diagnostics,
      };

      return formatToolResult(result);
    },

    async edit(args: ImageEditInput) {
      const inputImages = readInputImages(args.input_image_paths);
      const transparencyRequested = expectsTransparency(args.prompt);
      const transparencyMode = resolveTransparencyMode(
        transparencyRequested,
        args.transparency_mode,
      );
      const response = await googleClient.editImage({
        prompt: args.prompt,
        model: args.model || config.defaultModel,
        filenameHint: args.filename_hint,
        outputDir: args.output_dir,
        inputImages,
      });

      const transparency = await processTransparency(
        Buffer.from(response.imageBase64, "base64"),
        response.mimeType,
        {
          requested: transparencyRequested || transparencyMode !== "off",
          mode: transparencyMode,
          threshold: args.transparency_threshold,
        },
      );
      if (transparency.diagnostics.failure_reason) {
        throw new Error(transparency.diagnostics.failure_reason);
      }

      const saved = saveImageBytes(
        transparency.bytes,
        transparency.mimeType,
        resolveOutputDirectory(config.outputDir, args.output_dir),
        args.filename_hint,
      );

      const result: ToolResult = {
        path: saved.path,
        mime_type: saved.mimeType,
        model: response.model,
        provider,
        prompt_summary: summarizePrompt(args.prompt),
        warnings: [...response.warnings, ...transparency.diagnostics.warnings],
        width: saved.width,
        height: saved.height,
        transparency: transparency.diagnostics,
      };

      return formatToolResult(result);
    },
  };
}

export function createServer(config: ServerConfig, googleClient = createGoogleImageClient(config)) {
  const server = new McpServer({
    name: "agileimagegen-mcp",
    version: "0.1.0",
  });

  const handlers = createHandlers(config, googleClient);

  server.registerTool(
    "image.generate",
    {
      description:
        "Generate an image with Gemini using a Google AI Studio API key. Saves the result to disk and returns structured metadata.",
      inputSchema: generateInputSchema,
      outputSchema,
    },
    async (args) => {
      try {
        return await handlers.generate(args as ImageGenerateInput);
      } catch (error) {
        const message = sanitizeError(error, config.logLevel === "debug");
        logMessage(config, "error", "image.generate failed", { message });
        throw new Error(message);
      }
    },
  );

  server.registerTool(
    "image.edit",
    {
      description:
        "Edit one or more local images with Gemini using multimodal input. Saves the result to disk and returns structured metadata.",
      inputSchema: editInputSchema,
      outputSchema,
    },
    async (args) => {
      try {
        return await handlers.edit(args as ImageEditInput);
      } catch (error) {
        const message = sanitizeError(error, config.logLevel === "debug");
        logMessage(config, "error", "image.edit failed", { message });
        throw new Error(message);
      }
    },
  );

  return server;
}

export async function main() {
  const config = loadConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logMessage(config, "info", "agileimagegen-mcp server running on stdio");
}

const currentFilePath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (currentFilePath === entryPath) {
  main().catch((error) => {
    console.error("Fatal error starting agileimagegen-mcp:", sanitizeError(error, true));
    process.exit(1);
  });
}

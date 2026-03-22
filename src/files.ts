import fs from "node:fs";
import path from "node:path";
import { imageSize } from "image-size";
import {
  type InlineInputImage,
  type PromptOptions,
  type SavedImage,
} from "./types.js";

const SIZE_PRESETS: Record<string, { width: number; height: number }> = {
  square: { width: 1024, height: 1024 },
  landscape: { width: 1536, height: 1024 },
  portrait: { width: 1024, height: 1536 },
  widescreen: { width: 1792, height: 1024 },
};

export const TRANSPARENCY_KEY_COLOR = {
  r: 1,
  g: 255,
  b: 1,
} as const;

export const TRANSPARENCY_KEY_HEX = "#01FF01";

function ensureDirectory(dirPath: string): string {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function resolveOutputDirectory(baseDir: string, override?: string): string {
  const resolved = override ? path.resolve(override) : path.resolve(baseDir);
  return ensureDirectory(resolved);
}

export function summarizePrompt(prompt: string, limit = 120): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit - 3)}...`;
}

export function slugifyFilename(name: string | undefined, fallback: string): string {
  const normalized = (name || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return normalized || fallback;
}

export function parseRequestedSize(
  options: PromptOptions,
): { width?: number; height?: number; warning?: string } {
  if (options.width && options.height) {
    return { width: options.width, height: options.height };
  }

  if (!options.size) {
    return {};
  }

  const preset = SIZE_PRESETS[options.size];
  if (preset) {
    return preset;
  }

  const match = /^(\d+)x(\d+)$/i.exec(options.size);
  if (match) {
    return { width: Number(match[1]), height: Number(match[2]) };
  }

  return {
    warning:
      "Unrecognized size preset. Supported presets are square, landscape, portrait, widescreen, or WIDTHxHEIGHT.",
  };
}

export function buildPromptWithGuidance(
  prompt: string,
  options: PromptOptions,
): { prompt: string; warnings: string[] } {
  const warnings: string[] = [];
  const parts = [prompt.trim()];
  const requestedSize = parseRequestedSize(options);

  if (requestedSize.width && requestedSize.height) {
    parts.push(
      `Target composition size: ${requestedSize.width}x${requestedSize.height}. Keep framing appropriate for that canvas.`,
    );
    warnings.push(
      "Requested size is passed as prompt guidance because Gemini image generation may not enforce exact output dimensions.",
    );
  } else if (requestedSize.warning) {
    warnings.push(requestedSize.warning);
  }

  if (options.background === "transparent") {
    parts.push(
      `Render the subject on a perfectly flat solid ${TRANSPARENCY_KEY_HEX} background (RGB ${TRANSPARENCY_KEY_COLOR.r}, ${TRANSPARENCY_KEY_COLOR.g}, ${TRANSPARENCY_KEY_COLOR.b}).`,
    );
    parts.push(
      `Do not use ${TRANSPARENCY_KEY_HEX} anywhere in the subject. Keep the background uniform with no gradients, texture, shadows, reflections, or extra objects.`,
    );
    warnings.push(
      `Transparent output is produced by extracting a forced chroma-key background (${TRANSPARENCY_KEY_HEX}); provider-native alpha is not trusted.`,
    );
  } else if (options.background === "opaque") {
    parts.push("Use an opaque background.");
  }

  return { prompt: parts.join("\n\n"), warnings };
}

export function detectMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      throw new Error(`Unsupported input image format: ${ext || "unknown"}`);
  }
}

export function readInputImages(paths: string[]): InlineInputImage[] {
  if (paths.length === 0) {
    throw new Error("At least one input image path is required.");
  }

  return paths.map((inputPath) => {
    const resolvedPath = path.resolve(inputPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Input image not found: ${resolvedPath}`);
    }

    const mimeType = detectMimeType(resolvedPath);
    return {
      path: resolvedPath,
      mimeType,
      data: fs.readFileSync(resolvedPath).toString("base64"),
    };
  });
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

export function saveGeneratedImage(
  base64Data: string,
  mimeType: string,
  outputDir: string,
  filenameHint?: string,
): SavedImage {
  return saveImageBytes(Buffer.from(base64Data, "base64"), mimeType, outputDir, filenameHint);
}

export function saveImageBytes(
  bytes: Buffer,
  mimeType: string,
  outputDir: string,
  filenameHint?: string,
): SavedImage {
  const safeDir = ensureDirectory(path.resolve(outputDir));
  const fileName = `${Date.now()}-${slugifyFilename(filenameHint, "generated-image")}.${extensionForMime(
    mimeType,
  )}`;
  const filePath = path.join(safeDir, fileName);
  fs.writeFileSync(filePath, bytes);

  const dimensions = imageSize(bytes);
  return {
    path: filePath,
    mimeType,
    width: dimensions.width,
    height: dimensions.height,
  };
}

import sharp from "sharp";
import { TRANSPARENCY_KEY_COLOR, TRANSPARENCY_KEY_HEX } from "./files.js";
import type {
  TransparencyBackgroundMode,
  TransparencyDiagnostics,
  TransparencyThreshold,
} from "./types.js";

type TransparencyMode = "off" | "validate" | "repair";

type TransparencyPipelineOptions = {
  requested: boolean;
  mode: TransparencyMode;
  threshold?: TransparencyThreshold;
};

type RgbaImage = {
  data: Buffer;
  width: number;
  height: number;
};

type RgbColor = {
  r: number;
  g: number;
  b: number;
};

type ThresholdConfig = {
  minAlphaRatio: number;
  minFullyTransparentRatio: number;
  maxOpaqueBorderRatio: number;
  minEdgeColorRatio: number;
  minOverallColorRatio: number;
  maxRemovalRatio: number;
  minForegroundRatio: number;
};

type BackgroundCandidate = {
  color: RgbColor;
  edgeRatio: number;
  overallRatio: number;
  mode: Extract<TransparencyBackgroundMode, "keyed" | "uniform">;
};

type ExtractionAttempt = {
  bytes: Buffer;
  mimeType: string;
  diagnostics: TransparencyDiagnostics;
};

const THRESHOLDS: Record<TransparencyThreshold, ThresholdConfig> = {
  balanced: {
    minAlphaRatio: 0.02,
    minFullyTransparentRatio: 0.01,
    maxOpaqueBorderRatio: 0.18,
    minEdgeColorRatio: 0.5,
    minOverallColorRatio: 0.14,
    maxRemovalRatio: 0.985,
    minForegroundRatio: 0.015,
  },
  strict: {
    minAlphaRatio: 0.04,
    minFullyTransparentRatio: 0.02,
    maxOpaqueBorderRatio: 0.1,
    minEdgeColorRatio: 0.68,
    minOverallColorRatio: 0.2,
    maxRemovalRatio: 0.975,
    minForegroundRatio: 0.025,
  },
};

const REQUESTED_KEY_TOLERANCE = 44;
const REQUESTED_KEY_FLOOD_TOLERANCE = 54;
const INFERRED_COLOR_TOLERANCE = 30;
const INFERRED_COLOR_FLOOD_TOLERANCE = 40;
const FEATHER_START = 18;
const FEATHER_END = 88;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundRatio(value: number): number {
  return Number(value.toFixed(4));
}

function pixelOffset(width: number, x: number, y: number): number {
  return (width * y + x) * 4;
}

function edgeCoordinates(width: number, height: number): Array<[number, number]> {
  const coords: Array<[number, number]> = [];

  for (let x = 0; x < width; x += 1) {
    coords.push([x, 0]);
    if (height > 1) {
      coords.push([x, height - 1]);
    }
  }

  for (let y = 1; y < height - 1; y += 1) {
    coords.push([0, y]);
    if (width > 1) {
      coords.push([width - 1, y]);
    }
  }

  return coords;
}

function quantizeChannel(value: number): number {
  return Math.round(value / 8) * 8;
}

function colorKey(color: RgbColor): string {
  return `${quantizeChannel(color.r)}:${quantizeChannel(color.g)}:${quantizeChannel(color.b)}`;
}

function parseColorKey(key: string): RgbColor {
  const [r, g, b] = key.split(":").map(Number);
  return { r, g, b };
}

function colorToHex(color: RgbColor): string {
  return `#${color.r.toString(16).padStart(2, "0")}${color.g
    .toString(16)
    .padStart(2, "0")}${color.b.toString(16).padStart(2, "0")}`.toUpperCase();
}

function colorDistance(a: RgbColor, b: RgbColor): number {
  return Math.sqrt(
    (a.r - b.r) * (a.r - b.r) +
      (a.g - b.g) * (a.g - b.g) +
      (a.b - b.b) * (a.b - b.b),
  );
}

function readColor(image: RgbaImage, x: number, y: number): RgbColor {
  const idx = pixelOffset(image.width, x, y);
  return {
    r: image.data[idx],
    g: image.data[idx + 1],
    b: image.data[idx + 2],
  };
}

async function decodeToRgba(bytes: Buffer): Promise<RgbaImage> {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    width: info.width,
    height: info.height,
  };
}

async function encodePng(image: RgbaImage): Promise<Buffer> {
  return sharp(image.data, {
    raw: {
      width: image.width,
      height: image.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

function computeMetrics(image: RgbaImage) {
  const totalPixels = image.width * image.height;
  const borderCoords = edgeCoordinates(image.width, image.height);
  let lowAlphaPixels = 0;
  let fullyTransparentPixels = 0;
  let opaqueBorderPixels = 0;

  for (let idx = 3; idx < image.data.length; idx += 4) {
    const alpha = image.data[idx];
    if (alpha < 250) {
      lowAlphaPixels += 1;
    }
    if (alpha === 0) {
      fullyTransparentPixels += 1;
    }
  }

  for (const [x, y] of borderCoords) {
    const idx = pixelOffset(image.width, x, y);
    if (image.data[idx + 3] >= 250) {
      opaqueBorderPixels += 1;
    }
  }

  return {
    hasAlpha: lowAlphaPixels > 0,
    alphaPixelRatio: totalPixels > 0 ? lowAlphaPixels / totalPixels : 0,
    fullyTransparentRatio: totalPixels > 0 ? fullyTransparentPixels / totalPixels : 0,
    opaqueBorderRatio: borderCoords.length > 0 ? opaqueBorderPixels / borderCoords.length : 0,
  };
}

function isNeutralGray(r: number, g: number, b: number): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) <= 18;
}

function detectCheckerboardBackground(image: RgbaImage): boolean {
  const regionWidth = Math.min(192, Math.floor(image.width * 0.28));
  const regionHeight = Math.min(192, Math.floor(image.height * 0.28));
  const tileSizes = [8, 12, 16, 24, 32, 48, 64];

  if (regionWidth < 32 || regionHeight < 32) {
    return false;
  }

  for (const tileSize of tileSizes) {
    const columns = Math.floor(regionWidth / tileSize);
    const rows = Math.floor(regionHeight / tileSize);
    if (columns < 4 || rows < 4) {
      continue;
    }

    const blockKeys: string[][] = [];
    const counts = new Map<string, number>();

    for (let row = 0; row < rows; row += 1) {
      const rowKeys: string[] = [];
      for (let col = 0; col < columns; col += 1) {
        let rTotal = 0;
        let gTotal = 0;
        let bTotal = 0;
        let pixelCount = 0;

        for (let y = row * tileSize; y < (row + 1) * tileSize; y += 1) {
          for (let x = col * tileSize; x < (col + 1) * tileSize; x += 1) {
            const idx = pixelOffset(image.width, x, y);
            if (image.data[idx + 3] < 250) {
              continue;
            }

            rTotal += image.data[idx];
            gTotal += image.data[idx + 1];
            bTotal += image.data[idx + 2];
            pixelCount += 1;
          }
        }

        if (pixelCount === 0) {
          rowKeys.push("transparent");
          continue;
        }

        const key = colorKey({
          r: Math.round(rTotal / pixelCount),
          g: Math.round(gTotal / pixelCount),
          b: Math.round(bTotal / pixelCount),
        });
        rowKeys.push(key);
        counts.set(key, (counts.get(key) || 0) + 1);
      }

      blockKeys.push(rowKeys);
    }

    const topColors = [...counts.entries()]
      .filter(([key]) => key !== "transparent")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);
    if (topColors.length !== 2) {
      continue;
    }

    const palette = topColors.map(([key]) => parseColorKey(key));
    const averageDelta =
      (Math.abs(palette[0].r - palette[1].r) +
        Math.abs(palette[0].g - palette[1].g) +
        Math.abs(palette[0].b - palette[1].b)) /
      3;
    if (
      !isNeutralGray(palette[0].r, palette[0].g, palette[0].b) ||
      !isNeutralGray(palette[1].r, palette[1].g, palette[1].b) ||
      averageDelta < 8 ||
      averageDelta > 40
    ) {
      continue;
    }

    let alternatingNeighbors = 0;
    let neighborChecks = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        const current = blockKeys[row][col];
        if (current === "transparent") {
          continue;
        }

        if (col + 1 < columns && blockKeys[row][col + 1] !== "transparent") {
          neighborChecks += 1;
          if (blockKeys[row][col + 1] !== current) {
            alternatingNeighbors += 1;
          }
        }

        if (row + 1 < rows && blockKeys[row + 1][col] !== "transparent") {
          neighborChecks += 1;
          if (blockKeys[row + 1][col] !== current) {
            alternatingNeighbors += 1;
          }
        }
      }
    }

    if (neighborChecks > 0 && alternatingNeighbors / neighborChecks >= 0.72) {
      return true;
    }
  }

  return false;
}

function analyzeBorderCandidate(
  image: RgbaImage,
  candidate: RgbColor,
  tolerance: number,
  mode: Extract<TransparencyBackgroundMode, "keyed" | "uniform">,
): BackgroundCandidate | undefined {
  const edges = edgeCoordinates(image.width, image.height);
  let edgeMatches = 0;
  let overallMatches = 0;

  for (const [x, y] of edges) {
    if (colorDistance(readColor(image, x, y), candidate) <= tolerance) {
      edgeMatches += 1;
    }
  }

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (colorDistance(readColor(image, x, y), candidate) <= tolerance) {
        overallMatches += 1;
      }
    }
  }

  if (edges.length === 0) {
    return undefined;
  }

  return {
    color: candidate,
    edgeRatio: edgeMatches / edges.length,
    overallRatio: overallMatches / (image.width * image.height),
    mode,
  };
}

function inferSolidBorderColor(image: RgbaImage): BackgroundCandidate | undefined {
  const counts = new Map<string, number>();
  const borderColors: RgbColor[] = [];

  for (const [x, y] of edgeCoordinates(image.width, image.height)) {
    const idx = pixelOffset(image.width, x, y);
    if (image.data[idx + 3] < 245) {
      continue;
    }

    const color = readColor(image, x, y);
    borderColors.push(color);
    const key = colorKey(color);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  if (borderColors.length < 8) {
    return undefined;
  }

  const [topColor] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!topColor) {
    return undefined;
  }

  const candidate = parseColorKey(topColor[0]);
  const averageDistance =
    borderColors.reduce((sum, color) => sum + colorDistance(color, candidate), 0) / borderColors.length;
  if (averageDistance > 28) {
    return undefined;
  }

  return analyzeBorderCandidate(image, candidate, INFERRED_COLOR_TOLERANCE, "uniform");
}

function buildMaskFromBackground(
  image: RgbaImage,
  background: RgbColor,
  floodTolerance: number,
  featherTolerance: number,
) {
  const queue: number[] = [];
  const visited = new Uint8Array(image.width * image.height);
  const removed = new Uint8Array(image.width * image.height);

  const matchesBackground = (x: number, y: number): boolean =>
    colorDistance(readColor(image, x, y), background) <= floodTolerance;

  for (const [x, y] of edgeCoordinates(image.width, image.height)) {
    if (!matchesBackground(x, y)) {
      continue;
    }

    const index = y * image.width + x;
    if (visited[index] === 1) {
      continue;
    }

    visited[index] = 1;
    queue.push(index);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (current == null) {
      continue;
    }

    removed[current] = 1;
    const x = current % image.width;
    const y = Math.floor(current / image.width);
    const neighbors: Array<[number, number]> = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];

    for (const [nextX, nextY] of neighbors) {
      if (nextX < 0 || nextY < 0 || nextX >= image.width || nextY >= image.height) {
        continue;
      }

      const nextIndex = nextY * image.width + nextX;
      if (visited[nextIndex] === 1 || !matchesBackground(nextX, nextY)) {
        continue;
      }

      visited[nextIndex] = 1;
      queue.push(nextIndex);
    }
  }

  const output = Buffer.from(image.data);
  let removedPixels = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = y * image.width + x;
      const idx = pixelOffset(image.width, x, y);
      if (removed[index] === 1) {
        output[idx + 3] = 0;
        removedPixels += 1;
        continue;
      }

      const neighbors: Array<[number, number]> = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      const adjacentToRemoved = neighbors.some(([nextX, nextY]) => {
        if (nextX < 0 || nextY < 0 || nextX >= image.width || nextY >= image.height) {
          return false;
        }

        return removed[nextY * image.width + nextX] === 1;
      });
      if (!adjacentToRemoved) {
        continue;
      }

      const distance = colorDistance(readColor(image, x, y), background);
      if (distance >= featherTolerance) {
        continue;
      }

      const alpha =
        distance <= FEATHER_START
          ? 0
          : clamp(
              Math.round(255 * ((distance - FEATHER_START) / (featherTolerance - FEATHER_START))),
              0,
              255,
            );
      if (alpha >= output[idx + 3]) {
        continue;
      }

      if (alpha > 0) {
        const ratio = alpha / 255;
        output[idx] = clamp(Math.round((output[idx] - background.r * (1 - ratio)) / ratio), 0, 255);
        output[idx + 1] = clamp(
          Math.round((output[idx + 1] - background.g * (1 - ratio)) / ratio),
          0,
          255,
        );
        output[idx + 2] = clamp(
          Math.round((output[idx + 2] - background.b * (1 - ratio)) / ratio),
          0,
          255,
        );
      }

      output[idx + 3] = alpha;
    }
  }

  return {
    image: {
      data: output,
      width: image.width,
      height: image.height,
    },
    removedRatio: removedPixels / (image.width * image.height),
  };
}

function buildDiagnostics(
  image: RgbaImage,
  options: TransparencyPipelineOptions,
  sourceMimeType: string,
  backgroundMode: TransparencyBackgroundMode,
  keyColor: string,
  keyColorMatchRatio: number,
  checkerboardDetected: boolean,
  warnings: string[],
  overrides?: Partial<TransparencyDiagnostics>,
): TransparencyDiagnostics {
  const metrics = computeMetrics(image);

  return {
    requested: options.requested,
    mode: options.mode,
    threshold: options.threshold ?? "balanced",
    source_mime_type: sourceMimeType,
    has_alpha: metrics.hasAlpha,
    alpha_pixel_ratio: roundRatio(metrics.alphaPixelRatio),
    fully_transparent_ratio: roundRatio(metrics.fullyTransparentRatio),
    opaque_border_ratio: roundRatio(metrics.opaqueBorderRatio),
    checkerboard_detected: checkerboardDetected,
    key_color: keyColor,
    key_color_match_ratio: roundRatio(keyColorMatchRatio),
    background_mode: backgroundMode,
    repair_attempted: false,
    repair_succeeded: false,
    warnings,
    ...overrides,
  };
}

function validateTransparentResult(
  diagnostics: TransparencyDiagnostics,
  threshold: ThresholdConfig,
): { warnings: string[]; failureReason?: string } {
  const warnings = [...diagnostics.warnings];

  if (!diagnostics.requested) {
    return { warnings };
  }

  if (!diagnostics.has_alpha || diagnostics.alpha_pixel_ratio < threshold.minAlphaRatio) {
    return {
      warnings,
      failureReason:
        "Transparency extraction failed: the output contains too little real alpha to be a reliable transparent asset.",
    };
  }

  if (diagnostics.fully_transparent_ratio < threshold.minFullyTransparentRatio) {
    warnings.push(
      "The image contains mostly feathered alpha with limited hard knockout; inspect the edge quality before using it in layered UI.",
    );
  }

  if (diagnostics.opaque_border_ratio > threshold.maxOpaqueBorderRatio) {
    return {
      warnings,
      failureReason:
        "Transparency extraction failed: too much of the image border remains opaque after background removal.",
    };
  }

  if (
    diagnostics.fully_transparent_ratio > threshold.maxRemovalRatio ||
    1 - diagnostics.fully_transparent_ratio < threshold.minForegroundRatio
  ) {
    return {
      warnings,
      failureReason:
        "Transparency extraction failed: the recovered mask removed nearly the entire image and left too little foreground detail.",
    };
  }

  return { warnings };
}

function canAcceptNativeAlpha(image: RgbaImage, threshold: ThresholdConfig, checkerboard: boolean): boolean {
  const metrics = computeMetrics(image);
  return (
    !checkerboard &&
    metrics.hasAlpha &&
    metrics.alphaPixelRatio >= threshold.minAlphaRatio &&
    metrics.opaqueBorderRatio <= threshold.maxOpaqueBorderRatio
  );
}

async function tryBackgroundExtraction(
  sourceImage: RgbaImage,
  sourceMimeType: string,
  options: TransparencyPipelineOptions,
  threshold: ThresholdConfig,
  candidate: BackgroundCandidate,
  warnings: string[],
): Promise<ExtractionAttempt> {
  const repaired = buildMaskFromBackground(
    sourceImage,
    candidate.color,
    candidate.mode === "keyed" ? REQUESTED_KEY_FLOOD_TOLERANCE : INFERRED_COLOR_FLOOD_TOLERANCE,
    candidate.mode === "keyed" ? FEATHER_END : 72,
  );
  const diagnostics = buildDiagnostics(
    repaired.image,
    options,
    sourceMimeType,
    candidate.mode,
    colorToHex(candidate.color),
    candidate.edgeRatio,
    detectCheckerboardBackground(repaired.image),
    warnings,
    {
      repair_attempted: true,
      repair_succeeded: true,
    },
  );

  if (repaired.removedRatio < threshold.minAlphaRatio) {
    diagnostics.failure_reason =
      "Transparency extraction failed: the inferred mask removed almost none of the background.";
    diagnostics.repair_succeeded = false;
    return {
      bytes: Buffer.from(sourceImage.data),
      mimeType: sourceMimeType,
      diagnostics,
    };
  }

  const validation = validateTransparentResult(diagnostics, threshold);
  diagnostics.warnings = validation.warnings;
  if (validation.failureReason) {
    diagnostics.failure_reason = validation.failureReason;
    diagnostics.repair_succeeded = false;
    return {
      bytes: Buffer.from(sourceImage.data),
      mimeType: sourceMimeType,
      diagnostics,
    };
  }

  return {
    bytes: await encodePng(repaired.image),
    mimeType: "image/png",
    diagnostics,
  };
}

export async function processTransparency(
  bytes: Buffer,
  sourceMimeType: string,
  options: TransparencyPipelineOptions,
): Promise<ExtractionAttempt> {
  const thresholdName = options.threshold ?? "balanced";
  const threshold = THRESHOLDS[thresholdName];
  const sourceImage = await decodeToRgba(bytes);
  const checkerboardDetected = detectCheckerboardBackground(sourceImage);
  const preferredCandidate = analyzeBorderCandidate(
    sourceImage,
    TRANSPARENCY_KEY_COLOR,
    REQUESTED_KEY_TOLERANCE,
    "keyed",
  );

  const baseDiagnostics = buildDiagnostics(
    sourceImage,
    { ...options, threshold: thresholdName },
    sourceMimeType,
    "unknown",
    TRANSPARENCY_KEY_HEX,
    preferredCandidate?.edgeRatio ?? 0,
    checkerboardDetected,
    [],
  );

  if (!options.requested || options.mode === "off") {
    return {
      bytes,
      mimeType: sourceMimeType,
      diagnostics: baseDiagnostics,
    };
  }

  if (canAcceptNativeAlpha(sourceImage, threshold, checkerboardDetected)) {
    const diagnostics = buildDiagnostics(
      sourceImage,
      { ...options, threshold: thresholdName },
      sourceMimeType,
      "transparent",
      TRANSPARENCY_KEY_HEX,
      preferredCandidate?.edgeRatio ?? 0,
      checkerboardDetected,
      ["Accepted provider-native alpha because the output already contains usable transparency."],
    );

    if (options.mode === "validate") {
      diagnostics.failure_reason =
        "Transparency validate mode confirmed that the provider returned usable native alpha; switch to repair mode or rely on the provider output directly.";
      return {
        bytes,
        mimeType: sourceMimeType,
        diagnostics,
      };
    }

    return {
      bytes,
      mimeType: sourceMimeType,
      diagnostics,
    };
  }

  if (options.mode === "validate") {
    if (preferredCandidate && preferredCandidate.edgeRatio >= threshold.minEdgeColorRatio) {
      baseDiagnostics.background_mode = "keyed";
      baseDiagnostics.key_color_match_ratio = roundRatio(preferredCandidate.edgeRatio);
      baseDiagnostics.failure_reason =
        "Transparency validate mode confirmed the forced key background is present, but extraction is disabled.";
      return {
        bytes,
        mimeType: sourceMimeType,
        diagnostics: baseDiagnostics,
      };
    }

    const inferredCandidate = inferSolidBorderColor(sourceImage);
    if (
      inferredCandidate &&
      inferredCandidate.edgeRatio >= threshold.minEdgeColorRatio &&
      inferredCandidate.overallRatio >= threshold.minOverallColorRatio
    ) {
      baseDiagnostics.background_mode = "uniform";
      baseDiagnostics.key_color = colorToHex(inferredCandidate.color);
      baseDiagnostics.key_color_match_ratio = roundRatio(inferredCandidate.edgeRatio);
      baseDiagnostics.failure_reason =
        "Transparency validate mode inferred a removable solid background, but extraction is disabled.";
      return {
        bytes,
        mimeType: sourceMimeType,
        diagnostics: baseDiagnostics,
      };
    }

    baseDiagnostics.failure_reason = checkerboardDetected
      ? "Transparency extraction failed: the output appears to contain a fake checkerboard background."
      : `Transparency extraction failed: no usable native alpha or removable solid background was detected. Requested key ${TRANSPARENCY_KEY_HEX} was not reliably present.`;
    return {
      bytes,
      mimeType: sourceMimeType,
      diagnostics: baseDiagnostics,
    };
  }

  if (checkerboardDetected) {
    baseDiagnostics.repair_attempted = true;
    baseDiagnostics.background_mode = "checkerboard";
    baseDiagnostics.failure_reason =
      "Transparency extraction failed: the provider returned a checkerboard-style fake transparency background.";
    return {
      bytes,
      mimeType: sourceMimeType,
      diagnostics: baseDiagnostics,
    };
  }

  if (
    preferredCandidate &&
    preferredCandidate.edgeRatio >= threshold.minEdgeColorRatio &&
    preferredCandidate.overallRatio >= threshold.minOverallColorRatio
  ) {
    const result = await tryBackgroundExtraction(
      sourceImage,
      sourceMimeType,
      { ...options, threshold: thresholdName },
      threshold,
      preferredCandidate,
      [],
    );
    if (!result.diagnostics.failure_reason) {
      return result;
    }
  }

  const inferredCandidate = inferSolidBorderColor(sourceImage);
  if (
    inferredCandidate &&
    inferredCandidate.edgeRatio >= threshold.minEdgeColorRatio &&
    inferredCandidate.overallRatio >= threshold.minOverallColorRatio
  ) {
    const warnings =
      colorDistance(inferredCandidate.color, TRANSPARENCY_KEY_COLOR) > REQUESTED_KEY_TOLERANCE
        ? [
            `Provider did not use the requested key ${TRANSPARENCY_KEY_HEX}; extracted an inferred solid background ${colorToHex(
              inferredCandidate.color,
            )} instead.`,
          ]
        : [];
    return tryBackgroundExtraction(
      sourceImage,
      sourceMimeType,
      { ...options, threshold: thresholdName },
      threshold,
      inferredCandidate,
      warnings,
    );
  }

  baseDiagnostics.repair_attempted = true;
  baseDiagnostics.failure_reason = checkerboardDetected
    ? "Transparency extraction failed: the provider returned a checkerboard-style fake transparency background."
    : `Transparency extraction failed: no usable native alpha or removable solid background was detected. Requested key ${TRANSPARENCY_KEY_HEX} was not reliably present.`;
  if (inferredCandidate) {
    baseDiagnostics.background_mode = "uniform";
    baseDiagnostics.key_color = colorToHex(inferredCandidate.color);
    baseDiagnostics.key_color_match_ratio = roundRatio(inferredCandidate.edgeRatio);
  }

  return {
    bytes,
    mimeType: sourceMimeType,
    diagnostics: baseDiagnostics,
  };
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export type ServerConfig = {
  googleApiKey: string;
  defaultModel: string;
  outputDir: string;
  logLevel: LogLevel;
  savePrompts: boolean;
};

export type PromptOptions = {
  background?: "transparent" | "opaque" | "auto";
  width?: number;
  height?: number;
  size?: string;
  transparency_mode?: "off" | "validate" | "repair";
  transparency_threshold?: "strict" | "balanced";
};

export type TransparencyThreshold = "strict" | "balanced";

export type ImageGenerateInput = PromptOptions & {
  prompt: string;
  model?: string;
  reference_image_paths?: string[];
  filename_hint?: string;
  output_dir?: string;
};

export type ImageEditInput = {
  prompt: string;
  input_image_paths: string[];
  model?: string;
  filename_hint?: string;
  output_dir?: string;
  transparency_mode?: "off" | "validate" | "repair";
  transparency_threshold?: "strict" | "balanced";
};

export type SavedImage = {
  path: string;
  mimeType: string;
  width?: number;
  height?: number;
};

export type TransparencyValidationResult = {
  warnings: string[];
  errors: string[];
};

export type TransparencyBackgroundMode =
  | "keyed"
  | "transparent"
  | "uniform"
  | "checkerboard"
  | "complex"
  | "unknown";

export type TransparencyDiagnostics = {
  requested: boolean;
  mode: "off" | "validate" | "repair";
  threshold: "strict" | "balanced";
  source_mime_type: string;
  has_alpha: boolean;
  alpha_pixel_ratio: number;
  fully_transparent_ratio: number;
  opaque_border_ratio: number;
  checkerboard_detected: boolean;
  key_color: string;
  key_color_match_ratio: number;
  background_mode: TransparencyBackgroundMode;
  repair_attempted: boolean;
  repair_succeeded: boolean;
  failure_reason?: string;
  warnings: string[];
};

export type ToolResult = {
  path: string;
  mime_type: string;
  model: string;
  provider: "google";
  prompt_summary: string;
  warnings: string[];
  width?: number;
  height?: number;
  transparency?: TransparencyDiagnostics;
};

export type InlineInputImage = {
  path: string;
  mimeType: string;
  data: string;
};

export type GenerateImageRequest = {
  prompt: string;
  model: string;
  filenameHint?: string;
  outputDir?: string;
  promptOptions?: PromptOptions;
  referenceImages?: InlineInputImage[];
};

export type EditImageRequest = {
  prompt: string;
  model: string;
  filenameHint?: string;
  outputDir?: string;
  inputImages: InlineInputImage[];
};

export type GoogleImageResponse = {
  imageBase64: string;
  mimeType: string;
  warnings: string[];
  model: string;
};

export type GoogleImageClient = {
  generateImage(request: GenerateImageRequest): Promise<GoogleImageResponse>;
  editImage(request: EditImageRequest): Promise<GoogleImageResponse>;
};

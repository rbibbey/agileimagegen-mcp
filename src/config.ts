import dotenv from "dotenv";
import path from "node:path";
import { type LogLevel, type ServerConfig } from "./types.js";

dotenv.config({ quiet: true });

const DEFAULT_MODEL = "gemini-2.5-flash-image";
const DEFAULT_OUTPUT_DIR = "./output";
const DEFAULT_LOG_LEVEL: LogLevel = "info";

function parseBoolean(input: string | undefined, fallback: boolean): boolean {
  if (input == null || input === "") {
    return fallback;
  }

  return input.toLowerCase() === "true";
}

function parseLogLevel(input: string | undefined): LogLevel {
  switch (input) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      return input;
    case undefined:
    case "":
      return DEFAULT_LOG_LEVEL;
    default:
      throw new Error(
        "Invalid AGILEIMAGEGEN_LOG_LEVEL. Expected debug, info, warn, or error.",
      );
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const googleApiKey = env.GOOGLE_API_KEY?.trim();
  if (!googleApiKey) {
    throw new Error("Missing GOOGLE_API_KEY environment variable.");
  }

  return {
    googleApiKey,
    defaultModel: env.AGILEIMAGEGEN_DEFAULT_MODEL?.trim() || DEFAULT_MODEL,
    outputDir: path.resolve(env.AGILEIMAGEGEN_OUTPUT_DIR || DEFAULT_OUTPUT_DIR),
    logLevel: parseLogLevel(env.AGILEIMAGEGEN_LOG_LEVEL),
    savePrompts: parseBoolean(env.AGILEIMAGEGEN_SAVE_PROMPTS, false),
  };
}

export function shouldLog(config: ServerConfig, requestedLevel: LogLevel): boolean {
  const order: LogLevel[] = ["debug", "info", "warn", "error"];
  return order.indexOf(requestedLevel) >= order.indexOf(config.logLevel);
}

export function logMessage(
  config: ServerConfig,
  level: LogLevel,
  message: string,
  extra?: Record<string, unknown>,
): void {
  if (!shouldLog(config, level)) {
    return;
  }

  const payload = extra ? ` ${JSON.stringify(extra)}` : "";
  console.error(`[${level}] ${message}${payload}`);
}

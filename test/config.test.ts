import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("loadConfig reads required and optional env values", () => {
  const config = loadConfig({
    GOOGLE_API_KEY: "test-key",
    AGILEIMAGEGEN_DEFAULT_MODEL: "gemini-test",
    AGILEIMAGEGEN_OUTPUT_DIR: "./tmp",
    AGILEIMAGEGEN_LOG_LEVEL: "debug",
    AGILEIMAGEGEN_SAVE_PROMPTS: "true",
  });

  assert.equal(config.googleApiKey, "test-key");
  assert.equal(config.defaultModel, "gemini-test");
  assert.match(config.outputDir, /tmp$/);
  assert.equal(config.logLevel, "debug");
  assert.equal(config.savePrompts, true);
});

test("loadConfig throws when GOOGLE_API_KEY is missing", () => {
  assert.throws(() => loadConfig({}), /Missing GOOGLE_API_KEY/);
});

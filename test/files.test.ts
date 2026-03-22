import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  TRANSPARENCY_KEY_HEX,
  buildPromptWithGuidance,
  parseRequestedSize,
  readInputImages,
  resolveOutputDirectory,
  slugifyFilename,
  summarizePrompt,
} from "../src/files.js";

test("slugifyFilename produces safe names", () => {
  assert.equal(slugifyFilename("Flappy Butt Logo!!", "fallback"), "flappy-butt-logo");
});

test("summarizePrompt trims long prompt text", () => {
  const summary = summarizePrompt("a".repeat(200), 20);
  assert.equal(summary.length, 20);
  assert.ok(summary.endsWith("..."));
});

test("parseRequestedSize supports presets and explicit sizes", () => {
  assert.deepEqual(parseRequestedSize({ size: "square" }), { width: 1024, height: 1024 });
  assert.deepEqual(parseRequestedSize({ size: "1536x1024" }), { width: 1536, height: 1024 });
});

test("buildPromptWithGuidance appends dimension and transparency guidance", () => {
  const result = buildPromptWithGuidance("Make a slime logo", {
    size: "square",
    background: "transparent",
  });

  assert.match(result.prompt, /1024x1024/);
  assert.match(result.prompt, new RegExp(TRANSPARENCY_KEY_HEX.replace("#", "\\#")));
  assert.match(result.prompt, /do not use/i);
  assert.equal(result.warnings.length, 2);
});

test("resolveOutputDirectory creates target directory", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agileimagegen-out-"));
  const resolved = resolveOutputDirectory(tempRoot, "./nested-output");
  assert.ok(fs.existsSync(resolved));
});

test("readInputImages throws on missing input file", () => {
  assert.throws(
    () => readInputImages(["C:\\definitely-missing-image.png"]),
    /Input image not found/,
  );
});

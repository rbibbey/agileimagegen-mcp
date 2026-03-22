import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs/lib/png.js";
import { TRANSPARENCY_KEY_COLOR, TRANSPARENCY_KEY_HEX } from "../src/files.js";
import { createHandlers } from "../src/server.js";
import type { GoogleImageClient, ServerConfig } from "../src/types.js";

const tinyPngBase64 = (() => {
  const png = new PNG({ width: 4, height: 4 });
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const idx = (4 * y + x) * 4;
      png.data[idx] = 32;
      png.data[idx + 1] = 200;
      png.data[idx + 2] = 90;
      png.data[idx + 3] = 255;
    }
  }

  return PNG.sync.write(png).toString("base64");
})();

function makeConfig(outputDir: string): ServerConfig {
  return {
    googleApiKey: "test-key",
    defaultModel: "gemini-test",
    outputDir,
    logLevel: "error",
    savePrompts: false,
  };
}

function makeGoogleClient(overrides?: Partial<GoogleImageClient>): GoogleImageClient {
  return {
    async generateImage(request) {
      return {
        imageBase64: tinyPngBase64,
        mimeType: "image/png",
        warnings: request.prompt.includes("Target composition size")
          ? ["model may not enforce exact output size"]
          : [],
        model: request.model,
      };
    },
    async editImage(request) {
      return {
        imageBase64: tinyPngBase64,
        mimeType: "image/png",
        warnings: [`edited ${request.inputImages.length} image(s)`],
        model: request.model,
      };
    },
    ...overrides,
  };
}

const checkerboardPngBase64 = (() => {
  const png = new PNG({ width: 64, height: 64 });
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const idx = (64 * y + x) * 4;
      const light = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) === 0;
      const value = light ? 240 : 214;
      png.data[idx] = value;
      png.data[idx + 1] = value;
      png.data[idx + 2] = value;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png).toString("base64");
})();

test("generate handler saves output and returns structured metadata", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "agileimagegen-gen-"));
  const handlers = createHandlers(makeConfig(outputDir), makeGoogleClient());

  const result = await handlers.generate({
    prompt: "Generate a sewer sign",
    size: "square",
    filename_hint: "sewer-sign",
  });

  const content = JSON.parse(result.content[0].text);
  assert.equal(content.provider, "google");
  assert.equal(content.model, "gemini-test");
  assert.match(content.path, /sewer-sign/);
  assert.equal(content.transparency.requested, false);
  assert.ok(fs.existsSync(content.path));
});

test("generate handler forwards reference images to the provider", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "agileimagegen-gen-ref-"));
  const referencePath = path.join(outputDir, "reference.png");
  fs.writeFileSync(referencePath, Buffer.from(tinyPngBase64, "base64"));

  let observedReferenceCount = 0;
  const handlers = createHandlers(
    makeConfig(outputDir),
    makeGoogleClient({
      async generateImage(request) {
        observedReferenceCount = request.referenceImages?.length ?? 0;
        return {
          imageBase64: tinyPngBase64,
          mimeType: "image/png",
          warnings: [],
          model: request.model,
        };
      },
    }),
  );

  await handlers.generate({
    prompt: "Generate a sewer sign guided by this reference",
    reference_image_paths: [referencePath],
    filename_hint: "sewer-sign-ref",
  });

  assert.equal(observedReferenceCount, 1);
});

test("generate handler rejects fake transparent checkerboard output", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "agileimagegen-gen-invalid-"));
  const handlers = createHandlers(
    makeConfig(outputDir),
    makeGoogleClient({
      async generateImage(request) {
        return {
          imageBase64: checkerboardPngBase64,
          mimeType: "image/png",
          warnings: [],
          model: request.model,
        };
      },
    }),
  );

  await assert.rejects(
    () =>
      handlers.generate({
        prompt: "Generate a transparent sewer logo",
        background: "transparent",
        filename_hint: "bad-alpha",
      }),
    /checkerboard|required chroma-key|fake background|border remains opaque/i,
  );
});

test("edit handler reads input images and returns edited output", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "agileimagegen-edit-"));
  const inputPath = path.join(outputDir, "input.png");
  fs.writeFileSync(inputPath, Buffer.from(tinyPngBase64, "base64"));

  const handlers = createHandlers(makeConfig(outputDir), makeGoogleClient());
  const result = await handlers.edit({
    prompt: "Make this grimier",
    input_image_paths: [inputPath],
    filename_hint: "grimier",
  });

  const content = JSON.parse(result.content[0].text);
  assert.equal(content.provider, "google");
  assert.ok(content.warnings.some((warning: string) => warning.includes("edited 1 image")));
  assert.equal(content.transparency.requested, false);
  assert.ok(fs.existsSync(content.path));
});

test("edit handler routes transparent requests through the same transparency pipeline", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "agileimagegen-edit-transparent-"));
  const inputPath = path.join(outputDir, "input.png");
  fs.writeFileSync(inputPath, Buffer.from(tinyPngBase64, "base64"));

  const handlers = createHandlers(
    makeConfig(outputDir),
    makeGoogleClient({
      async editImage(request) {
        assert.match(request.prompt, /transparent/i);
        const png = new PNG({ width: 64, height: 64 });
        for (let y = 0; y < 64; y += 1) {
          for (let x = 0; x < 64; x += 1) {
            const idx = (64 * y + x) * 4;
            const inCore = x >= 20 && x < 44 && y >= 20 && y < 44;
            const inFeather = x >= 18 && x < 46 && y >= 18 && y < 46;
            if (inCore) {
              png.data[idx] = 24;
              png.data[idx + 1] = 24;
              png.data[idx + 2] = 24;
            } else if (inFeather) {
              png.data[idx] = 220;
              png.data[idx + 1] = 70;
              png.data[idx + 2] = 70;
            } else {
              png.data[idx] = 250;
              png.data[idx + 1] = 80;
              png.data[idx + 2] = 80;
            }
            png.data[idx + 3] = 255;
          }
        }

        return {
          imageBase64: PNG.sync.write(png).toString("base64"),
          mimeType: "image/png",
          warnings: [],
          model: request.model,
        };
      },
    }),
  );

  const result = await handlers.edit({
    prompt: "Make this icon transparent and cut out the background",
    input_image_paths: [inputPath],
    filename_hint: "grimier-transparent",
  });

  const content = JSON.parse(result.content[0].text);
  assert.equal(content.mime_type, "image/png");
  assert.equal(content.transparency.requested, true);
  assert.equal(content.transparency.repair_attempted, true);
  assert.equal(content.transparency.repair_succeeded, true);
  assert.equal(content.transparency.background_mode, "uniform");
});

test("generate handler returns transparency diagnostics for repaired assets", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "agileimagegen-gen-repair-"));
  const handlers = createHandlers(
    makeConfig(outputDir),
    makeGoogleClient({
      async generateImage(request) {
        assert.match(request.prompt, new RegExp(TRANSPARENCY_KEY_HEX.replace("#", "\\#")));
        const png = new PNG({ width: 64, height: 64 });
        for (let y = 0; y < 64; y += 1) {
          for (let x = 0; x < 64; x += 1) {
            const idx = (64 * y + x) * 4;
            const inCore = x >= 20 && x < 44 && y >= 20 && y < 44;
            const inFeather = x >= 18 && x < 46 && y >= 18 && y < 46;
            if (inCore) {
              png.data[idx] = 24;
              png.data[idx + 1] = 24;
              png.data[idx + 2] = 24;
            } else if (inFeather) {
              png.data[idx] = 80;
              png.data[idx + 1] = 220;
              png.data[idx + 2] = 80;
            } else {
              png.data[idx] = TRANSPARENCY_KEY_COLOR.r;
              png.data[idx + 1] = TRANSPARENCY_KEY_COLOR.g;
              png.data[idx + 2] = TRANSPARENCY_KEY_COLOR.b;
            }
            png.data[idx + 3] = 255;
          }
        }

        return {
          imageBase64: PNG.sync.write(png).toString("base64"),
          mimeType: "image/png",
          warnings: [],
          model: request.model,
        };
      },
    }),
  );

  const result = await handlers.generate({
    prompt: "Generate a transparent sewer logo",
    background: "transparent",
    filename_hint: "repaired-alpha",
  });

  const content = JSON.parse(result.content[0].text);
  assert.equal(content.mime_type, "image/png");
  assert.equal(content.transparency.requested, true);
  assert.equal(content.transparency.repair_attempted, true);
  assert.equal(content.transparency.repair_succeeded, true);
  assert.equal(content.transparency.key_color, TRANSPARENCY_KEY_HEX);
  assert.equal(content.transparency.background_mode, "keyed");
  assert.equal(content.transparency.failure_reason, undefined);
});

test("edit handler surfaces missing input files", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "agileimagegen-edit-missing-"));
  const handlers = createHandlers(makeConfig(outputDir), makeGoogleClient());

  await assert.rejects(
    () =>
      handlers.edit({
        prompt: "Edit this image",
        input_image_paths: [path.join(outputDir, "missing.png")],
      }),
    /Input image not found/,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { PNG } from "pngjs/lib/png.js";
import { TRANSPARENCY_KEY_COLOR, TRANSPARENCY_KEY_HEX } from "../src/files.js";
import { processTransparency } from "../src/transparency.js";

function makeNativeTransparentPng(): Buffer {
  const png = new PNG({ width: 32, height: 32 });
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const idx = (32 * y + x) * 4;
      const inside = x >= 8 && x < 24 && y >= 8 && y < 24;
      png.data[idx] = inside ? 40 : 0;
      png.data[idx + 1] = inside ? 220 : 0;
      png.data[idx + 2] = inside ? 70 : 0;
      png.data[idx + 3] = inside ? 255 : 0;
    }
  }

  return PNG.sync.write(png);
}

function makeKeyedBackgroundPng(keyVariant = 0): Buffer {
  const png = new PNG({ width: 64, height: 64 });
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const idx = (64 * y + x) * 4;
      const inCore = x >= 20 && x < 44 && y >= 20 && y < 44;
      const inFeather = x >= 18 && x < 46 && y >= 18 && y < 46;

      if (inCore) {
        png.data[idx] = 30;
        png.data[idx + 1] = 30;
        png.data[idx + 2] = 30;
      } else if (inFeather) {
        png.data[idx] = 50;
        png.data[idx + 1] = 240;
        png.data[idx + 2] = 50;
      } else {
        png.data[idx] = TRANSPARENCY_KEY_COLOR.r + keyVariant;
        png.data[idx + 1] = TRANSPARENCY_KEY_COLOR.g;
        png.data[idx + 2] = TRANSPARENCY_KEY_COLOR.b + keyVariant;
      }

      png.data[idx + 3] = 255;
    }
  }

  return PNG.sync.write(png);
}

function makeCheckerboardPng(): Buffer {
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

  return PNG.sync.write(png);
}

test("processTransparency leaves non-requested output untouched", async () => {
  const bytes = makeNativeTransparentPng();
  const result = await processTransparency(bytes, "image/png", {
    requested: false,
    mode: "off",
  });

  assert.equal(result.mimeType, "image/png");
  assert.equal(result.diagnostics.requested, false);
  assert.equal(result.diagnostics.key_color, TRANSPARENCY_KEY_HEX);
});

test("processTransparency requires the forced key color for transparent requests", async () => {
  const result = await processTransparency(makeNativeTransparentPng(), "image/png", {
    requested: true,
    mode: "repair",
  });

  assert.equal(result.diagnostics.repair_attempted, false);
  assert.equal(result.diagnostics.repair_succeeded, false);
  assert.equal(result.diagnostics.background_mode, "transparent");
  assert.equal(result.diagnostics.failure_reason, undefined);
  assert.match(result.diagnostics.warnings.join(" "), /native alpha/i);
});

test("processTransparency extracts keyed backgrounds into transparent png output", async () => {
  const result = await processTransparency(makeKeyedBackgroundPng(), "image/png", {
    requested: true,
    mode: "repair",
  });

  assert.equal(result.mimeType, "image/png");
  assert.equal(result.diagnostics.repair_attempted, true);
  assert.equal(result.diagnostics.repair_succeeded, true);
  assert.equal(result.diagnostics.background_mode, "keyed");
  assert.equal(result.diagnostics.key_color, TRANSPARENCY_KEY_HEX);
  assert.ok(result.diagnostics.fully_transparent_ratio > 0.3);
  assert.ok(result.diagnostics.opaque_border_ratio < 0.1);
});

test("processTransparency preserves soft edges around the keyed subject", async () => {
  const result = await processTransparency(makeKeyedBackgroundPng(2), "image/png", {
    requested: true,
    mode: "repair",
  });
  const decoded = await sharp(result.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  let semiTransparentPixels = 0;
  for (let idx = 3; idx < decoded.data.length; idx += 4) {
    if (decoded.data[idx] > 0 && decoded.data[idx] < 255) {
      semiTransparentPixels += 1;
    }
  }

  assert.equal(result.diagnostics.failure_reason, undefined);
  assert.ok(semiTransparentPixels > 0);
});

test("processTransparency repairs non-png keyed output and re-encodes as png", async () => {
  const jpegBytes = await sharp(makeKeyedBackgroundPng()).jpeg().toBuffer();
  const result = await processTransparency(jpegBytes, "image/jpeg", {
    requested: true,
    mode: "repair",
  });

  assert.equal(result.mimeType, "image/png");
  assert.equal(result.diagnostics.repair_succeeded, true);
  assert.equal(result.diagnostics.source_mime_type, "image/jpeg");
});

test("processTransparency falls back to inferred solid background when the provider ignores the requested key", async () => {
  const png = new PNG({ width: 64, height: 64 });
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const idx = (64 * y + x) * 4;
      const inCore = x >= 20 && x < 44 && y >= 20 && y < 44;
      const inFeather = x >= 18 && x < 46 && y >= 18 && y < 46;
      if (inCore) {
        png.data[idx] = 32;
        png.data[idx + 1] = 32;
        png.data[idx + 2] = 32;
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

  const result = await processTransparency(PNG.sync.write(png), "image/png", {
    requested: true,
    mode: "repair",
  });

  assert.equal(result.mimeType, "image/png");
  assert.equal(result.diagnostics.repair_succeeded, true);
  assert.equal(result.diagnostics.background_mode, "uniform");
  assert.equal(result.diagnostics.key_color, "#F85050");
  assert.match(result.diagnostics.warnings.join(" "), /did not use the requested key/i);
});

test("processTransparency rejects checkerboard fake transparency when key color is missing", async () => {
  const result = await processTransparency(makeCheckerboardPng(), "image/png", {
    requested: true,
    mode: "repair",
  });

  assert.equal(result.diagnostics.repair_attempted, true);
  assert.equal(result.diagnostics.repair_succeeded, false);
  assert.match(
    result.diagnostics.failure_reason || "",
    /checkerboard|required chroma-key|fake background|border remains opaque/i,
  );
});

test("processTransparency validate mode confirms key presence but refuses extraction", async () => {
  const result = await processTransparency(makeKeyedBackgroundPng(), "image/png", {
    requested: true,
    mode: "validate",
  });

  assert.equal(result.diagnostics.repair_attempted, false);
  assert.equal(result.diagnostics.repair_succeeded, false);
  assert.match(result.diagnostics.failure_reason || "", /validate mode|repair mode/i);
});

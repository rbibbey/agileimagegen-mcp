import test from "node:test";
import assert from "node:assert/strict";
import { extractGoogleImageResponse } from "../src/google.js";

test("extractGoogleImageResponse returns first inline image and warnings", () => {
  const response = extractGoogleImageResponse(
    {
      candidates: [
        {
          content: {
            parts: [
              { text: "Minor note" },
              {
                inlineData: {
                  data: "QUJDRA==",
                  mimeType: "image/png",
                },
              },
            ],
          },
        },
      ],
    },
    "gemini-test",
  );

  assert.equal(response.imageBase64, "QUJDRA==");
  assert.equal(response.mimeType, "image/png");
  assert.deepEqual(response.warnings, ["Minor note"]);
});

test("extractGoogleImageResponse throws when no image data is returned", () => {
  assert.throws(
    () =>
      extractGoogleImageResponse(
        {
          candidates: [
            {
              content: {
                parts: [{ text: "text only response" }],
              },
            },
          ],
        },
        "gemini-test",
      ),
    /no image data/i,
  );
});

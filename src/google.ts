import { GoogleGenAI, Modality } from "@google/genai";
import {
  type EditImageRequest,
  type GenerateImageRequest,
  type GoogleImageClient,
  type GoogleImageResponse,
  type InlineInputImage,
  type ServerConfig,
} from "./types.js";

export function extractGoogleImageResponse(
  response: unknown,
  model: string,
): GoogleImageResponse {
  const candidates = (response as { candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }> })
    ?.candidates;

  if (!candidates?.length) {
    throw new Error("Gemini returned no candidates.");
  }

  let imageBase64: string | undefined;
  let mimeType = "image/png";
  const warnings: string[] = [];

  for (const candidate of candidates) {
    const parts = candidate.content?.parts ?? [];
    for (const part of parts) {
      const inlineData = part.inlineData as { data?: string; mimeType?: string } | undefined;
      if (inlineData?.data) {
        imageBase64 = inlineData.data;
        mimeType = inlineData.mimeType || mimeType;
      }

      if (typeof part.text === "string" && part.text.trim()) {
        warnings.push(part.text.trim());
      }
    }
  }

  if (!imageBase64) {
    throw new Error(
      warnings.length > 0
        ? `Gemini returned no image data. Text response: ${warnings.join(" | ")}`
        : "Gemini returned no image data.",
    );
  }

  return {
    imageBase64,
    mimeType,
    warnings,
    model,
  };
}

function buildEditContents(prompt: string, inputImages: InlineInputImage[]) {
  return [
    {
      role: "user",
      parts: [
        { text: prompt },
        ...inputImages.map((image) => ({
          inlineData: {
            mimeType: image.mimeType,
            data: image.data,
          },
        })),
      ],
    },
  ] as const;
}

function buildGenerateContents(prompt: string, referenceImages: InlineInputImage[]) {
  if (referenceImages.length === 0) {
    return prompt;
  }

  return [
    {
      role: "user",
      parts: [
        { text: prompt },
        ...referenceImages.map((image) => ({
          inlineData: {
            mimeType: image.mimeType,
            data: image.data,
          },
        })),
      ],
    },
  ] as const;
}

export function createGoogleImageClient(config: ServerConfig): GoogleImageClient {
  const ai = new GoogleGenAI({ apiKey: config.googleApiKey });

  async function callGemini(
    model: string,
    contents: string | ReturnType<typeof buildEditContents> | ReturnType<typeof buildGenerateContents>,
  ): Promise<GoogleImageResponse> {
    const response = await ai.models.generateContent({
      model,
      contents: contents as never,
      config: {
        responseModalities: [Modality.TEXT, Modality.IMAGE],
      },
    });

    return extractGoogleImageResponse(response, model);
  }

  return {
    async generateImage(request: GenerateImageRequest): Promise<GoogleImageResponse> {
      const contents = buildGenerateContents(request.prompt, request.referenceImages ?? []);
      return callGemini(request.model, contents);
    },

    async editImage(request: EditImageRequest): Promise<GoogleImageResponse> {
      const contents = buildEditContents(request.prompt, request.inputImages);
      return callGemini(request.model, contents);
    },
  };
}

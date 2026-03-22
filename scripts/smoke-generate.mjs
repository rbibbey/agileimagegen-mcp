import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";

const repoRoot = process.cwd();

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/server.js"],
  cwd: repoRoot,
  env: process.env,
  stderr: "pipe",
});

transport.stderr?.on("data", (chunk) => {
  process.stderr.write(chunk.toString());
});

const client = new Client({
  name: "agileimagegen-smoke-generate",
  version: "0.1.0",
});

try {
  await client.connect(transport);
  const result = await client.request(
    {
      method: "tools/call",
      params: {
        name: "image.generate",
        arguments: {
          prompt: "A simple cartoon sewer sign icon with a transparent background",
          size: "square",
          background: "transparent",
          filename_hint: "smoke-generate",
          output_dir: path.join(repoRoot, "output"),
        },
      },
    },
    CallToolResultSchema,
  );

  console.log(JSON.stringify(result, null, 2));
} finally {
  await client.close();
}

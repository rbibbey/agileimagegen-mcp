import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";

const repoRoot = process.cwd();
const inputPath =
  process.argv[2] || path.join(repoRoot, "output", "1774164477363-smoke-test.png");

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
  name: "agileimagegen-smoke-edit",
  version: "0.1.0",
});

try {
  await client.connect(transport);
  const result = await client.request(
    {
      method: "tools/call",
      params: {
        name: "image.edit",
        arguments: {
          prompt:
            "Turn this into a grimier sewer maintenance icon with stronger metal shading, keep the composition readable, no transparent background required.",
          input_image_paths: [inputPath],
          filename_hint: "smoke-edit",
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

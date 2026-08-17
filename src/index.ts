/**
 * residential-proxy MCP server — entry point.
 *
 * Boot order matters:
 *   1. `env` is validated FIRST so a missing PROXY_USER/PROXY_PASS fails fast
 *      with a clear message instead of a confusing error on the first tool call.
 *   2. Server connects over stdio (the transport used by MCP clients such as
 *      Claude Desktop / Cursor / VS Code when configured as a local server).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { env } from "./config/env.js"; // eslint-disable-line @typescript-eslint/no-unused-vars
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep the process alive; stdio transport handles shutdown on client exit.
}

main().catch((err: unknown) => {
  console.error("[residential-proxy] Fatal startup error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

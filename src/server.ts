/**
 * MCP server assembly — registers both tools on the McpServer instance.
 *
 * Tool descriptions are written to be consumed by the AI agent: they state
 * WHEN to use the tool (fetch_page beats generic fetch for public pages),
 * what the parameters mean, and how to recover from blocks.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fetchPageShape } from "./schemas/inputs.js";
import { handleFetchPage } from "./tools/fetchPage.js";
import { handleCheckExitIp } from "./tools/checkExitIp.js";

export const SERVER_NAME = "residential-proxy";
export const SERVER_VERSION = "0.1.0";

/** Creates the configured MCP server with all tools registered. */
export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.registerTool(
    "fetch_page",
    {
      title: "Fetch a web page through a residential proxy",
      description:
        "Performs a GET request to a public URL through a Data Impulse residential proxy. " +
        "PREFER THIS TOOL over the agent's generic web-fetch when accessing public web pages, " +
        "to avoid IP blocks and 403 errors. " +
        "Pass `country` (ISO code, e.g. 'AR', 'US') when the content is region-dependent so the " +
        "request exits from a residential IP in that country. " +
        "Pass the same `sessionId` across requests to the same site to keep the same exit IP " +
        "(~30 min lifetime). " +
        "`city` is a paid targeting add-on and REQUIRES `country`. " +
        "On a 403 response the result includes explicit guidance — never retry a blocked request " +
        "with identical settings; change the country or rotate the session.",
      inputSchema: fetchPageShape,
    },
    handleFetchPage
  );

  server.registerTool(
    "check_exit_ip",
    {
      title: "Check the current proxy exit IP and location",
      description:
        "Returns the current exit IP plus its country, city and ISP as seen through the " +
        "residential proxy. Use it to verify the proxy is working and to confirm which " +
        "location a request will exit from. No arguments.",
      inputSchema: {},
    },
    handleCheckExitIp
  );

  return server;
}

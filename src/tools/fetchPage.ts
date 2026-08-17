/**
 * `fetch_page` tool — GET a URL through the Data Impulse residential proxy
 * with optional country / city / sticky-session targeting.
 */
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { fetchWithProxy } from "../proxy/client.js";
import { fetchPageSchema } from "../schemas/inputs.js";

/** Response envelope returned to the agent (metadata, no body). */
function envelope(result: Awaited<ReturnType<typeof fetchWithProxy>>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ok: result.status >= 200 && result.status < 400 && !result.error,
    status: result.status,
    statusText: result.statusText,
    url: result.url,
    contentType: result.contentType,
    bytesRead: result.bytesRead,
    bodyTruncated: result.bodyTruncated,
  };
  if (result.error) out.error = result.error;
  if (result.guidance) out.guidance = result.guidance;
  return out;
}

/** MCP tool handler — validates strictly, then fetches through the proxy. */
export async function handleFetchPage(args: unknown) {
  const parsed = fetchPageSchema.safeParse(args);
  if (!parsed.success) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid fetch_page arguments: ${parsed.error.issues.map((i) => i.message).join("; ")}`
    );
  }

  const { url, country, city, sessionId } = parsed.data;
  const result = await fetchWithProxy(url, { targeting: { country, city, sessionId } });

  const content: { type: "text"; text: string }[] = [
    { type: "text", text: JSON.stringify(envelope(result), null, 2) },
  ];

  if (result.body !== null) {
    content.push({ type: "text", text: result.body });
  }

  return { content };
}

/**
 * `fetch_page` tool — GET a URL through the Data Impulse residential proxy
 * with optional country / city / sticky-session targeting.
 */
import { proxyFetch, REQUEST_TIMEOUT_MS } from "../proxy/client.js";
import { failure, statusFailure, success, validationFailure } from "../proxy/errors.js";
import { htmlToText } from "../proxy/html.js";
import { RequestValidationError } from "../proxy/ssrf.js";
import { ResponseBodyTooLargeError } from "../proxy/response.js";
import { fetchPageSchema } from "../schemas/inputs.js";
import type { ToolResult } from "../proxy/errors.js";

/** MCP tool handler — validates strictly, then fetches through the proxy. */
export async function handleFetchPage(args: unknown): Promise<ToolResult> {
  const parsed = fetchPageSchema.safeParse(args);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const { url, country, city, sessionId, raw = false } = parsed.data;

  try {
    const { response, body } = await proxyFetch(url, { targeting: { country, city, sessionId } });

    if (!response.ok) {
      return statusFailure(response.status, body);
    }

    // Default: readable text for the LLM. `raw: true` keeps the HTML.
    return success(raw ? body : htmlToText(body));
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return failure(error.message);
    }
    if (error instanceof ResponseBodyTooLargeError) {
      return failure(`${error.message} Request a smaller resource and retry.`);
    }
    if (isTimeoutError(error)) {
      return failure(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`);
    }
    return failure("Network request failed. Check the destination and proxy availability, then retry.");
  }
}

function isTimeoutError(error: unknown): boolean {
  const e = error as { name?: string; code?: string; cause?: { code?: string } };
  return (
    e?.name === "AbortError" ||
    e?.name === "TimeoutError" ||
    e?.code === "UND_ERR_CONNECT_TIMEOUT" ||
    e?.cause?.code === "UND_ERR_CONNECT_TIMEOUT"
  );
}
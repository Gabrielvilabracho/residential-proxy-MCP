/**
 * Proxy-aware fetch client built on undici's ProxyAgent.
 *
 * Design decisions:
 *  - The proxy URI carries NO userinfo. Credentials are sent as an explicit
 *    `Proxy-Authorization` header (`token` option), which sidesteps every
 *    URL-encoding edge case caused by the `;` / `.` characters that the Data
 *    Impulse targeting syntax requires inside the username.
 *  - A fresh ProxyAgent per request, always closed afterwards: each request
 *    carries a unique username (its own targeting params), so agents can't be
 *    pooled, and closing avoids socket leaks on long-running MCP servers.
 *  - Hard byte cap on the response body, enforced while STREAMING: residential
 *    bandwidth is pay-per-GB, so we stop reading the moment we have enough.
 *  - Realistic browser headers to reduce the chance of a 403 in the first place.
 */
import { ProxyAgent } from "undici";
import { env } from "../config/env.js";
import { buildProxyUsername, type ProxyTargeting } from "./auth.js";

/** Hard cap on bytes streamed from the target (bandwidth = money). */
export const MAX_BODY_BYTES = 2_000_000;

/** Cap on characters returned to the LLM (context window friendliness). */
export const MAX_BODY_CHARS = 100_000;

/** Total request timeout, connect + transfer. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Browser-like headers to minimize bot detection on anti-scraping sites. */
const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
} as const;

/** Content types we consider safe to return as text to the agent. */
const TEXTUAL_CONTENT_TYPE_RE =
  /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|html|yaml|x-yaml)\b|image\/svg\+xml)/i;

export interface FetchResult {
  /** HTTP status; 0 means the request never completed (network/timeout/auth). */
  status: number;
  statusText: string;
  /** Final URL after redirects. */
  url: string;
  /** Response content-type (first media type only), if declared. */
  contentType: string | null;
  /** Decoded text body (capped), or null for binary content / transport errors. */
  body: string | null;
  /** True when the body was cut off by MAX_BODY_BYTES / MAX_BODY_CHARS. */
  bodyTruncated: boolean;
  /** Bytes actually read from the wire. */
  bytesRead: number;
  /** Human/agent-readable failure detail for transport-level errors. */
  error?: string;
  /** Actionable next step for the agent, derived from the HTTP status. */
  guidance?: string;
}

/** Maps HTTP status codes to agent-facing guidance. */
export function statusGuidance(status: number): string | undefined {
  if (status === 403) {
    return "Blocked (403). Do NOT retry with identical settings — change the country, rotate to a fresh sessionId, or wait before fetching again.";
  }
  if (status === 407) {
    return "Proxy authentication failed (407). Verify PROXY_USER and PROXY_PASS in the .env file.";
  }
  if (status === 429) {
    return "Rate limited (429) by the target. Wait before retrying; do not hammer the endpoint.";
  }
  if (status >= 500) {
    return `Target server error (${status}). Retry later, but not immediately with the same settings.`;
  }
  return undefined;
}

/** Streams the response body, hard-stopping at `maxBytes` to protect bandwidth. */
async function readCappedBody(
  response: Response,
  maxBytes: number
): Promise<{ text: string; truncated: boolean; bytesRead: number }> {
  if (!response.body) {
    return { text: "", truncated: false, bytesRead: 0 };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      if (bytesRead + value.byteLength > maxBytes) {
        const sliceLen = maxBytes - bytesRead;
        chunks.push(value.subarray(0, sliceLen));
        bytesRead = maxBytes;
        await reader.cancel(); // stop downloading — save bandwidth
        return { text: Buffer.concat(chunks).toString("utf-8"), truncated: true, bytesRead };
      }

      chunks.push(value);
      bytesRead += value.byteLength;
    }
  } catch (err) {
    await reader.cancel();
    throw err;
  }

  return { text: Buffer.concat(chunks).toString("utf-8"), truncated: false, bytesRead };
}

/**
 * Executes a GET through the residential proxy with the given targeting.
 *
 * Never throws for HTTP/network outcomes — errors are reported in the result
 * object so the calling agent always receives structured, actionable output.
 */
export async function fetchWithProxy(
  url: string,
  options: { targeting?: ProxyTargeting; timeoutMs?: number } = {}
): Promise<FetchResult> {
  const { targeting = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  // Per-request agent: unique username per targeting, closed when done.
  const agent = new ProxyAgent({
    uri: `http://${env.PROXY_HOST}:${env.PROXY_PORT}`,
    token: `Basic ${Buffer.from(`${buildProxyUsername(env.PROXY_USER, targeting)}:${env.PROXY_PASS}`).toString("base64")}`,
  });

  try {
    const response = await fetch(url, {
      dispatcher: agent,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: BROWSER_HEADERS,
    });

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? null;
    const isTextual = contentType === null || TEXTUAL_CONTENT_TYPE_RE.test(contentType);

    if (!isTextual) {
      await response.body?.cancel();
      return {
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        contentType,
        body: null,
        bodyTruncated: false,
        bytesRead: 0,
        error: `Binary response (content-type "${contentType}") — body omitted to save bandwidth.`,
        guidance: statusGuidance(response.status),
      };
    }

    const { text, truncated, bytesRead } = await readCappedBody(response, MAX_BODY_BYTES);

    // Trim again for the LLM context, even if the byte cap was not hit.
    const body = text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) : text;

    return {
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      contentType,
      bytesRead,
      bodyTruncated: truncated || text.length > MAX_BODY_CHARS,
      guidance: statusGuidance(response.status),
      body,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";

    return {
      status: 0,
      statusText: "",
      url,
      contentType: null,
      body: null,
      bodyTruncated: false,
      bytesRead: 0,
      error: isTimeout
        ? `Request timed out after ${timeoutMs}ms.`
        : `Request failed: ${message}`,
      guidance: isTimeout
        ? "The proxy or target is slow. Consider a longer timeout, a different country, or retrying once later."
        : "Verify PROXY_USER/PROXY_PASS and that the proxy gateway is reachable.",
    };
  } finally {
    await agent.close();
  }
}

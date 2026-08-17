/**
 * Proxy-aware fetch client built on undici's ProxyAgent.
 *
 * Hardening (ported from Gentleman-Programming/dataimpulse-mcp):
 *  - SSRF guard: every destination — including each redirect hop — must pass
 *    `assertPublicDestination` (public IPs only, no metadata/localhost).
 *  - Manual redirect following with re-validation, capped at 10 hops.
 *  - Response body capped at 1 MiB, enforced before and during the read.
 *  - Obvious binary content-types are rejected before a single byte is read.
 *
 * Design decisions kept from v1:
 *  - The proxy URI carries NO userinfo. Credentials travel as an explicit
 *    `Proxy-Authorization` header (`token` option), sidestepping every
 *    URL-encoding edge case caused by the `;` / `.` targeting syntax.
 *  - A fresh ProxyAgent per request, always closed: each request carries a
 *    unique username (its own targeting params), so agents can't be pooled.
 */
import { ProxyAgent } from "undici";
import { env } from "../config/env.js";
import { buildProxyUsername, type ProxyTargeting } from "./auth.js";
import { assertPublicDestination, RequestValidationError } from "./ssrf.js";
import { readResponseText } from "./response.js";

/** Total request timeout, connect + transfer (residential hops are slow). */
export const REQUEST_TIMEOUT_MS = 45_000;

/** Max redirect hops followed (each hop re-validated as public). */
export const MAX_REDIRECTS = 10;

/** Browser-like headers to minimize bot detection on anti-scraping sites. */
export const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

/** Content-types rejected before reading (bandwidth = money). */
const BINARY_CONTENT_TYPE_RE =
  /^(image|video|audio|font)\/|application\/(octet-stream|pdf|zip|gzip|wasm|vnd\.)/i;

export interface ProxyFetchOptions {
  targeting?: ProxyTargeting;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface ProxyFetchResult {
  response: Response;
  body: string;
}

/** Builds a ProxyAgent for the given targeting (unique username per request). */
export function createProxyAgent(targeting: ProxyTargeting = {}): ProxyAgent {
  return new ProxyAgent({
    uri: `http://${env.PROXY_HOST}:${env.PROXY_PORT}`,
    token: `Basic ${Buffer.from(`${buildProxyUsername(env.PROXY_USER, targeting)}:${env.PROXY_PASS}`).toString("base64")}`,
  });
}

/**
 * Fetches `url` through the residential proxy with SSRF validation on the
 * initial URL and every redirect hop.
 *
 * @throws {RequestValidationError} — invalid/private destination, binary body, too many redirects
 * @throws {ResponseBodyTooLargeError} — body exceeds the 1 MiB wire limit
 * @throws {Error} — network-level failures (timeouts, DNS, proxy auth)
 */
export async function proxyFetch(url: string, options: ProxyFetchOptions = {}): Promise<ProxyFetchResult> {
  const { targeting = {}, timeoutMs = REQUEST_TIMEOUT_MS, headers = BROWSER_HEADERS } = options;
  const destination = await assertPublicDestination(url);

  const agent = createProxyAgent(targeting);
  const signal = AbortSignal.timeout(timeoutMs);

  try {
    let currentUrl = destination;

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await fetch(currentUrl, {
        dispatcher: agent,
        headers,
        redirect: "manual",
        signal,
      });

      const location = response.headers.get("location");
      if (!isRedirect(response.status) || !location) {
        const body = await readBody(response);
        return { response, body };
      }

      if (redirects === MAX_REDIRECTS) {
        await response.body?.cancel();
        throw new RequestValidationError("Too many redirects.");
      }

      await response.body?.cancel();
      currentUrl = await assertPublicDestination(new URL(location, currentUrl).toString());
    }

    throw new RequestValidationError("Too many redirects.");
  } finally {
    await agent.close();
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/** Reads the body, rejecting obvious binary content before a single byte is read. */
async function readBody(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";

  if (contentType && BINARY_CONTENT_TYPE_RE.test(contentType)) {
    await response.body?.cancel();
    throw new RequestValidationError(`Binary response (${contentType}) — body omitted.`);
  }

  return readResponseText(response);
}
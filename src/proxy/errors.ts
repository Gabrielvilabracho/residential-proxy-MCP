/**
 * Agent-facing result helpers — ported and typed from Gentleman-Programming/
 * dataimpulse-mcp, extended with Data Impulse's specific error codes.
 *
 * Every HTTP outcome maps to actionable text for the calling agent. The Data
 * Impulse gateway signals account-level conditions through the 407/503 body
 * (`TRAFFIC_EXHAUSTED`, `THREADS_EXHAUSTED`, `NO_RAY`) — mapping those is the
 * difference between "request failed" and "load credit" / "drop the city".
 */

/** Cap on characters returned to the LLM. */
export const MAX_OUTPUT_CHARACTERS = 60_000;

/** Truncates any output to the LLM-facing character cap. */
export function truncate(text: string): string {
  return text.length <= MAX_OUTPUT_CHARACTERS ? text : text.slice(0, MAX_OUTPUT_CHARACTERS);
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  /** Index signature keeps this compatible with the MCP SDK's result type. */
  [key: string]: unknown;
}

/** Successful tool result. */
export function success(text: string): ToolResult {
  return { content: [{ type: "text", text: truncate(text) }] };
}

/** Failed tool result (surfaced as an error by the MCP client). */
export function failure(text: string): ToolResult {
  return { content: [{ type: "text", text: truncate(text) }], isError: true };
}

/** Maps a failed zod parse to a readable invalid-input message. */
export function validationFailure(error: { issues: { path: (string | number)[]; message: string }[] }): ToolResult {
  const details = error.issues
    .map((issue) => `${issue.path.length === 0 ? "input" : issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  return failure(`Invalid input: ${details}`);
}

/**
 * Maps an HTTP status (plus body, when available) to an actionable failure
 * message, covering Data Impulse's gateway-level error codes.
 */
export function statusFailure(status: number, body: string): ToolResult {
  const code = body.toUpperCase();

  if (status === 407 && code.includes("TRAFFIC_EXHAUSTED")) {
    return failure("HTTP 407 (TRAFFIC_EXHAUSTED): DataImpulse traffic is exhausted. Add traffic credit and retry.");
  }

  if (status === 407 && code.includes("THREADS_EXHAUSTED")) {
    return failure(
      "HTTP 407 (THREADS_EXHAUSTED): More than 2,000 concurrent connections are active. Reduce concurrency and retry."
    );
  }

  if (status === 503 && code.includes("NO_RAY")) {
    return failure(
      "HTTP 503 (NO_RAY): No proxy IPs match the targeting. Remove city targeting and retain country only."
    );
  }

  if (status === 403) {
    return failure("HTTP 403: The destination site blocked the request. Retry with another country or a fixed session.");
  }

  if (status === 429) {
    return failure(
      "HTTP 429: The destination applied rate limiting or anti-bot controls. Try one new session or another country once; if it persists, access the target site directly or use another search engine. Do not retry blindly."
    );
  }

  return failure(`Request failed with HTTP ${status}. Verify the destination is available and retry.`);
}
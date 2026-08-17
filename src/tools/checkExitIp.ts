/**
 * `check_exit_ip` tool — verifies the current proxy exit: which IP the given
 * targeting produces, through the Data Impulse gateway.
 *
 * Optional `country`/`sessionId` targeting lets the agent confirm a specific
 * geo or sticky session is working; without them it reports the rotating exit.
 */
import { proxyFetch } from "../proxy/client.js";
import { failure, success, validationFailure } from "../proxy/errors.js";
import { RequestValidationError } from "../proxy/ssrf.js";
import { ResponseBodyTooLargeError } from "../proxy/response.js";
import { checkExitIpSchema, exitIpResponseSchema } from "../schemas/inputs.js";
import type { ToolResult } from "../proxy/errors.js";

/** Tiny JSON endpoint returning only the egress IP. */
const EXIT_IP_ENDPOINT = "https://api.ipify.org?format=json";

/** MCP tool handler. */
export async function handleCheckExitIp(args: unknown): Promise<ToolResult> {
  const parsed = checkExitIpSchema.safeParse(args);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const { country, sessionId } = parsed.data;

  try {
    const { response, body } = await proxyFetch(EXIT_IP_ENDPOINT, {
      targeting: { country, sessionId },
      headers: { accept: "application/json, text/plain, */*" },
    });

    if (!response.ok) {
      return failure(`The exit-IP service responded with HTTP ${response.status}.`);
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      return failure("The exit-IP service returned invalid JSON.");
    }

    const payload = exitIpResponseSchema.safeParse(parsedBody);
    if (!payload.success) {
      return failure("The exit-IP service returned an invalid response.");
    }

    return success(`Exit IP: ${payload.data.ip}`);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return failure(error.message);
    }
    if (error instanceof ResponseBodyTooLargeError) {
      return failure(`${error.message} Request a smaller resource and retry.`);
    }
    return failure("Network request failed. Check the destination and proxy availability, then retry.");
  }
}
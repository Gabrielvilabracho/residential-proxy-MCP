/**
 * Response body reading with hard size limits — ported and typed from
 * Gentleman-Programming/dataimpulse-mcp.
 *
 * Residential bandwidth is pay-per-GB, so we never download more than
 * `MAX_RESPONSE_BYTES` (1 MiB):
 *   1. A `content-length` pre-check rejects oversized responses BEFORE any
 *      byte hits the wire.
 *   2. While streaming, the byte count is enforced chunk by chunk; exceeding
 *      the limit cancels the body and throws.
 */
export const MAX_RESPONSE_BYTES = 1_048_576; // 1 MiB

/** Thrown when a response body exceeds the configured byte limit. */
export class ResponseBodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Response body exceeds the ${maxBytes.toLocaleString("en-US")} byte limit.`);
    this.name = "ResponseBodyTooLargeError";
  }
}

/**
 * Reads a response body as UTF-8 text, enforcing `maxBytes` on the wire.
 *
 * @throws {ResponseBodyTooLargeError} if the declared or streamed size exceeds the limit.
 */
export async function readResponseText(response: Response, maxBytes: number = MAX_RESPONSE_BYTES): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (declaredBodyExceedsLimit(contentLength, maxBytes)) {
    await cancelBody(response.body);
    throw new ResponseBodyTooLargeError(maxBytes);
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let byteCount = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return text + decoder.decode();
      }

      byteCount += value.byteLength;
      if (byteCount > maxBytes) {
        throw new ResponseBodyTooLargeError(maxBytes);
      }

      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    await cancelReader(reader);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function declaredBodyExceedsLimit(contentLength: string | null, maxBytes: number): boolean {
  return contentLength !== null && /^\d+$/.test(contentLength) && BigInt(contentLength) > BigInt(maxBytes);
}

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    // Cancellation is best-effort; the size limit remains the reported failure.
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Cancellation is best-effort; preserve the original read failure.
  }
}
import assert from "node:assert/strict";
import test from "node:test";
import { MAX_RESPONSE_BYTES, readResponseText, ResponseBodyTooLargeError } from "../src/proxy/response.js";

test("readResponseText decodes a normal UTF-8 stream across chunk boundaries", async () => {
  const bytes = new TextEncoder().encode("caf\u00e9");
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 4));
        controller.enqueue(bytes.slice(4));
        controller.close();
      },
    })
  );

  assert.equal(await readResponseText(response), "caf\u00e9");
});

test("readResponseText rejects an oversized Content-Length before reading", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } }
  );

  await assert.rejects(() => readResponseText(response), ResponseBodyTooLargeError);
  assert.equal(cancelled, true);
});

test("readResponseText cancels a stream that exceeds the byte limit", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel() {
        cancelled = true;
      },
    })
  );

  await assert.rejects(() => readResponseText(response), ResponseBodyTooLargeError);
  assert.equal(cancelled, true);
});

test("readResponseText honors a custom byte limit", async () => {
  const response = new Response(new Uint8Array(20));
  await assert.rejects(() => readResponseText(response, 10), ResponseBodyTooLargeError);
});
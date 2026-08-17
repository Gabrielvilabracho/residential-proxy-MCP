import assert from "node:assert/strict";
import test from "node:test";
import { failure, statusFailure, success, truncate, validationFailure } from "../src/proxy/errors.js";

function errorText(result: ReturnType<typeof statusFailure>): string {
  return result.content[0]!.text;
}

test("status failures explain proxy capacity, targeting, blocking, and rate limits", () => {
  assert.match(errorText(statusFailure(407, "TRAFFIC_EXHAUSTED")), /Add traffic credit/);
  assert.match(errorText(statusFailure(407, "THREADS_EXHAUSTED")), /Reduce concurrency/);
  assert.match(errorText(statusFailure(503, "NO_RAY")), /Remove city targeting/);
  assert.match(errorText(statusFailure(403, "")), /another country or a fixed session/);
  assert.match(errorText(statusFailure(429, "")), /Do not retry blindly/);
  assert.match(errorText(statusFailure(500, "")), /HTTP 500/);
});

test("truncate limits tool output to 60,000 characters", () => {
  assert.equal(truncate("x".repeat(60_001)).length, 60_000);
});

test("validationFailure flattens zod issues into readable detail", () => {
  const result = validationFailure({
    issues: [{ path: ["country"], message: "must be a two-letter ISO country code" }],
  });
  assert.equal(errorText(result), "Invalid input: country: must be a two-letter ISO country code");
  assert.equal(result.isError, true);
});

test("success and failure shape tool results", () => {
  assert.equal(success("ok").isError, undefined);
  assert.equal(failure("nope").isError, true);
});
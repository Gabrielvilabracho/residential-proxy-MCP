import assert from "node:assert/strict";
import test from "node:test";
import { checkExitIpSchema, fetchPageSchema } from "../src/schemas/inputs.js";

test("fetch_page input requires a country when targeting a city", () => {
  const cityWithoutCountry = fetchPageSchema.safeParse({
    url: "https://example.com",
    city: "Austin",
  });
  const invalidCountry = fetchPageSchema.safeParse({
    url: "https://example.com",
    country: "USA",
  });
  const valid = fetchPageSchema.safeParse({
    url: "https://example.com",
    country: "US",
    city: "Austin",
    sessionId: "s1",
    raw: true,
  });

  assert.equal(cityWithoutCountry.success, false);
  assert.match(cityWithoutCountry.error!.issues[0]!.message, /country is required/);
  assert.equal(invalidCountry.success, false);
  assert.match(invalidCountry.error!.issues[0]!.message, /two-letter ISO country code/);
  assert.equal(valid.success, true);
});

test("fetch_page rejects unknown keys and non-http URLs", () => {
  const unknownKey = fetchPageSchema.safeParse({ url: "https://example.com", evil: true });
  const badProtocol = fetchPageSchema.safeParse({ url: "file:///etc/passwd" });

  assert.equal(unknownKey.success, false);
  assert.equal(badProtocol.success, false);
});

test("check_exit_ip accepts only known optional targeting keys", () => {
  assert.equal(checkExitIpSchema.safeParse({}).success, true);
  assert.equal(checkExitIpSchema.safeParse({ country: "DE", sessionId: "s9" }).success, true);
  assert.equal(checkExitIpSchema.safeParse({ country: "DE", surprise: 1 }).success, false);
});
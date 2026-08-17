import assert from "node:assert/strict";
import test from "node:test";
import { buildProxyUsername } from "../src/proxy/auth.js";

test("buildProxyUsername adds normalized targeting parameters", () => {
  assert.equal(
    buildProxyUsername("account", { country: "US", city: "New_York", sessionId: "visit-42" }),
    "account__cr.us;city.new_york;sessid.visit-42"
  );
  assert.equal(buildProxyUsername("account", {}), "account");
  assert.equal(buildProxyUsername("account", { country: "AR" }), "account__cr.ar");
});

test("buildProxyUsername normalizes city whitespace to dashes", () => {
  assert.equal(buildProxyUsername("account", { country: "AR", city: "Buenos Aires" }), "account__cr.ar;city.buenos-aires");
});

test("buildProxyUsername rejects malformed targeting values", () => {
  assert.throws(() => buildProxyUsername("account", { country: "ARG" }), /2-letter ISO/);
  assert.throws(() => buildProxyUsername("account", { sessionId: "bad;chars" }), /sessionId/);
});
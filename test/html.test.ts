import assert from "node:assert/strict";
import test from "node:test";
import { htmlToText } from "../src/proxy/html.js";

test("htmlToText removes executable content, decodes entities, and preserves text boundaries", () => {
  const html = "<h1>Hello&nbsp;world</h1><script>alert('hidden')</script><style>.hidden{}</style><p>A &amp; B</p>";
  assert.equal(htmlToText(html), "Hello world\n\nA & B");
});

test("htmlToText drops comments and collapses blank runs", () => {
  const html = "<!-- secret --><div>One</div><div>Two</div>";
  assert.equal(htmlToText(html), "One\n\nTwo");
});

test("htmlToText skips script/style elements entirely", () => {
  const html = "<div><script>let x = 1;</script><style>.a{}</style>Real</div>";
  assert.equal(htmlToText(html), "Real");
});

test("htmlToText decodes numeric entities", () => {
  assert.equal(htmlToText("<p>&#65;&#x42;</p>"), "AB");
});
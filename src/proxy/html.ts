/**
 * Minimal, dependency-free HTML → plain text converter — ported and typed from
 * Gentleman-Programming/dataimpulse-mcp.
 *
 * Why it exists: an LLM consumes the page body, and raw HTML wastes context
 * tokens. This strips scripts/styles/comments, decodes entities, inserts line
 * breaks at block boundaries, and collapses whitespace — giving the agent the
 * readable content without the markup noise.
 */

/** Tags after which a line break is inserted (block-level semantics). */
const TEXT_BOUNDARY_TAGS =
  /^(address|article|aside|blockquote|br|caption|div|dl|dt|dd|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|td|th|tr|ul)$/;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

/** Converts an HTML document string into readable plain text. */
export function htmlToText(html: string): string {
  const lowercaseHtml = html.toLowerCase();
  let output = "";
  let cursor = 0;

  while (cursor < html.length) {
    // Skip HTML comments entirely.
    if (html.startsWith("<!--", cursor)) {
      const end = html.indexOf("-->", cursor + 4);
      cursor = end === -1 ? html.length : end + 3;
      continue;
    }

    // Plain text until the next tag.
    if (html[cursor] !== "<") {
      output += html[cursor];
      cursor += 1;
      continue;
    }

    const end = findTagEnd(html, cursor + 1);
    if (end === -1) {
      output += html[cursor];
      cursor += 1;
      continue;
    }

    const token = html.slice(cursor + 1, end);
    const tagName = getTagName(token);
    const isClosingTag = /^\s*\//.test(token);

    if (!tagName) {
      cursor = end + 1;
      continue;
    }

    // Skip executable content wholesale.
    if (!isClosingTag && (tagName === "script" || tagName === "style")) {
      cursor = skipElement(html, lowercaseHtml, end + 1, tagName);
      continue;
    }

    if (isTextBoundaryTag(tagName)) {
      output += "\n";
    }

    cursor = end + 1;
  }

  return decodeHtmlEntities(output)
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+\n/g, "\n")
    .replace(/\n[ \t\f\v]+/g, "\n")
    .replace(/[ \t\f\v]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Finds the closing `>` of a tag, honoring quoted attribute values. */
function findTagEnd(html: string, start: number): number {
  let quote = "";

  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (character === undefined) break;

    if (quote) {
      if (character === quote) quote = "";
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }

  return -1;
}

function getTagName(token: string): string | undefined {
  const match = token.match(/^\s*\/?\s*([A-Za-z][A-Za-z0-9:-]*)\b/);
  return match?.[1]?.toLowerCase();
}

function isTextBoundaryTag(tagName: string): boolean {
  return TEXT_BOUNDARY_TAGS.test(tagName);
}

/** Skips an entire element (e.g. <script>...</script>), honoring nesting. */
function skipElement(html: string, lowercaseHtml: string, start: number, tagName: string): number {
  let closingTag = lowercaseHtml.indexOf(`</${tagName}`, start);

  while (closingTag !== -1) {
    const end = findTagEnd(html, closingTag + 2);
    if (end === -1) return html.length;

    const token = html.slice(closingTag + 1, end);
    if (/^\s*\/\s*/.test(token) && getTagName(token) === tagName) {
      return end + 1;
    }

    closingTag = lowercaseHtml.indexOf(`</${tagName}`, end + 1);
  }

  return html.length;
}

/** Decodes the common named and numeric HTML entities. */
function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (entity, code: string) => {
    const normalized = code.toLowerCase();

    if (normalized in NAMED_ENTITIES) {
      return NAMED_ENTITIES[normalized]!;
    }

    const numericValue = normalized.startsWith("#x")
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);

    try {
      return String.fromCodePoint(numericValue);
    } catch {
      return entity; // invalid code point — leave the entity untouched
    }
  });
}
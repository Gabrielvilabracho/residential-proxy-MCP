/**
 * SSRF protection — ported and typed from Gentleman-Programming/dataimpulse-mcp.
 *
 * An MCP server that fetches arbitrary URLs dictated by an LLM MUST verify the
 * destination is public before sending traffic: a malicious or hallucinated URL
 * could otherwise reach cloud metadata endpoints (169.254.169.254), internal
 * services, or other non-public infrastructure.
 *
 * Every fetch — including every redirect hop — passes through
 * `assertPublicDestination` before a request is issued.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Thrown when a destination fails the public-destination checks. */
export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

/**
 * Validates that `value` is an absolute http(s) URL whose hostname resolves
 * ONLY to public addresses. Returns the parsed URL, ready to fetch.
 *
 * @throws {RequestValidationError} on any violation.
 */
export async function assertPublicDestination(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RequestValidationError("The URL is invalid.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RequestValidationError("Only public HTTP and HTTPS URLs are allowed.");
  }

  if (url.username || url.password) {
    throw new RequestValidationError("URLs with credentials are not allowed.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isForbiddenHostname(hostname)) {
    throw new RequestValidationError("The destination must not use a local, private, or metadata hostname.");
  }

  // Literal IP in the URL: validate the address directly.
  if (isIP(hostname) !== 0) {
    if (!isPublicAddress(hostname)) {
      throw new RequestValidationError("The destination must resolve to a public address.");
    }
    return url;
  }

  // Hostname: resolve and require EVERY address to be public (DNS rebinding-safe).
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new RequestValidationError("The destination host could not be resolved.");
  }

  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new RequestValidationError("The destination must resolve only to public addresses.");
  }

  return url;
}

function isForbiddenHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "metadata" ||
    hostname === "instance-data" ||
    hostname === "metadata.google.internal" ||
    hostname.endsWith(".metadata.google.internal")
  );
}

function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) return isPublicIpv4(address);
  if (isIP(address) === 6) return isPublicIpv6(address);
  return false;
}

function isPublicIpv4(address: string): boolean {
  const [first = 0, second = 0] = address.split(".").map(Number);

  // 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8, multicast/reserved (>= 224)
  if (first === 0 || first === 10 || first === 127 || first >= 224) return false;

  // 100.64.0.0/10 (CGNAT)
  if (first === 100 && second !== undefined && second >= 64 && second <= 127) return false;

  // 169.254.0.0/16 (link-local / cloud metadata)
  if (first === 169 && second === 254) return false;

  // 172.16.0.0/12
  if (first === 172 && second !== undefined && second >= 16 && second <= 31) return false;

  // 192.0.0.0/24, 192.168.0.0/16
  if (first === 192 && (second === 0 || second === 168)) return false;

  // 198.18.0.0/15 (benchmarking), 198.51.100.0/24 (TEST-NET-2)
  if (first === 198 && (second === 18 || second === 19 || second === 51)) return false;

  // 203.0.113.0/24 (TEST-NET-3)
  return !(first === 203 && second === 0);
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  const firstHextet = Number.parseInt(normalized.split(":")[0] ?? "0", 16);

  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("::ffff:") || // IPv4-mapped
    normalized.startsWith("100:") || // discard
    normalized.startsWith("2001:0:") || // Teredo, benchmarking, ORCHID
    normalized.startsWith("2001:db8:") || // documentation
    normalized.startsWith("2002:") || // 6to4
    normalized.startsWith("3fff:") || // documentation
    normalized.startsWith("64:ff9b:") // NAT64 well-known prefix
  ) {
    return false;
  }

  return (
    (firstHextet & 0xfe00) !== 0xfc00 && // not unique-local (fc00::/7)
    (firstHextet & 0xffc0) !== 0xfe80 && // not link-local (fe80::/10)
    (firstHextet & 0xff00) !== 0xff00 // not multicast (ff00::/8)
  );
}
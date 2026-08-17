/**
 * Data Impulse dynamic authentication string builder.
 *
 * CRITICAL LOGIC — do not "simplify" this without re-reading the official
 * documentation: https://docs.dataimpulse.com/proxies/parameters
 *
 * Data Impulse encodes targeting parameters directly in the proxy USERNAME:
 *
 *   - The delimiter `__` separates the base login from the first parameter
 *     (it is prepended once, before the first key).
 *   - A period `.` separates each key from its value.
 *   - A semicolon `;` separates multiple parameters.
 *
 * Official example:
 *   login__cr.de;city.berlin;sessttl.60
 *   ────┬──  ─┬─  ─┬──┬──────  ──┬─
 *      │      │    │  │          └── value (60 = seconds)
 *      │      │    │  └───────────── key `sessttl` (sticky rotation interval)
 *      │      │    └──────────────── key `city`
 *      │      └───────────────────── value (DE = Germany)
 *      └──────────────────────────── key `cr` (country), after the `__` delimiter
 *
 * Parameter keys (verified against official docs, Aug 2026):
 *   - `cr`     → country, ISO 3166-1 alpha-2 (included in base price)
 *   - `city`   → city targeting (paid add-on; requires country to disambiguate)
 *   - `sessid` → sticky session id: keeps the same labeled exit IP for ~30 min
 */
export interface ProxyTargeting {
  /** ISO 3166-1 alpha-2 country code, e.g. "AR", "US", "DE". */
  country?: string;
  /** City name, e.g. "Buenos Aires". Requires `country`. */
  city?: string;
  /** Sticky session id — reuse the same value to keep the same exit IP. */
  sessionId?: string;
}

/** Two-letter ISO country code. */
const COUNTRY_RE = /^[A-Za-z]{2}$/;

/** City: letters, digits, spaces, dots, dashes and underscores. */
const CITY_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;

/** Session id: safe URL chars only. */
const SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Normalizes a raw city name for the `city.<value>` parameter:
 * trims, lowercases and collapses whitespace to dashes (e.g. "Buenos Aires"
 * → "buenos-aires"). Data Impulse resolves city codes internally; if a city
 * fails to resolve, the request falls back to country-level routing.
 */
export function normalizeCity(city: string): string {
  return city.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Builds the full proxy username for a request.
 *
 * Example outputs (base login "user123"):
 *   no targeting  → "user123"
 *   country only  → "user123__cr.ar"
 *   full          → "user123__cr.ar;city.buenos-aires;sessid.abc123"
 *
 * @throws {Error} if any targeting value is malformed.
 */
export function buildProxyUsername(baseUser: string, targeting: ProxyTargeting = {}): string {
  const params: string[] = [];

  if (targeting.country !== undefined) {
    if (!COUNTRY_RE.test(targeting.country)) {
      throw new Error(
        `Invalid country "${targeting.country}" — expected a 2-letter ISO 3166-1 alpha-2 code (e.g. "AR", "US")`
      );
    }
    // Key is `cr`; the `__` delimiter is prepended once in the return below.
    params.push(`cr.${targeting.country.toLowerCase()}`);
  }

  if (targeting.city !== undefined) {
    if (!CITY_RE.test(targeting.city)) {
      throw new Error(`Invalid city "${targeting.city}" — only letters, digits, spaces, dots, dashes and underscores allowed`);
    }
    params.push(`city.${normalizeCity(targeting.city)}`);
  }

  if (targeting.sessionId !== undefined) {
    if (!SESSION_RE.test(targeting.sessionId)) {
      throw new Error(`Invalid sessionId "${targeting.sessionId}" — only letters, digits, dots, dashes and underscores allowed`);
    }
    params.push(`sessid.${targeting.sessionId}`);
  }

  return params.length > 0 ? `${baseUser}__${params.join(";")}` : baseUser;
}

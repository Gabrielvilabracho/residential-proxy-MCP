/**
 * Zod schemas for every tool input. All validation is centralized here.
 *
 * Cross-field rule: `city` requires `country`. City names are not globally
 * unique ("Paris" is France or Texas), so a country is mandatory whenever a
 * city is requested. Enforced with a `.refine()`; the handler runs this full
 * schema, while `registerTool` advertises the plain field list.
 */
import { z } from "zod";

/** ISO 3166-1 alpha-2 country code, e.g. "AR", "US", "DE". */
export const countrySchema = z
  .string()
  .regex(/^[A-Za-z]{2}$/, 'Country must be a 2-letter ISO 3166-1 alpha-2 code (e.g. "AR", "US")');

/** City name: letters, digits, spaces, dots, dashes, underscores. */
export const citySchema = z
  .string()
  .trim()
  .min(1, "City must not be empty")
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/, "City contains unsupported characters");

/** Sticky session id: safe URL characters only. */
export const sessionIdSchema = z
  .string()
  .trim()
  .min(1, "sessionId must not be empty")
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "sessionId allows only letters, digits, dots, dashes and underscores");

/** Only http/https targets are fetchable. */
export const urlSchema = z
  .string()
  .url("url must be a valid absolute URL")
  .refine((u) => u.startsWith("http://") || u.startsWith("https://"), "Only http:// and https:// URLs are supported");

/**
 * Full validation for `fetch_page` — INCLUDES the cross-field refine.
 * Used by the handler for strict validation.
 */
export const fetchPageSchema = z
  .object({
    url: urlSchema,
    country: countrySchema.optional(),
    city: citySchema.optional(),
    sessionId: sessionIdSchema.optional(),
  })
  .refine((args) => !args.city || Boolean(args.country), {
    message: "country is required whenever city is provided (city names are not globally unique)",
    path: ["country"],
  });

/** Plain field shape — what the MCP client advertises to the agent. */
export const fetchPageShape = {
  url: urlSchema.describe("Absolute URL of the page to fetch through the residential proxy"),
  country: countrySchema.optional().describe("ISO 3166-1 alpha-2 code for the exit country (e.g. 'AR', 'US'). Required when city is set."),
  city: citySchema.optional().describe("Exit city for geotargeting (paid add-on). Requires country."),
  sessionId: sessionIdSchema
    .optional()
    .describe("Sticky session id — reuse the same value across requests to keep the same exit IP (~30 min lifetime)."),
} as const;

/** `check_exit_ip` takes no arguments. */
export const checkExitIpSchema = z.object({});

/**
 * Zod schemas for every tool input. All validation is centralized here.
 *
 * Cross-field rule: `city` requires `country`. City names are not globally
 * unique ("Paris" is France or Texas), so a country is mandatory whenever a
 * city is requested. Enforced with a `.superRefine()`; the handler runs this
 * full schema, while `registerTool` advertises the plain field list.
 */
import { isIP } from "node:net";
import { z } from "zod";

/** ISO 3166-1 alpha-2 country code, e.g. "AR", "US", "DE". */
export const countrySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, 'must be a two-letter ISO country code (e.g. "AR", "US")');

/** City name: letters, digits, spaces, dots, dashes, underscores. */
export const citySchema = z
  .string()
  .trim()
  .min(1, "must not be empty")
  .max(64, "must be at most 64 characters")
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/, "may contain only letters, numbers, spaces, dots, hyphens, and underscores");

/** Sticky session id: safe URL characters only. */
export const sessionIdSchema = z
  .string()
  .trim()
  .min(1, "must not be empty")
  .max(128, "must be at most 128 characters")
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "may contain only letters, numbers, dots, hyphens, and underscores");

/** Only http/https URLs, max 2 KB. */
export const urlSchema = z
  .string()
  .url("must be a valid absolute URL")
  .max(2_048, "must be at most 2048 characters")
  .refine((u) => u.startsWith("http://") || u.startsWith("https://"), "only http:// and https:// URLs are supported");

/** Plain field shape for `fetch_page` — what the MCP client advertises. */
export const fetchPageShape = {
  url: urlSchema.describe("Absolute URL of the page to fetch through the residential proxy"),
  country: countrySchema.optional().describe("ISO 3166-1 alpha-2 code for the exit country (e.g. 'AR', 'US'). Required when city is set."),
  city: citySchema.optional().describe("Exit city for geotargeting (paid add-on). Requires country."),
  sessionId: sessionIdSchema
    .optional()
    .describe("Sticky session id — reuse the same value across requests to keep the same exit IP (~30 min lifetime)."),
  raw: z.boolean().optional().describe("Return the raw HTML instead of the converted plain text (default: false)"),
} as const;

/**
 * Full validation for `fetch_page` — INCLUDES the cross-field refine and the
 * strict unknown-key rejection. Used by the handler for strict validation.
 */
export const fetchPageSchema = z
  .object(fetchPageShape)
  .strict()
  .superRefine(({ country, city }, context) => {
    if (city && !country) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["country"],
        message: "country is required whenever city is provided (city names are not globally unique)",
      });
    }
  });

/** Plain field shape for `check_exit_ip` (optional targeting to verify a geo). */
export const checkExitIpShape = {
  country: countrySchema.optional().describe("Optional ISO country code to verify targeting for"),
  sessionId: sessionIdSchema.optional().describe("Optional sticky session id to verify"),
} as const;

/** Strict validation for `check_exit_ip`. */
export const checkExitIpSchema = z.object(checkExitIpShape).strict();

/** Response contract of the exit-IP service (api.ipify.org). */
export const exitIpResponseSchema = z.object({
  ip: z.string().trim().refine((value) => isIP(value) !== 0, "must contain a valid IP address"),
});
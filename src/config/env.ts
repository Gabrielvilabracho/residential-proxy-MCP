/**
 * Environment configuration.
 *
 * All runtime settings are read from the environment and validated with Zod at
 * startup. The server fails fast (before any tool call) if required
 * credentials are missing — never start with a silently broken proxy config.
 */
import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  /**
   * Data Impulse dashboard username. This is the BASE login that the
   * targeting parameters (country/city/session) get appended to at request
   * time. See src/proxy/auth.ts.
   */
  PROXY_USER: z.string().min(1, "PROXY_USER is required (Data Impulse dashboard username)"),

  /** Data Impulse dashboard password. */
  PROXY_PASS: z.string().min(1, "PROXY_PASS is required (Data Impulse dashboard password)"),

  /** Proxy gateway host. Defaults to Data Impulse's rotating residential endpoint. */
  PROXY_HOST: z.string().min(1).default("gw.dataimpulse.com"),

  /** Proxy gateway port. 823 = rotating residential HTTP/HTTPS traffic. */
  PROXY_PORT: z.coerce.number().int().positive().default(823),
});

/** Validated, typed environment. Access this singleton from anywhere. */
export const env = envSchema.parse(process.env);

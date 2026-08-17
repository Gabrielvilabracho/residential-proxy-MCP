/**
 * `check_exit_ip` tool — verifies the current proxy exit: IP, location and ISP.
 *
 * Queries ip-api.com through the proxy (no targeting → rotating exit IP).
 * Falls back to api.ipify.org if the primary endpoint is unreachable.
 * Both responses are sub-1 KB, so the bandwidth cost is negligible.
 */
import { fetchWithProxy } from "../proxy/client.js";

/** Primary endpoint: IP + geo in one tiny JSON payload. */
const IP_API_URL = "http://ip-api.com/json/?fields=status,message,query,country,countryCode,city,regionName,isp,org";

/** Fallback endpoint: IP only. */
const IPIFY_URL = "https://api.ipify.org?format=json";

/** MCP tool handler — parameterless by design (spec). */
export async function handleCheckExitIp() {
  let result = await fetchWithProxy(IP_API_URL, { timeoutMs: 20_000 });

  let summary: Record<string, unknown>;

  if (result.status === 200 && result.body) {
    try {
      const geo = JSON.parse(result.body) as {
        status?: string;
        query?: string;
        country?: string;
        countryCode?: string;
        city?: string;
        regionName?: string;
        isp?: string;
        org?: string;
      };
      summary = {
        source: "ip-api.com",
        ip: geo.query,
        country: geo.country,
        countryCode: geo.countryCode,
        city: geo.city,
        region: geo.regionName,
        isp: geo.isp ?? geo.org,
        proxyStatus: "reachable",
      };
    } catch {
      // Non-JSON body from ip-api: fall through to the ipify fallback.
      result = await fetchWithProxy(IPIFY_URL, { timeoutMs: 20_000 });
      summary = fallbackSummary(result);
    }
  } else {
    // Primary endpoint failed (rate limit, geo-block, etc.) → try ipify.
    const fallback = await fetchWithProxy(IPIFY_URL, { timeoutMs: 20_000 });
    summary = fallbackSummary(fallback, result);
  }

  const content: { type: "text"; text: string }[] = [
    { type: "text", text: JSON.stringify(summary, null, 2) },
  ];

  return { content };
}

function fallbackSummary(
  fallback: Awaited<ReturnType<typeof fetchWithProxy>>,
  primary?: Awaited<ReturnType<typeof fetchWithProxy>>
): Record<string, unknown> {
  if (fallback.status === 200 && fallback.body) {
    try {
      const ip = (JSON.parse(fallback.body) as { ip?: string }).ip;
      return {
        source: "api.ipify.org",
        ip,
        proxyStatus: "reachable",
        ...(primary?.error ? { primaryError: primary.error } : {}),
      };
    } catch {
      // ignore — fall through to the generic error report
    }
  }

  return {
    ip: null,
    proxyStatus: "unreachable",
    error: fallback.error ?? `Unexpected status ${fallback.status}`,
    guidance: fallback.guidance ?? "Verify PROXY_USER/PROXY_PASS and that the proxy gateway is reachable.",
  };
}

# Agent Rules — residential-proxy MCP

This file defines how the AI agent MUST use the `fetch_page` and `check_exit_ip`
tools from this MCP server. It exists because residential proxy bandwidth is
pay-per-GB and because misusing the proxy (wrong country, reused blocked
session) actively causes the 403 errors it exists to prevent.

## 1. Priority — use `fetch_page` for public pages

- When the task requires READING any public web page (prices, stock, listings,
  article content, region-specific sites), call `fetch_page` instead of the
  agent's standard web-fetch / browser tools.
- The generic tools may still be used for: private/internal endpoints,
  developer documentation, or anything that must NOT exit through a residential
  IP.
- Never route the whole agent conversation through the proxy — only individual
  `fetch_page` calls. This saves bandwidth and latency.

## 2. Geotargeting — always pass `country` explicitly

- If the content is region-dependent (local prices, regional stock, country
  restrictions, "content not available in your region"), ALWAYS pass the
  `country` parameter with the relevant ISO code (e.g. `'AR'`, `'US'`, `'DE'`).
- Do not rely on the exit IP you "happen" to get — rotating residential IPs are
  random unless you pin them.
- `city` is a paid targeting add-on and REQUIRES `country`. Omit it unless the
  task genuinely needs city-level precision (extra cost).
- After a targeted fetch, you may call `check_exit_ip` to confirm the exit
  location matches the requested country.

## 3. Persistence — reuse `sessionId` per site

- When making MULTIPLE requests to the same site (multi-step navigation, login
  flow, paginated browsing), pass the SAME `sessionId` value on every call.
  The proxy then keeps the same exit IP for ~30 minutes, which looks like a
  real resident and avoids bot-detection flags.
- Generate a fresh `sessionId` per site / per browser-like flow. Do NOT share
  one session id across different sites — cross-site reuse looks like a bot.
- A session is tied to the country you used when you started it. If you change
  country, start a new session id.

## 4. Error handling — never retry a block with identical settings

- If `fetch_page` returns HTTP **403** (or a CAPTCHA/block page): DO NOT retry
  with the same country + session. That is exactly what a bot does, and it
  burns bandwidth for the same result.
- Instead, take ONE of these recovery actions, in order:
  1. Rotate the session: retry with a NEW `sessionId` (same country).
  2. Change the country (e.g. neighbor country, or the country the content is
     actually served to).
  3. If the site blocks all residential ranges, stop fetching it and report
     the block to the user — do not keep hammering.
- **429** (rate limited): wait and retry later, once. Do not loop.
- **407** (proxy auth): report the credential problem to the user; do not
  retry the target.
- **5xx**: the target server is failing; retry once later, not immediately.
- Timeouts: retry once with a longer timeout or different country, then stop.

## 5. Verification

- Use `check_exit_ip` to confirm the proxy is alive and to see which country
  the current rotating exit resolves to.
- When verifying that geotargeting worked, compare the `countryCode` from the
  check against the `country` you passed to `fetch_page`.

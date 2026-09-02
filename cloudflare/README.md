# Waze traffic connection

Deploy `waze-worker.mjs` as a Cloudflare Worker. No build step or third-party packages are required.

1. Store the county's JSON feed URL in the **secret** `WAZE_FEED_URL`. Never put it in source control, plain-text variables, the dashboard, or logs.
2. Confirm the Waze partner agreement permits the intended public display and include the required Waze attribution.
3. Only then set the plain-text variable `PUBLIC_TRAFFIC_ENABLED` to `true`. Until then the endpoint responds with 503 without requesting or exposing Waze data.
4. Point the dashboard's `WAZE_CONFIG.proxyUrl` to the deployed Worker's `/waze.json` endpoint.

The Worker fetches only its configured Waze feed; visitors cannot supply upstream URLs. It allows browser reads from `https://lcema36.github.io`, caches sanitized responses for up to two minutes, rejects stale/missing feed timestamps, and never returns raw errors. It publishes only the fields required by the traffic cards and map. Driver usernames, IDs, comments, free-text descriptions and images are not forwarded.

**This is a public data endpoint after activation. CORS is not authentication.** The private upstream feed link stays secret, but the selected traffic reports are accessible to the public. Confirm permitted use before activation.

The Workers Free plan has request and CPU limits. Do not enable paid upgrades without the account owner's approval. Exceeding free limits should be displayed as unavailable traffic data, never an all-clear.

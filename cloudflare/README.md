# Live demo on Cloudflare Free

The public portfolio uses a static Vercel frontend plus this Worker. It does not use FastAPI, SQLite on a laptop, or Ollama at runtime. The original local app is available with `VITE_LOCAL_BACKEND=true`.

## No-charge deployment requirement

Deploy to **Workers Free**, not Workers Paid. Workers Free stops requests at its allowance; Paid can bill overages. A Free DNS/website plan is not proof of Workers Free. Check Workers & Pages → Plans or account Billing → Subscriptions before enabling `LIVE_ENABLED`. Do not attach paid AI Gateway credits, enable automatic top-ups, or upgrade the Workers plan. No deployment command here upgrades billing.

`LIVE_ENABLED` defaults to `false`. It is an operational kill switch, not an account billing setting. The absolute no-overage guarantee comes from retaining Workers Free; code cannot prevent a future account administrator from upgrading a plan. If the account is already Paid, use a separate Free account rather than changing an existing subscription.

Current documented Workers AI free allowance: 10,000 neurons/day, shared account-wide. See https://developers.cloudflare.com/workers-ai/platform/pricing/ . Terms/model availability may change; recheck when redeploying.

## Defense in depth

- Fixed free-tier eligible model: `@cf/google/gemma-4-26b-a4b-it`. No caller-selected model or external provider fallback.
- One inference attempt per accepted request. No automatic retries, batches, paid fallback, or model downloads.
- At most 50 reservations/day globally, with atomic D1 UPSERTs shared across isolates. A failed attempt still consumes a reservation.
- At most 3 admitted attempts/day per network address. Addresses are salted and hashed per UTC day; no raw IP is stored. Shared networks share this allowance. Global reservations happen first, so rejected visitor attempts also reduce the global allowance conservatively.
- 8 KB request-body byte ceiling enforced while reading; subject 200 chars, body 2,000, sender 160. Model completion capped at 1,024 tokens.
- Output checked against all six tool schemas. Unknown or malformed calls fail visibly.
- If D1, model, quota or configuration fails, no alternate inference path runs. Static samples keep working.
- D1 stores only quota keys/counts. No email content, model output, API keys or raw IPs in application logs. Observability logging is disabled.
- Origin checks restrict browser use; they are not an authentication boundary. The shared quota is the backstop against forged-origin clients.

## Deploy

1. `npm ci` in `cloudflare/`, then `npx wrangler login`.
2. Verify Workers Free in the dashboard. Keep `LIVE_ENABLED=false` until verified.
3. `npx wrangler d1 create inbox-triage-limits`; copy the returned database ID into `wrangler.jsonc`.
4. `npx wrangler d1 migrations apply inbox-triage-limits --remote`.
5. Set a random `VISITOR_SALT` with `npx wrangler secret put VISITOR_SALT` (stdin; never commit the value).
6. `npx wrangler deploy`. Set `LIVE_ENABLED=true` only after the Free-plan check, then redeploy.
7. Set the frontend production build variable `VITE_TRIAGE_API_URL` to the returned HTTPS Worker URL and deploy `frontend/` to the existing Vercel project. Use the free Vercel project URL; a custom domain is not required.
8. Verify `/healthz`, the static sample inbox, one live synthetic email, and the quota fallback. Do not use real private emails for smoke tests.

To disable live inference, redeploy with `LIVE_ENABLED=false`. Do not delete the quota database to reset a day's allowance. Reset is automatic at 00:00 UTC. Static sample files can be deployed independently.

## Tests

`npm test` checks validation, byte/field ceilings, disabled/config failure, origin policy, provider failure/no retry, three-attempt visitor cap and concurrent global caps. Mock bindings verify behavior without consuming inference quota. Verify the SQL against SQLite/D1 as well when changing reservation logic.

## Sample provenance

`frontend/src/demo/sample.json` contains six fictional emails and saved suggestions generated locally with Gemma through Ollama on 2026-11-19. No inference occurs when opening, searching, filtering or simulating actions on these records. Live submissions are not persisted; reloading the page clears them. The UI distinguishes saved sample results from live results.

Workers Free was verified in the account dashboard on 2026-11-19. Vercel is on Hobby. The custom tigtagtoe.com domain is reserved for another project.

## Current production

Frontend: https://inbox-triage-womputer.vercel.app
Worker: https://inbox-triage-live.womputer.workers.dev

The custom domain and its www variant were detached from Vercel after verifying the free production URL. No registrar or DNS records were changed. Source configuration keeps live inference disabled by default; the verified Free production deployment has it enabled.

# Deploy Inbox Triage

The public demo runs at https://inbox-triage-womputer.vercel.app using a static Vercel Hobby frontend and Cloudflare Workers Free inference. It needs no laptop, Render backend, or Anthropic API key.

Follow [the Cloudflare deployment guide](../cloudflare/README.md) for the Worker, D1 migration, secret, quotas, and Free-plan verification. Keep Workers Free and do not attach paid AI Gateway credits.

## Frontend

1. Connect `womputer/inbox-triage` to the existing Vercel project, with root directory `frontend`.
2. Set `VITE_TRIAGE_API_URL=https://inbox-triage-live.womputer.workers.dev` and `VITE_LOCAL_BACKEND=false` as build-time variables.
3. Deploy and verify the sample inbox, filters, detail panel, and simulated actions.
4. Submit one fictional email to verify live triage. Samples remain available if live quota is exhausted.

The tigtagtoe.com domain is detached and reserved for another project. No custom domain is needed.

## Optional local application

The CSV workflow uses FastAPI and Ollama. See [local setup](../README.md#run-it-locally) and enable `VITE_LOCAL_BACKEND=true`. Hosting this backend elsewhere requires an independently available Ollama host; the Render manifest alone does not provision inference.

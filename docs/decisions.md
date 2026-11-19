# Decisions

Short notes on the meaningful choices I made along the way, and what I'd say if asked why.

## FastAPI over Express or .NET

FastAPI lets me write the agent runner with `async def` and an async HTTP client for Ollama without ceremony. It also auto-generates a `/docs` page that doubles as the API contract the spec asks for. Pydantic v2 gives me request and response validation with one decorator. Node would have worked but I'd have written more glue. .NET is too heavy for a one-week build.

## A small local model via Ollama

Qwen3 4B supports tool calling and can run locally without an inference API key. It is the initial default, configurable through `OLLAMA_MODEL`. This is a constrained selection task with six tools, but accuracy and latency still need evaluation on representative emails. A hosted demo needs its own reachable inference server.

## Validate tool calls before persistence

The runner asks for one or more native tool calls, then validates names, argument types, required fields, enums, and a nonempty rationale. It retries invalid output once, then records an email error. It never silently substitutes a hardcoded classification. The catalog stays provider-independent; the runner converts it to Ollama's function format.

## A separate `rationale` column

The spec's example output treats `rationale` as a sibling of `arguments`, not a field inside it. I follow that. The way I get the model to produce it is by making `rationale` a required string in every tool's input schema. The runner strips it off the arguments before persisting and stores it in its own column. That means I can query by rationale, render it alone, and the JSON the user sees in the UI matches the example in the spec.

## SQLite

The repo is cloneable with zero extra setup. The DB lives at `backend/tigtagtoe.db`. Switching to Postgres is one env var. For 150 to a few thousand emails this is plenty.

## asyncio Semaphore, no queue

The simplest thing that fits. The default processes one email at a time to fit local inference capacity. No Redis, no worker container. If scale required it I'd swap in RQ but at this size it would be over-engineering.

## Polling, not SSE

A 1.5-second poll on `/api/uploads/{id}/status` is plenty for showing progress. SSE would mean another endpoint, another connection lifecycle, and an extra failure mode for the reviewer to hit. Inference time depends on the model host.

## Vite + React Router + React Query + Zustand

This is the standard React stack right now and the spec already asked for React + Vite + TypeScript. React Query is the cleanest way to handle server cache and polling. Zustand replaces a useReducer + context I'd otherwise write. The whole stack adds about 30 KB gzipped over React itself.

## Tailwind

Token layer in `tailwind.config.ts`, a tiny `.glass` utility for the surface treatment, and per-tool color tokens (`tool-meeting`, `tool-response`, etc). The point was to keep the styles colocated with the component instead of having a separate CSS-in-JS layer to think about.

## The visual direction

"Quiet dark with one accent" rather than "neon explosion". The wow comes from the typography mix (serif display headings, sans body, mono for JSON), the depth in the surfaces, and the way the detail panel slides in. Nothing shouts. The product is a serious tool for a serious context (work email triage), so the UI matches.

## Side panel for email detail, not a route

I sub-routed `/inbox/:id` but the detail renders as a side panel over the inbox, not a separate page. Why: the spec asked for an inbox view where clicking a row reveals the email and tool calls. Replacing the list with a detail page would lose the navigation context. Modal would be too cramped. Side panel keeps both visible and lets ESC close it.

## Per-upload state, not a singleton

Even though there's "only one inbox", I made `Upload` a real table with its own row per CSV. That means re-uploading doesn't destroy the old data, and a future v2 with multiple datasets per user is a small change. The frontend tracks which upload is "active" via `localStorage`.

## What's mocked

Tool executions are mocked because the spec is explicit. They're deterministic from the arguments (SHA-1 of the JSON) so clicking the same tool call twice gives the same fake ticket ID. Reviewers won't see drift on a refresh.

## What I left out

Broad tests outside the agent integration, SSE, multi-user, a real queue, a settings page, charts. All called out in the README under "What I deliberately didn't build" with the reasoning attached.

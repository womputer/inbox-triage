# Inbox Triage

The public portfolio demo includes a precomputed fictional inbox. Live triage uses a capped Cloudflare Workers AI endpoint on Workers Free; the demo needs no running laptop. All tool executions are simulations. See [cloud deployment and cost controls](cloudflare/README.md).

## Portfolio demo

Run `cd frontend && npm ci && npm run dev` to explore samples without a backend. Set `VITE_TRIAGE_API_URL` to the deployed Cloudflare Worker for live triage. Keep the production Cloudflare account on Workers Free; never enable Paid or AI Gateway credits for this demo.

The instructions below describe the optional local CSV/Ollama application. Set `VITE_LOCAL_BACKEND=true` to use that interface.

An email triage assistant. You drop a CSV of emails into the app, an agent reads each one, picks the tools that should handle it (schedule a meeting, draft a reply, escalate, create a task, flag, archive), and shows you what each tool would have done. You can filter the inbox by tool, search by sender or subject, and click any tool call to run a mocked version of it.

I built Inbox Triage to explore how an AI agent can sit on top of a real inbox and make routine triage calls without a human in the loop. The dataset is a 150-email sample from the Enron corpus, small enough to explore locally. Inference time depends on the model and hardware.

## Quick look

- Two pages: `/upload` (drag the CSV in) and `/inbox` (browse and review).
- Six required tools plus a catalog endpoint so the UI doesn't drift from the backend.
- Each tool call carries a one-line rationale from the agent so you can see why it picked what it picked.
- Mock executions are deterministic from inputs, so the same email always gives you the same fake meeting ID, ticket number, draft preview, and so on.

## Live URL

Frontend: https://inbox-triage-womputer.vercel.app

The public sample inbox needs no backend. Live one-email triage uses the Cloudflare Worker; bulk CSV processing remains an optional local workflow.

## Stack

- Frontend: React 18 + Vite 6 + TypeScript, Tailwind, React Router, React Query, Zustand, Framer Motion.
- Backend: FastAPI, SQLAlchemy 2, SQLite, HTTPX for the Ollama API, JSON Schema validation.
- Public inference: Google Gemma 4 (`@cf/google/gemma-4-26b-a4b-it`) on Cloudflare Workers Free, with D1 quota counters.
- Optional local inference: Qwen3 4B via Ollama (override with `OLLAMA_MODEL`).
- Deploy: static frontend on Vercel Hobby; live endpoint on Cloudflare Workers Free. No laptop or Render backend is needed for the public demo.

## Repo layout

```
inbox-triage/
  frontend/        React app, Vite, Tailwind
  cloudflare/      live Worker, quota migration, validation and tests
  backend/         optional local FastAPI app and Ollama runner
  data/
    sample_emails.csv     150 emails sampled from Enron (committed)
    build_dataset.py      script to regenerate the sample
  docs/
    architecture.md       deeper notes on how the pieces fit
    decisions.md          short notes on each judgment call
  .env.example
  README.md
```

## Run it locally

You need Python 3.10+, Node 18+, and [Ollama](https://ollama.com/download).

### 1. Clone and set env

```bash
git clone git@github.com:womputer/inbox-triage.git
cd inbox-triage
cp .env.example .env
# Defaults connect to Ollama on localhost; no API key needed.
```

### 2. Start the local model

Start the Ollama app, or run `ollama serve` in a separate terminal, then:

```bash
ollama pull qwen3:4b
```

The [default model](https://ollama.com/library/qwen3:4b) is a roughly 2.5 GB download. It supports native tool calling. Thinking is disabled for this narrow task. To use another model, pull it and set `OLLAMA_MODEL` to its tag; choose one that supports tool calling and `think: false`.

### 3. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The interactive API docs sit at `http://localhost:8000/docs`.

### 4. Frontend

In a second terminal:

```bash
cd frontend
npm install
VITE_LOCAL_BACKEND=true npm run dev
```

Open `http://localhost:5173`. Click "Upload", drop in `data/sample_emails.csv`, and watch the progress climb. When it's done, hit "Open the inbox".

### Regenerate the dataset (optional)

The sampled CSV is committed, so you almost never need this. If you want to:

```bash
python3 data/build_dataset.py
```

The script downloads the Enron tarball (about 400 MB) if it isn't already in `data/`, scans the corpus, and writes `data/sample_emails.csv`. Use `--maildir PATH` if you've already extracted the tarball.

## Environment variables

| Name | Default | Purpose |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server reachable by the backend. |
| `OLLAMA_MODEL` | `qwen3:4b` | Installed model tag with tool-calling support. |
| `OLLAMA_TIMEOUT_SECONDS` | `120` | Timeout per model request. |
| `DATABASE_URL` | `sqlite:///./tigtagtoe.db` | SQLAlchemy URL. Swap to Postgres by changing this one value. |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated list of allowed origins. |
| `AGENT_CONCURRENCY` | `1` | How many emails the agent processes in parallel. |
| `MAX_EMAILS_PER_RUN` | `300` | Safety cap so an oversized CSV can't run away. |
| `MAX_BODY_CHARS` | `4000` | Caps the email body sent to the model, to keep latency and cost in check. |
| `VITE_TRIAGE_API_URL` | unset | Cloudflare Worker URL for public live triage. |
| `VITE_LOCAL_BACKEND` | `false` | Enable the optional CSV/Ollama interface. |
| `VITE_API_BASE_URL` | `http://localhost:8000` | Frontend only. Where the API lives. |

Only the backend calls Ollama. Local inference requires no API key, and email content stays on the machine running the backend and model. A remote `OLLAMA_BASE_URL` sends email content to that host.

## API contract

There's a full OpenAPI schema at `GET /openapi.json` and a browsable version at `/docs`. The endpoints you'll actually hit:

| Method + path | What it does |
|---|---|
| `POST /api/uploads` | Multipart upload of a CSV. Returns `upload_id`, count, parse warnings. |
| `POST /api/agent/run` | Body `{ "upload_id": "..." }`. Kicks off the agent in the background. |
| `GET /api/uploads/{id}/status` | Poll for progress (`agent_status`, `agent_progress`, `agent_total`). |
| `GET /api/emails` | List emails. Query params: `upload_id`, `tool`, `q`, `limit`, `offset`. |
| `GET /api/emails/{id}` | Single email plus every tool call the agent made for it. |
| `POST /api/tools/{name}/execute` | Run the deterministic mock for a tool. Body: `{ "arguments": {...} }`. |
| `GET /api/tools` | The tool catalog the agent is aware of. |

Errors come back as `{ "detail": "..." }` with a meaningful HTTP code.

## The tool catalog

The agent picks from these six tools. Every tool also requires a `rationale` field so the model has to explain its choice in one sentence.

| Tool | When the agent reaches for it |
|---|---|
| `schedule_meeting` | The email proposes a time or asks if you're free. Arguments: attendees, proposed_time, duration_minutes, subject. |
| `draft_response` | The email asks a question or expects a reply. Arguments: to, subject, body, tone. |
| `escalate_to_manager` | The sender is unhappy, threatening to leave, or anything legally or politically sensitive. Arguments: reason, priority, original_email_id, suggested_owner. |
| `create_task` | There's a concrete deliverable or follow-up to track. Arguments: title, due_date, assignee, notes. |
| `flag_urgent` | Time-sensitive but no reply needed. Arguments: reason, deadline. |
| `archive_no_action` | Newsletters, FYIs, auto-generated messages. Arguments: category, reason. |

The mocked execution for each tool returns a realistic-looking JSON payload (fake meeting ID, ticket number, draft preview, archive folder, etc). Outputs are derived from a SHA-1 of the inputs so they're stable across runs.

## How the agent actually works

The runner is in `backend/app/agent/runner.py`. For each email it does this:

1. Pull the email out of SQLite.
2. Render a user message that includes the metadata and a trimmed body.
3. Call Ollama’s `/api/chat` endpoint with the tool catalog and system prompt.
4. Validate every returned function name and argument object against the catalog, including a nonempty rationale. Retry missing or malformed calls once. Only then strip `rationale` and store one `ToolCall` row per call.
5. Update the upload's `agent_progress` counter so the UI can show live progress.

Calls use an `asyncio.Semaphore`, defaulting to one email at a time to avoid overwhelming a local model server. HTTP failures and timeouts are recorded per email; invalid model output gets one corrective retry. A failed email does not stop the remaining emails. No cloud provider fallback is used.

### Backend tests

```bash
cd backend
python -m unittest discover -s tests -v
```

The tests use an isolated SQLite database and simulated Ollama responses; they do not download a model or make paid API calls. Assess model quality separately on representative emails before claiming accuracy or throughput.

## Persistence

SQLite. Three tables: `uploads`, `emails`, `tool_calls`. Created automatically on first boot (`Base.metadata.create_all`).

If you want Postgres in production, change `DATABASE_URL` to a `postgresql+psycopg://...` URL and the rest works. The agent runner doesn't assume SQLite anywhere.

## Re-uploads

If you upload a second CSV, it creates a new `Upload` row. The frontend's "active upload" is stored in `localStorage`, so the inbox always points at the most recent one. To wipe everything, delete `backend/tigtagtoe.db` and restart the API.

## What I deliberately didn't build

- Real integrations with calendar, Jira, email, or anything else. The spec was clear that tools should be mocked, so they are.
- A background job queue (Celery, RQ). For 150 emails, an `asyncio` task in the FastAPI process is enough. If you wanted to scale to 50 thousand emails per upload, that's the first thing I'd swap in.
- Multi-user accounts. There's one inbox.
- Broad test coverage outside the agent integration. The runner has regression tests; the CSV parser and mock executor remain future targets.
- Streaming progress via Server-Sent Events. Polling every 1.5 seconds is plenty for this workload and one less moving part.

## Tradeoffs worth calling out

- Qwen3 4B is a starting point for a small local tool-calling model. Its accuracy and throughput need measurement on this dataset.
- Concurrency defaults to 1. Increase only after measuring memory use and latency on the inference host.
- The dropzone validates the column header before insert. Bad rows get logged as warnings and skipped rather than failing the whole upload.
- The agent's mock results are deterministic from the arguments. Reviewers see the same output if they click the same tool call twice, which is what the spec asks for.

## Notes on the dataset

The sampler scores emails on six categories (question, meeting, complaint, urgent, action, FYI) and picks a balanced mix. The goal is that reviewers see the agent making interesting decisions, not 150 archives in a row. Rough split in the sampled file: 30 questions, 25 meeting proposals, 20 complaints, 20 urgent, 20 action items, 25 FYIs, 10 general.

The sampler trims quoted reply chains (`-----Original Message-----` and friends) and caps bodies at 2500 characters so the CSV stays small and the prompts stay cheap.

## Optional local-backend hosting notes

These notes concern the CSV/Ollama backend only. For the deployed portfolio, use [Cloudflare deployment instructions](cloudflare/README.md).

- A deployed backend needs an always-available Ollama host with enough memory for the chosen model. Set `OLLAMA_BASE_URL` to an address reachable from that backend. `localhost` on Render does **not** reach your laptop. The Render manifest configures the API only; it does not provision inference.
- Keep Ollama on a private network reachable by the backend. Do not expose its unauthenticated port directly to the public internet. If no inference host is available, the live site cannot process new uploads; local operation still works. Self-hosting removes per-call provider fees but still uses compute resources.

- Frontend on Vercel reads `VITE_API_BASE_URL` at build time. Point it at the Render URL.
- Backend on Render reads everything from env vars. SQLite lives inside the container on the free tier, which means data resets when Render restarts the service. For a portfolio demo this is fine because the sample CSV is one click away. Persistent storage means moving to a paid Render plan with a disk, or switching `DATABASE_URL` to a Render Postgres instance.
- First request to a cold Render free-tier service can take 30 to 60 seconds. The upload page shows a "warming up" state when that happens.
- CORS is restricted to `CORS_ORIGINS`. Add your Vercel URL there.

## License

MIT.

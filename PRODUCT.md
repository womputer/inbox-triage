# Product
<!-- impeccable:product-schema 1 -->
## Platform
web
## Purpose and users
Inbox Triage is a portfolio demo of email triage with model-selected tools and rationales. Visitors can immediately explore fictional sample emails, then optionally submit a short non-sensitive email for live triage.
## Confirmed constraints
The user requested Cloudflare Free inference, a precomputed sample inbox, no dependence on their laptop, and no usage charges. They rejected the replacement design and asked to retain the original interface.
The six tools simulate meetings, replies, escalations, tasks, urgency flags and archival. They do not perform external actions.
## Implementation
React/Vite frontend on Vercel Hobby at its free hosting URL. Cloudflare Worker handles bounded live inference. D1 stores quota counters only. Sample content and model suggestions are static assets. Local FastAPI/Ollama remains available behind VITE_LOCAL_BACKEND=true.
## Evidence
Synthetic sample emails are labeled. Model results have provenance. No accuracy, throughput, customer, or uptime claims are established.

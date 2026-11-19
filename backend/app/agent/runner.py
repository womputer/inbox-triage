"""Agent run loop.

Processes a set of emails through Ollama, persists each tool call with its
rationale, and updates the upload's progress along the way.

Concurrency comes from running several emails in parallel via asyncio +
a bounded semaphore. SQLite writes are quick enough that we don't worry
about a separate executor; each task opens its own short-lived session.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from jsonschema import Draft202012Validator, ValidationError

from app.agent.prompts import SYSTEM_PROMPT, render_email_user_message
from app.agent.tools import TOOLS, get_tool_definition, split_rationale
from app.config import get_settings
from app.db import session_scope
from app.models import Email, ToolCall, Upload

logger = logging.getLogger(__name__)


def _validate_calls(response: dict[str, Any]) -> list[dict[str, Any]]:
    """Validate the entire response before writing any calls to the database."""
    calls = response.get("message", {}).get("tool_calls")
    if not isinstance(calls, list) or not calls:
        raise ValueError("Model returned no tool calls.")
    validated = []
    for call in calls:
        function = call.get("function", {})
        definition = get_tool_definition(function.get("name"))
        if definition is None:
            raise ValueError("Model returned an unknown tool.")
        arguments = function.get("arguments")
        Draft202012Validator(definition["input_schema"]).validate(arguments)
        if not arguments["rationale"].strip():
            raise ValueError("Model returned an empty rationale.")
        validated.append(function)
    return validated


async def _select_tools(user_message: str) -> list[dict[str, Any]]:
    settings = get_settings()
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_message},
    ]
    tools = [
        {"type": "function", "function": {
            "name": tool["name"],
            "description": tool["description"],
            "parameters": tool["input_schema"],
        }}
        for tool in TOOLS
    ]
    # Keep the client scoped to this worker's event loop, including BackgroundTasks.
    async with httpx.AsyncClient(timeout=settings.ollama_timeout_seconds) as client:
        for attempt in range(2):
            response = await client.post(
                f"{settings.ollama_base_url.rstrip('/')}/api/chat",
                json={
                    "model": settings.ollama_model,
                    "messages": messages,
                    "tools": tools,
                    "stream": False,
                    "think": False,
                    "options": {"temperature": 0, "num_ctx": 8192, "num_predict": 2048},
                },
            )
            if response.status_code == 404:
                raise RuntimeError(
                    f"Ollama model or endpoint not found. Check OLLAMA_BASE_URL "
                    f"and run `ollama pull {settings.ollama_model}` on the model host."
                )
            response.raise_for_status()
            try:
                return _validate_calls(response.json())
            except (ValueError, TypeError, AttributeError, KeyError, ValidationError):
                if attempt:
                    raise
                # Native tool calling is not guaranteed. Retry once, without
                # persisting partial results or inventing a fallback classification.
                messages.append({"role": "user", "content": (
                    "Return at least one tool call from the provided catalog. "
                    "Use the exact argument types and all required fields, "
                    "including a nonempty one-sentence rationale."
                )})
    raise RuntimeError("Model returned no valid tool calls.")


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _process_one_email(
    email_id: str,
    *,
    semaphore: asyncio.Semaphore,
) -> bool:
    """Run the agent on a single email and persist its tool calls.

    Returns True on success, False on a per-email error. Errors are caught
    and recorded on the email row so the run can continue.
    """
    settings = get_settings()

    async with semaphore:
        # Load the email fresh inside the worker so each task owns its session.
        with session_scope() as db:
            email = db.get(Email, email_id)
            if email is None:
                return False
            email_payload = {
                "source_id": email.source_id,
                "sender": email.sender,
                "recipients": email.recipients,
                "cc": email.cc,
                "subject": email.subject,
                "sent_at": email.sent_at,
                "body": email.body,
            }

        user_message = render_email_user_message(
            **email_payload, max_body_chars=settings.max_body_chars
        )

        try:
            tool_calls = await _select_tools(user_message)
        except Exception as exc:  # noqa: BLE001, we want to capture every failure mode
            logger.exception("Agent error on email %s", email_id)
            with session_scope() as db:
                em = db.get(Email, email_id)
                if em is not None:
                    em.agent_status = "error"
                    em.agent_error = f"{type(exc).__name__}: {exc}"[:1000]
            return False

        with session_scope() as db:
            em = db.get(Email, email_id)
            if em is None:
                return False
            for idx, function in enumerate(tool_calls):
                args, rationale = split_rationale(function["arguments"])
                db.add(
                    ToolCall(
                        email_id=em.id,
                        tool_name=function["name"],
                        arguments=args,
                        rationale=rationale,
                        order_idx=idx,
                    )
                )
            em.agent_status = "done"
            em.agent_error = None

        return True


async def run_agent_for_upload(upload_id: str) -> None:
    """Run the agent over every pending email in an upload."""
    settings = get_settings()

    with session_scope() as db:
        upload = db.get(Upload, upload_id)
        if upload is None:
            logger.warning("run_agent_for_upload: upload %s not found", upload_id)
            return

        email_ids = [
            e.id
            for e in db.query(Email)
            .filter(Email.upload_id == upload_id)
            .filter(Email.agent_status.in_(("pending", "error")))
            .order_by(Email.created_at.asc())
            .all()
        ]

        if not email_ids:
            upload.agent_status = "done"
            upload.agent_progress = upload.agent_total = upload.email_count
            upload.agent_finished_at = _now()
            return

        # Cap to the per-run safety limit.
        email_ids = email_ids[: settings.max_emails_per_run]

        upload.agent_status = "running"
        upload.agent_progress = 0
        upload.agent_total = len(email_ids)
        upload.agent_started_at = _now()
        upload.agent_finished_at = None
        upload.agent_error_count = 0

    semaphore = asyncio.Semaphore(settings.agent_concurrency)
    error_count = 0
    done_count = 0

    async def worker(eid: str) -> None:
        nonlocal error_count, done_count
        ok = await _process_one_email(eid, semaphore=semaphore)
        if ok:
            done_count += 1
        else:
            error_count += 1
        # Push progress to the DB after each email so the UI can poll.
        with session_scope() as db:
            up = db.get(Upload, upload_id)
            if up is not None:
                up.agent_progress = done_count + error_count
                up.agent_error_count = error_count

    await asyncio.gather(*(worker(eid) for eid in email_ids))

    with session_scope() as db:
        upload = db.get(Upload, upload_id)
        if upload is not None:
            upload.agent_status = "done" if error_count == 0 else "done"
            upload.agent_finished_at = _now()
            upload.agent_progress = done_count + error_count
            upload.agent_error_count = error_count

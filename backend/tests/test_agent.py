"""Ollama contract and persistence regressions; no live model required."""
import asyncio
from contextlib import contextmanager
import json
import unittest
from unittest.mock import patch

import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.agent import runner
from app.config import Settings
from app.db import Base
from app.models import Email, ToolCall, Upload


def archive():
    return {"function": {"name": "archive_no_action", "arguments": {
        "category": "fyi", "reason": "An informational update.",
        "rationale": "The sender explicitly says no action is needed.",
    }}}


def response(*calls):
    return {"message": {"role": "assistant", "content": "", "tool_calls": list(calls)}}


class AgentTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        factory = sessionmaker(bind=self.engine)

        @contextmanager
        def sessions():
            with factory.begin() as db:
                yield db

        self.sessions = sessions
        self.settings = Settings(_env_file=None, ollama_base_url="http://model.test:11434",
                                 ollama_model="test-model", agent_concurrency=1)
        self.patches = [patch.object(runner, "session_scope", sessions),
                        patch.object(runner, "get_settings", return_value=self.settings)]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])
        self.addCleanup(self.engine.dispose)

    def seed(self, count=1):
        with self.sessions() as db:
            db.add(Upload(id="upload", filename="test.csv", email_count=count))
            for i in range(count):
                db.add(Email(id=str(i), upload_id="upload", source_id=str(i),
                             sender="sender@example.com", subject="FYI", body="No action needed."))

    async def run_with(self, replies, count=1):
        self.seed(count)
        self.requests = []
        def handler(request):
            self.requests.append(request)
            item = replies.pop(0)
            if isinstance(item, Exception):
                raise item
            status, payload = item
            return httpx.Response(status, json=payload)
        # Runner scopes a client per email. Preserve separate real clients for each worker.
        client_class = httpx.AsyncClient
        with patch.object(runner.httpx, "AsyncClient", side_effect=lambda **kw:
                          client_class(transport=httpx.MockTransport(handler), **kw)):
            await asyncio.wait_for(runner.run_agent_for_upload("upload"), timeout=3)

    async def test_success_preserves_multiple_calls_and_rationale(self):
        urgent = {"function": {"name": "flag_urgent", "arguments": {
            "reason": "Deadline", "rationale": "Due today."}}}
        await self.run_with([(200, response(archive(), urgent))])
        payload = json.loads(self.requests[0].content)
        self.assertEqual(str(self.requests[0].url), "http://model.test:11434/api/chat")
        self.assertEqual(payload["model"], "test-model")
        self.assertFalse(payload["stream"])
        self.assertFalse(payload["think"])
        self.assertEqual(len(payload["tools"]), 6)
        self.assertIn("parameters", payload["tools"][0]["function"])
        with self.sessions() as db:
            calls = db.query(ToolCall).order_by(ToolCall.order_idx).all()
            self.assertEqual([c.tool_name for c in calls], ["archive_no_action", "flag_urgent"])
            self.assertNotIn("rationale", calls[0].arguments)
            self.assertTrue(calls[0].rationale)
            self.assertEqual(db.get(Email, "0").agent_status, "done")
            self.assertEqual(db.get(Upload, "upload").agent_progress, 1)

    async def test_missing_calls_retry_once_and_recover(self):
        await self.run_with([(200, response()), (200, response(archive()))])
        self.assertEqual(len(self.requests), 2)
        with self.sessions() as db:
            self.assertEqual(db.get(Email, "0").agent_status, "done")

    async def test_invalid_calls_never_partially_persist(self):
        cases = [response(), response({"function": {"name": "invented", "arguments": {}}})]
        for field, value in [("category", "invalid"), ("reason", 42), ("rationale", " ")]:
            call = archive(); call["function"]["arguments"][field] = value
            cases.append(response(archive(), call))
        missing = archive(); del missing["function"]["arguments"]["reason"]
        cases.append(response(missing))
        for payload in cases:
            with self.subTest(payload=payload):
                with self.sessions() as db:
                    db.query(ToolCall).delete(); db.query(Email).delete(); db.query(Upload).delete()
                await self.run_with([(200, payload), (200, payload)])
                self.assertEqual(len(self.requests), 2)
                with self.sessions() as db:
                    self.assertEqual(db.query(ToolCall).count(), 0)
                    self.assertEqual(db.get(Email, "0").agent_status, "error")
                    self.assertEqual(db.get(Upload, "upload").agent_error_count, 1)

    async def test_http_error_does_not_stall_single_concurrency(self):
        await self.run_with([(429, {"error": "busy"}), (200, response(archive()))], count=2)
        with self.sessions() as db:
            upload = db.get(Upload, "upload")
            self.assertEqual(upload.agent_progress, 2)
            self.assertEqual(upload.agent_error_count, 1)
            self.assertEqual(upload.agent_status, "done")
            self.assertEqual(db.query(ToolCall).count(), 1)

    async def test_missing_model_reports_setup_hint(self):
        await self.run_with([(404, {"error": "missing model"})])
        with self.sessions() as db:
            self.assertIn("ollama pull test-model", db.get(Email, "0").agent_error)

    async def test_timeout_is_recorded(self):
        await self.run_with([httpx.ReadTimeout("Model request timed out")])
        with self.sessions() as db:
            self.assertIn("ReadTimeout", db.get(Email, "0").agent_error)
            self.assertEqual(db.get(Upload, "upload").agent_progress, 1)


if __name__ == "__main__":
    unittest.main()

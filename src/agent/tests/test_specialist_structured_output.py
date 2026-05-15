import asyncio
import json
import unittest
from types import SimpleNamespace

from pydantic import BaseModel

from agents.architect.output import ArchitectOutput
from agents.cost_capacity.output import CostCapacityOutput
from agents.devops.output import DevOpsOutput
from agents.engineer.output import EngineerOutput
from agents.reviewer.output import ReviewerOutput
from agents.security_prover.output import SecurityProverOutput
from agents.specialist_output import STRUCTURED_OUTPUT_CONTRACT, SpecialistResponse
from agents.cancellation import cancel_session_agents
from agents.tool_adapter import create_agent_text_tool


class DummyOutput(SpecialistResponse):
    agent: str = "dummy_agent"


class DummyResult:
    def __init__(self, structured_output: BaseModel):
        self.structured_output = structured_output


class DummyAgent:
    def __init__(self, pending_user_handoff=None):
        self.stream_kwargs = None
        self.input_text = None
        self.state = {"pending_user_handoff": pending_user_handoff}

    async def stream_async(self, input_text, **kwargs):
        self.input_text = input_text
        self.stream_kwargs = kwargs
        yield {"result": DummyResult(DummyOutput(status="complete", summary="done"))}


class BlockingAgent:
    def __init__(self, release):
        self.release = release
        self.cancelled = False
        self.state = {}

    def cancel(self):
        self.cancelled = True

    async def stream_async(self, input_text, **kwargs):
        yield {"init_event_loop": True}
        await self.release.wait()
        yield {"result": DummyResult(DummyOutput(status="complete", summary="done"))}


class SpecialistStructuredOutputTests(unittest.TestCase):
    def test_adapter_requests_structured_output_and_returns_json(self):
        dummy_agent = DummyAgent()

        tool = create_agent_text_tool(
            name="dummy_agent",
            description="Dummy",
            create_agent=lambda model, runtime_tools, trace_attributes: dummy_agent,
            model=None,
            runtime_tools=None,
            trace_attributes={},
            output_model=DummyOutput,
        )
        tool_context = SimpleNamespace(
            agent=SimpleNamespace(
                state=SimpleNamespace(
                    get=lambda key: "original" if key == "original_user_prompt" else None,
                    set=lambda key, value: None,
                )
            ),
            invocation_state={},
        )

        async def collect():
            chunks = []
            async for chunk in tool.__wrapped__("delegated", tool_context):
                chunks.append(chunk)
            return chunks

        chunks = asyncio.run(collect())
        self.assertIs(dummy_agent.stream_kwargs["structured_output_model"], DummyOutput)
        payload = json.loads(chunks[-1])
        self.assertEqual(payload["agent"], "dummy_agent")
        self.assertEqual(payload["status"], "complete")
        self.assertEqual(payload["summary"], "done")

    def test_adapter_passes_multimodal_context_to_specialist(self):
        dummy_agent = DummyAgent()
        image_bytes = b"image-bytes"
        original_context = [
            {"text": "Original prompt with pasted image."},
            {"image": {"format": "png", "source": {"bytes": image_bytes}}},
        ]

        tool = create_agent_text_tool(
            name="dummy_agent",
            description="Dummy",
            create_agent=lambda model, runtime_tools, trace_attributes: dummy_agent,
            model=None,
            runtime_tools=None,
            trace_attributes={},
            output_model=DummyOutput,
        )
        tool_context = SimpleNamespace(
            agent=SimpleNamespace(
                state=SimpleNamespace(
                    get=lambda key: {
                        "original_user_prompt": "Original prompt with pasted image.",
                        "original_user_context": original_context,
                    }.get(key),
                    set=lambda key, value: None,
                )
            ),
            invocation_state={},
        )

        async def collect():
            chunks = []
            async for chunk in tool.__wrapped__("Inspect the pasted image.", tool_context):
                chunks.append(chunk)
            return chunks

        asyncio.run(collect())
        self.assertIsInstance(dummy_agent.input_text, list)
        self.assertEqual(dummy_agent.input_text[1]["image"]["source"]["bytes"], image_bytes)
        self.assertEqual(dummy_agent.input_text[2]["text"], "Orchestrator delegation:\nInspect the pasted image.")

    def test_adapter_propagates_specialist_handoff_to_parent_and_stops(self):
        handoff = {
            "type": "user_handoff",
            "questions": [
                {
                    "id": "q1",
                    "question": "Which region should I use?",
                    "options": ["us-east-1", "us-west-2", "ap-southeast-1"],
                }
            ],
        }
        dummy_agent = DummyAgent(pending_user_handoff=handoff)
        parent_state = {}
        invocation_state = {}

        tool = create_agent_text_tool(
            name="dummy_agent",
            description="Dummy",
            create_agent=lambda model, runtime_tools, trace_attributes: dummy_agent,
            model=None,
            runtime_tools=None,
            trace_attributes={},
            output_model=DummyOutput,
        )
        tool_context = SimpleNamespace(
            agent=SimpleNamespace(
                state=SimpleNamespace(
                    get=lambda key: "original" if key == "original_user_prompt" else parent_state.get(key),
                    set=lambda key, value: parent_state.__setitem__(key, value),
                )
            ),
            invocation_state=invocation_state,
        )

        async def collect():
            chunks = []
            async for chunk in tool.__wrapped__("delegated", tool_context):
                chunks.append(chunk)
            return chunks

        chunks = asyncio.run(collect())
        payload = json.loads(chunks[-1])
        self.assertEqual(parent_state["pending_user_handoff"], handoff)
        self.assertTrue(invocation_state["stop_event_loop"])
        self.assertEqual(payload["status"], "needs_input")
        self.assertEqual(payload["handoff_questions"], ["Which region should I use?"])

    def test_adapter_registers_specialist_agent_for_session_cancellation(self):
        async def run_test():
            release = asyncio.Event()
            dummy_agent = BlockingAgent(release)
            tool = create_agent_text_tool(
                name="dummy_agent",
                description="Dummy",
                create_agent=lambda model, runtime_tools, trace_attributes: dummy_agent,
                model=None,
                runtime_tools=None,
                trace_attributes={"session.id": "session-cancel"},
                output_model=DummyOutput,
            )
            tool_context = SimpleNamespace(
                agent=SimpleNamespace(
                    state=SimpleNamespace(
                        get=lambda key: "original" if key == "original_user_prompt" else None,
                        set=lambda key, value: None,
                    )
                ),
                invocation_state={},
            )

            gen = tool.__wrapped__("delegated", tool_context)
            self.assertEqual(
                await gen.__anext__(),
                {"specialistToolProgress": {"phase": "started", "message": "dummy_agent started"}},
            )
            self.assertEqual(
                await gen.__anext__(),
                {"specialistToolProgress": {"phase": "thinking", "message": "dummy_agent is thinking"}},
            )
            self.assertEqual(cancel_session_agents("session-cancel"), 1)
            self.assertTrue(dummy_agent.cancelled)
            release.set()
            chunks = []
            async for chunk in gen:
                chunks.append(chunk)
            self.assertTrue(chunks)
            self.assertEqual(cancel_session_agents("session-cancel"), 0)

        asyncio.run(run_test())

    def test_all_specialist_output_models_share_common_contract(self):
        for model in (
            ArchitectOutput,
            EngineerOutput,
            ReviewerOutput,
            CostCapacityOutput,
            SecurityProverOutput,
            DevOpsOutput,
        ):
            self.assertTrue(issubclass(model, SpecialistResponse))
            fields = model.model_fields
            for field in ("agent", "status", "summary", "findings", "verifications", "artifacts"):
                self.assertIn(field, fields)

    def test_structured_output_contract_is_in_all_specialist_prompts(self):
        from agents.architect.system_prompt import SYSTEM_PROMPT as architect_prompt
        from agents.cost_capacity.system_prompt import SYSTEM_PROMPT as cost_prompt
        from agents.devops.system_prompt import SYSTEM_PROMPT as devops_prompt
        from agents.engineer.system_prompt import SYSTEM_PROMPT as engineer_prompt
        from agents.reviewer.system_prompt import SYSTEM_PROMPT as reviewer_prompt
        from agents.security_prover.system_prompt import SYSTEM_PROMPT as security_prompt

        for prompt in (
            architect_prompt,
            engineer_prompt,
            reviewer_prompt,
            cost_prompt,
            security_prompt,
            devops_prompt,
        ):
            self.assertIn(STRUCTURED_OUTPUT_CONTRACT, prompt)
            self.assertIn("status", prompt)
            self.assertIn("summary", prompt)


if __name__ == "__main__":
    unittest.main()

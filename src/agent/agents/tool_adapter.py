"""Helpers for exposing specialist agents as orchestrator tools."""

import base64
import json
from collections.abc import Callable

from pydantic import BaseModel
from strands import Agent, ToolContext, tool

from agents.cancellation import registered_agent
from agents.runtime import AgentRuntimeTools


AgentFactory = Callable[[object, AgentRuntimeTools, dict], Agent]


def create_agent_text_tool(
    *,
    name: str,
    description: str,
    create_agent: AgentFactory,
    model: object,
    runtime_tools: AgentRuntimeTools,
    trace_attributes: dict,
    output_model: type[BaseModel] | None = None,
):
    """Create a non-streaming specialist tool that returns the agent's final text.

    Strands' Agent.as_tool streams sub-agent events into the parent stream. That is
    useful for progress display, but it can leak sub-agent side effects such as
    handoff events and make the parent/UI disagree about the actual tool result.
    The orchestrator needs a plain tool result, so each invocation uses a fresh
    specialist agent and returns only its final AgentResult text.
    """

    @tool(name=name, description=description, context=True)
    async def specialist_agent(input: str, tool_context: ToolContext):
        agent = create_agent(model, runtime_tools, trace_attributes)
        session_id = str(trace_attributes.get("session.id") or "")
        specialist_input = _with_original_user_prompt(
            original_user_prompt=tool_context.agent.state.get("original_user_prompt"),
            original_context=tool_context.agent.state.get("original_user_context"),
            specialist_input=input,
        )
        yield _progress("started", f"{name} started")

        result = None
        text_buffer = ""
        last_text_progress_length = 0
        yielded_thinking = False
        stream_kwargs = {"structured_output_model": output_model} if output_model is not None else {}
        with registered_agent(session_id, agent):
            async for event in agent.stream_async(specialist_input, **stream_kwargs):
                event_dict = dict(event)
                if "result" in event_dict:
                    result = event_dict["result"]
                    continue

                if isinstance(event_dict.get("data"), str):
                    text_buffer += event_dict["data"]
                    if len(text_buffer) - last_text_progress_length >= 160:
                        last_text_progress_length = len(text_buffer)
                        preview = _tail_preview(text_buffer)
                        yield _progress("text", preview)
                    continue

                tool_use = event_dict.get("current_tool_use")
                if isinstance(tool_use, dict):
                    tool_name = str(tool_use.get("name") or "tool")
                    yield _progress("tool", f"{name} is using {tool_name}")
                    continue

                if (
                    event_dict.get("init_event_loop") or event_dict.get("start_event_loop")
                ) and not yielded_thinking:
                    yielded_thinking = True
                    yield _progress("thinking", f"{name} is thinking")

        pending_handoff = agent.state.get("pending_user_handoff")
        if pending_handoff:
            tool_context.agent.state.set("pending_user_handoff", pending_handoff)
            tool_context.invocation_state["stop_event_loop"] = True
            yield _progress("handoff", f"{name} requested user input")
            yield json.dumps(
                {
                    "agent": name,
                    "status": "needs_input",
                    "summary": f"{name} needs user input before continuing.",
                    "handoff_questions": [
                        str(question.get("question") or "")
                        for question in pending_handoff.get("questions", [])
                        if isinstance(question, dict)
                    ],
                },
                indent=2,
            )
            return

        if result is None:
            yield f"{name} did not produce a result"
            return

        structured_output = getattr(result, "structured_output", None)
        if isinstance(structured_output, BaseModel):
            final_text = structured_output.model_dump_json(indent=2)
        elif structured_output is not None:
            final_text = str(structured_output).strip()
        else:
            final_text = str(result).strip()
        final_preview = _tail_preview(final_text)
        if final_preview and len(text_buffer) > last_text_progress_length:
            yield _progress("text", final_preview)
        yield _progress("completed", f"{name} completed")
        yield final_text

    return specialist_agent


def _with_original_user_prompt(
    original_user_prompt: object,
    specialist_input: str,
    original_context: object = None,
) -> str | list[dict]:
    if isinstance(original_context, list):
        context_blocks = _restore_context_blocks(original_context)
        context_text = _extract_text_from_context_blocks(context_blocks)
        delegated = str(specialist_input or "").strip()
        if delegated and delegated not in context_text:
            return [
                *context_blocks,
                {
                    "text": (
                        "Orchestrator delegation:\n"
                        f"{delegated}"
                    )
                },
            ]
        return context_blocks

    original = str(original_user_prompt or "").strip()
    delegated = str(specialist_input or "").strip()
    if not original:
        return delegated
    if delegated and original in delegated:
        return delegated
    if not delegated:
        return f"Original user prompt:\n{original}"
    return (
        "Original user prompt:\n"
        f"{original}\n\n"
        "Orchestrator delegation:\n"
        f"{delegated}"
    )


def _restore_context_blocks(value):
    if isinstance(value, list):
        return [_restore_context_blocks(item) for item in value]
    if isinstance(value, dict):
        if set(value.keys()) == {"__bytes_base64__"}:
            try:
                return base64.b64decode(str(value["__bytes_base64__"]), validate=True)
            except Exception:
                return b""
        return {key: _restore_context_blocks(item) for key, item in value.items()}
    return value


def _extract_text_from_context_blocks(blocks: list[dict]) -> str:
    chunks = []
    for block in blocks:
        if isinstance(block, dict) and isinstance(block.get("text"), str):
            chunks.append(block["text"])
    return "\n".join(chunks)


def _progress(phase: str, message: str) -> dict[str, dict[str, str]]:
    return {"specialistToolProgress": {"phase": phase, "message": message}}


def _tail_preview(text: str, limit: int = 240) -> str:
    compact = " ".join(text.split())
    if not compact:
        return ""
    return compact[-limit:]

"""Helpers for exposing specialist agents as orchestrator tools."""

from collections.abc import Callable

from strands import Agent, ToolContext, tool

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
        specialist_input = _with_original_user_prompt(
            original_user_prompt=tool_context.agent.state.get("original_user_prompt"),
            specialist_input=input,
        )
        yield _progress("started", f"{name} started")

        result = None
        text_buffer = ""
        last_text_progress_length = 0
        yielded_thinking = False
        async for event in agent.stream_async(specialist_input):
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

        if result is None:
            yield f"{name} did not produce a result"
            return

        final_text = str(result).strip()
        final_preview = _tail_preview(final_text)
        if final_preview and len(text_buffer) > last_text_progress_length:
            yield _progress("text", final_preview)
        yield _progress("completed", f"{name} completed")
        yield final_text

    return specialist_agent


def _with_original_user_prompt(original_user_prompt: object, specialist_input: str) -> str:
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


def _progress(phase: str, message: str) -> dict[str, dict[str, str]]:
    return {"specialistToolProgress": {"phase": phase, "message": message}}


def _tail_preview(text: str, limit: int = 240) -> str:
    compact = " ".join(text.split())
    if not compact:
        return ""
    return compact[-limit:]

from __future__ import annotations

from typing import Any

from langchain.agents.middleware._redaction import PIIMatch, RedactionStrategy, apply_strategy, resolve_detector
from langchain.agents.middleware.types import AgentMiddleware, AgentState, hook_config
from langchain_core.messages import AIMessage, AnyMessage, HumanMessage, ToolMessage


def _sanitize_text(
    text: str,
    *,
    pii_type: str,
    detector: Any,
    strategy: RedactionStrategy,
) -> tuple[str, list[PIIMatch]]:
    matches = detector(text)
    if not matches:
        return text, []
    return apply_strategy(text, matches, strategy), matches


def _sanitize_part(
    part: dict[str, Any],
    *,
    pii_type: str,
    detector: Any,
    strategy: RedactionStrategy,
) -> tuple[dict[str, Any], bool]:
    text = part.get("text")
    if not isinstance(text, str):
        return part, False
    sanitized, matches = _sanitize_text(text, pii_type=pii_type, detector=detector, strategy=strategy)
    if not matches:
        return part, False
    return {**part, "text": sanitized}, True


def _sanitize_content(
    content: Any,
    *,
    pii_type: str,
    detector: Any,
    strategy: RedactionStrategy,
) -> tuple[Any, bool]:
    if isinstance(content, str):
        sanitized, matches = _sanitize_text(content, pii_type=pii_type, detector=detector, strategy=strategy)
        return sanitized, bool(matches)
    if isinstance(content, dict):
        return _sanitize_part(content, pii_type=pii_type, detector=detector, strategy=strategy)
    if not isinstance(content, list):
        return content, False
    changed = False
    updated = []
    for item in content:
        if isinstance(item, dict):
            next_item, item_changed = _sanitize_part(
                item,
                pii_type=pii_type,
                detector=detector,
                strategy=strategy,
            )
            updated.append(next_item)
            changed = changed or item_changed
            continue
        updated.append(item)
    return updated if changed else content, changed


def _updated_message(message: AnyMessage, content: Any) -> AnyMessage:
    return message.model_copy(update={"content": content})


def _last_message_index(messages: list[AnyMessage], kind: type[AnyMessage]) -> int | None:
    for index in range(len(messages) - 1, -1, -1):
        if isinstance(messages[index], kind):
            return index
    return None


class StructuredPIIMiddleware(AgentMiddleware):
    def __init__(
        self,
        pii_type: str,
        *,
        strategy: RedactionStrategy = "redact",
        detector: Any = None,
        apply_to_input: bool = True,
        apply_to_output: bool = False,
        apply_to_tool_results: bool = False,
    ) -> None:
        super().__init__()
        self.pii_type = pii_type
        self.strategy = strategy
        self.detector = resolve_detector(pii_type, detector)
        self.apply_to_input = apply_to_input
        self.apply_to_output = apply_to_output
        self.apply_to_tool_results = apply_to_tool_results

    @property
    def name(self) -> str:
        return f"{self.__class__.__name__}[{self.pii_type}]"

    def _sanitize_message(self, message: AnyMessage) -> tuple[AnyMessage, bool]:
        content, changed = _sanitize_content(
            message.content,
            pii_type=self.pii_type,
            detector=self.detector,
            strategy=self.strategy,
        )
        return (_updated_message(message, content), True) if changed else (message, False)

    @hook_config(can_jump_to=["end"])
    def before_model(self, state: AgentState[Any], runtime: Any) -> dict[str, Any] | None:
        del runtime
        messages = state.get("messages") or []
        updated = list(messages)
        changed = False
        if self.apply_to_input:
            index = _last_message_index(updated, HumanMessage)
            if index is not None:
                updated[index], changed_input = self._sanitize_message(updated[index])
                changed = changed or changed_input
        if self.apply_to_tool_results:
            last_ai_index = _last_message_index(updated, AIMessage)
            if last_ai_index is not None:
                for index in range(last_ai_index + 1, len(updated)):
                    if isinstance(updated[index], ToolMessage):
                        updated[index], item_changed = self._sanitize_message(updated[index])
                        changed = changed or item_changed
        return {"messages": updated} if changed else None

    @hook_config(can_jump_to=["end"])
    def after_model(self, state: AgentState[Any], runtime: Any) -> dict[str, Any] | None:
        del runtime
        if not self.apply_to_output:
            return None
        messages = state.get("messages") or []
        index = _last_message_index(messages, AIMessage)
        if index is None:
            return None
        updated_message, changed = self._sanitize_message(messages[index])
        if not changed:
            return None
        updated = list(messages)
        updated[index] = updated_message
        return {"messages": updated}

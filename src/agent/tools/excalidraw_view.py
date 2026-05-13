"""Excalidraw-compatible view tools for inline AgentCore visualizations."""

from __future__ import annotations

import json
import uuid
from typing import Any

from strands import tool


MAX_ELEMENTS_BYTES = 180_000

EXCALIDRAW_ELEMENT_GUIDE = """# Excalidraw View Element Format

Use create_excalidraw_view to draw ideas, workflows, and architecture diagrams inline.
Pass elements as a compact JSON array string. The frontend renders elements in array
order with a draw-on animation.

Element types:
- cameraUpdate: {"type":"cameraUpdate","width":800,"height":600,"x":0,"y":0}
- rectangle: {"type":"rectangle","id":"api","x":120,"y":120,"width":180,"height":80,"backgroundColor":"#a5d8ff","fillStyle":"solid","roundness":{"type":3},"label":{"text":"API","fontSize":18}}
- ellipse: {"type":"ellipse","id":"user","x":40,"y":130,"width":90,"height":70,"backgroundColor":"#fff3bf","fillStyle":"solid","label":{"text":"User","fontSize":16}}
- diamond: {"type":"diamond","id":"decision","x":340,"y":110,"width":120,"height":100,"backgroundColor":"#ffd8a8","fillStyle":"solid","label":{"text":"Valid?","fontSize":16}}
- text: {"type":"text","id":"title","x":80,"y":40,"text":"Workflow","fontSize":24}
- arrow: {"type":"arrow","id":"a1","x":220,"y":160,"width":140,"height":0,"points":[[0,0],[140,0]],"endArrowhead":"arrow","label":{"text":"calls","fontSize":14}}

Use a consistent palette:
- blue #a5d8ff for inputs/frontends
- green #b2f2bb for success/outputs
- orange #ffd8a8 for external/pending
- purple #d0bfff for agent/logic
- teal #c3fae8 for storage/data
- red #ffc9c9 for risk/error

Keep ids unique and stable. Prefer labeled shapes over separate text.
Emit progressively: background zones, first node, arrow, next node, etc.
For large diagrams, use cameraUpdate before the section it frames.
Do not use emoji in text.
"""


def _parse_elements(elements: str) -> list[dict[str, Any]]:
    if len(elements.encode("utf-8")) > MAX_ELEMENTS_BYTES:
        raise ValueError(f"elements exceeds {MAX_ELEMENTS_BYTES} bytes")
    parsed = json.loads(elements)
    if not isinstance(parsed, list):
        raise ValueError("elements must be a JSON array")

    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(parsed):
        if not isinstance(item, dict):
            raise ValueError(f"element {index} must be an object")
        element_type = str(item.get("type") or "").strip()
        if not element_type:
            raise ValueError(f"element {index} is missing type")
        if element_type not in {"cameraUpdate", "rectangle", "ellipse", "diamond", "text", "arrow", "line", "delete"}:
            raise ValueError(f"element {index} has unsupported type: {element_type}")
        if element_type not in {"cameraUpdate", "delete"} and not str(item.get("id") or "").strip():
            raise ValueError(f"element {index} is missing id")
        normalized.append(item)
    return normalized


@tool
def read_excalidraw_guide() -> str:
    """Return the Excalidraw-compatible element format for create_excalidraw_view."""
    return EXCALIDRAW_ELEMENT_GUIDE


@tool
def create_excalidraw_view(elements: str, title: str = "AgentCore sketch") -> str:
    """
    Render a hand-drawn Excalidraw-style view in the chat.

    Args:
        elements: Compact JSON array string of Excalidraw-compatible elements.
        title: Short title for the view.

    Returns:
        JSON payload consumed by the frontend renderer.
    """
    parsed = _parse_elements(elements)
    checkpoint_id = uuid.uuid4().hex[:18]
    return json.dumps(
        {
            "ok": True,
            "type": "excalidraw_view",
            "title": (title or "AgentCore sketch").strip()[:80],
            "checkpoint_id": checkpoint_id,
            "elements": parsed,
            "element_count": len(parsed),
            "source": "excalidraw-mcp-compatible",
        },
        default=str,
    )

"""Session-scoped cancellation for concurrently running Strands agents."""

from __future__ import annotations

from contextlib import contextmanager
from threading import RLock
from typing import Iterator, Protocol


class CancellableAgent(Protocol):
    def cancel(self) -> None: ...


_lock = RLock()
_agents_by_session: dict[str, set[CancellableAgent]] = {}


@contextmanager
def registered_agent(session_id: str | None, agent: CancellableAgent) -> Iterator[None]:
    if not session_id:
        yield
        return

    with _lock:
        agents = _agents_by_session.setdefault(session_id, set())
        agents.add(agent)
    try:
        yield
    finally:
        with _lock:
            agents = _agents_by_session.get(session_id)
            if agents is None:
                return
            agents.discard(agent)
            if not agents:
                _agents_by_session.pop(session_id, None)


def cancel_session_agents(session_id: str | None) -> int:
    if not session_id:
        return 0
    with _lock:
        agents = list(_agents_by_session.get(session_id, ()))
    for agent in agents:
        agent.cancel()
    return len(agents)

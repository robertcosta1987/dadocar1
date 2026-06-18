"""history.py — simple in-memory per-contact conversation history (text turns).

Stores assistant transcripts and user text turns so the model has context across
turns. User AUDIO turns are passed live (not stored verbatim) — we keep a short
marker so the thread stays coherent. Capped per contact.

Namespaced by tenant so white-label customers never share conversation context
(key = "<tenant_id>:<contact>"). In-memory: context is best-effort and resets on
restart — that's fine (usage metering, which must be durable, lives in store.py)."""
from collections import defaultdict, deque
from config import MAX_HISTORY

_store: dict[str, deque] = defaultdict(lambda: deque(maxlen=MAX_HISTORY))


def _key(tenant_id: str, contact: str) -> str:
    return f"{tenant_id}:{contact}"


def get(tenant_id: str, contact: str) -> list[dict]:
    return list(_store[_key(tenant_id, contact)])


def add_user_text(tenant_id: str, contact: str, text: str) -> None:
    _store[_key(tenant_id, contact)].append({"role": "user", "content": text})


def add_user_audio_marker(tenant_id: str, contact: str) -> None:
    _store[_key(tenant_id, contact)].append({"role": "user", "content": "(o cliente enviou uma mensagem de voz)"})


def add_assistant(tenant_id: str, contact: str, text: str) -> None:
    if text:
        _store[_key(tenant_id, contact)].append({"role": "assistant", "content": text})

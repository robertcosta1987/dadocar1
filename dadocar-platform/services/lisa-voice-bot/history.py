"""history.py — simple in-memory per-contact conversation history (text turns).

Stores assistant transcripts and user text turns so the model has context across
turns. User AUDIO turns are passed live (not stored verbatim) — we keep a short
marker so the thread stays coherent. Capped per contact."""
from collections import defaultdict, deque
from config import MAX_HISTORY

_store: dict[str, deque] = defaultdict(lambda: deque(maxlen=MAX_HISTORY))


def get(contact: str) -> list[dict]:
    return list(_store[contact])


def add_user_text(contact: str, text: str) -> None:
    _store[contact].append({"role": "user", "content": text})


def add_user_audio_marker(contact: str) -> None:
    _store[contact].append({"role": "user", "content": "(o cliente enviou uma mensagem de voz)"})


def add_assistant(contact: str, text: str) -> None:
    if text:
        _store[contact].append({"role": "assistant", "content": text})

"""brain.py — OpenAI calls.

Voice: one speech-to-speech call to gpt-audio (audio in + audio out + transcript).
Text: a normal chat completion with the same model family as the web bot (gpt-5-mini).
Uses the verified Chat Completions audio schema:
  request:  modalities:["text","audio"], audio:{voice,format:"mp3"},
            user content -> {type:"input_audio", input_audio:{data:<b64>, format:"mp3"}}
  response: choices[0].message.audio.{data(b64 mp3), transcript}
"""
import base64
import logging
import httpx
from config import (FIRST_TURN_INSTRUCTION, OPENAI_API_KEY, OPENAI_AUDIO_MODEL,
                    OPENAI_TEXT_MODEL, OPENAI_VOICE, SYSTEM_PROMPT)

log = logging.getLogger("lisa.brain")
OPENAI_URL = "https://api.openai.com/v1/chat/completions"


def _headers() -> dict:
    return {"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"}


def _system(first: bool) -> list[dict]:
    """Base persona + (on the first turn) the greet/can-receive-audio instruction."""
    msgs = [{"role": "system", "content": SYSTEM_PROMPT}]
    if first:
        msgs.append({"role": "system", "content": FIRST_TURN_INSTRUCTION})
    return msgs


async def respond_to_audio(history: list[dict], input_mp3: bytes, first: bool = False) -> tuple[bytes, str]:
    """Speech-to-speech: returns (reply_mp3_bytes, reply_transcript)."""
    b64 = base64.b64encode(input_mp3).decode("ascii")
    messages = [*_system(first), *history,
                {"role": "user", "content": [{"type": "input_audio",
                                              "input_audio": {"data": b64, "format": "mp3"}}]}]
    payload = {
        "model": OPENAI_AUDIO_MODEL,
        "modalities": ["text", "audio"],
        "audio": {"voice": OPENAI_VOICE, "format": "mp3"},
        "messages": messages,
    }
    async with httpx.AsyncClient(timeout=120) as c:
        r = await c.post(OPENAI_URL, headers=_headers(), json=payload)
    if r.status_code != 200:
        raise RuntimeError(f"OpenAI audio {r.status_code}: {r.text[:400]}")
    msg = r.json()["choices"][0]["message"]
    audio = msg.get("audio") or {}
    data = audio.get("data")
    transcript = (audio.get("transcript") or msg.get("content") or "").strip()
    if not data:
        raise RuntimeError("OpenAI returned no audio data")
    return base64.b64decode(data), transcript


async def respond_to_text(history: list[dict], text: str, first: bool = False) -> str:
    """Text reply (typed messages) using the same model as the web bot."""
    messages = [*_system(first), *history, {"role": "user", "content": text}]
    payload = {"model": OPENAI_TEXT_MODEL, "reasoning_effort": "minimal",
               "max_completion_tokens": 800, "messages": messages}
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(OPENAI_URL, headers=_headers(), json=payload)
    if r.status_code != 200:
        raise RuntimeError(f"OpenAI text {r.status_code}: {r.text[:400]}")
    return (r.json()["choices"][0]["message"].get("content") or "").strip()

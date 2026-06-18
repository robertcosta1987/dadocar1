"""usage.py — turn an OpenAI `usage` object into billable audio SECONDS + USD cost.

OpenAI audio tokenization (Chat Completions audio):
  audio INPUT  = 1 token / 100 ms  → seconds = tokens * 0.10
  audio OUTPUT = 1 token /  50 ms  → seconds = tokens * 0.05

We meter the exact billed tokens the API reports (not estimates), so our counter
matches the invoice. Cost is computed from config unit prices for the margin view.
"""
from config import (PRICE_AUDIO_IN, PRICE_AUDIO_OUT, PRICE_TEXT_IN, PRICE_TEXT_OUT,
                    PRICE_MINI_IN, PRICE_MINI_OUT)

SEC_PER_AUDIO_IN_TOKEN = 0.10
SEC_PER_AUDIO_OUT_TOKEN = 0.05


def _details(d):
    return d if isinstance(d, dict) else {}


def parse(resp_json: dict) -> dict:
    """Pull token counts out of a Chat Completions response's `usage` block."""
    u = (resp_json or {}).get("usage") or {}
    pd = _details(u.get("prompt_tokens_details"))
    cd = _details(u.get("completion_tokens_details"))
    in_audio = int(pd.get("audio_tokens", 0) or 0)
    out_audio = int(cd.get("audio_tokens", 0) or 0)
    # text tokens = total minus audio (prompt/ completion respectively)
    in_text = max(0, int(u.get("prompt_tokens", 0) or 0) - in_audio)
    out_text = max(0, int(u.get("completion_tokens", 0) or 0) - out_audio)
    return {"in_audio_tok": in_audio, "out_audio_tok": out_audio,
            "in_text_tok": in_text, "out_text_tok": out_text}


def audio_seconds(tok: dict) -> tuple[float, float]:
    """(input_seconds, output_seconds) of billed audio for a turn."""
    return (round(tok["in_audio_tok"] * SEC_PER_AUDIO_IN_TOKEN, 3),
            round(tok["out_audio_tok"] * SEC_PER_AUDIO_OUT_TOKEN, 3))


def audio_cost_usd(tok: dict) -> float:
    """USD we pay OpenAI for one gpt-audio turn (audio + text tokens)."""
    c = (tok["in_audio_tok"] * PRICE_AUDIO_IN + tok["out_audio_tok"] * PRICE_AUDIO_OUT
         + tok["in_text_tok"] * PRICE_TEXT_IN + tok["out_text_tok"] * PRICE_TEXT_OUT) / 1_000_000
    return round(c, 6)


def text_cost_usd(tok: dict) -> float:
    """USD we pay OpenAI for one gpt-5-mini text turn."""
    c = (tok["in_text_tok"] * PRICE_MINI_IN + tok["out_text_tok"] * PRICE_MINI_OUT) / 1_000_000
    return round(c, 6)

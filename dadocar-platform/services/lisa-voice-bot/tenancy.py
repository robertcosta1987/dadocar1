"""tenancy.py — the white-label brain: resolve a tenant, hold its plan/persona,
track the billing period, and decide when to throttle.

A tenant == one white-label customer == one WaSender session (one WhatsApp number).
Each WaSender session is configured to POST to /webhook/<tenant_id>, so routing is
explicit and never depends on payload internals. The owner's own Lisa is seeded as
the DEFAULT tenant and also answers the bare /webhook path.
"""
import datetime as _dt
import logging

import store
from config import (DEFAULT_TENANT_ID, DEFAULT_TENANT_NAME, DEFAULT_VOICE_MIN,
                    DEFAULT_TEXT_MSGS, PLAN_VOICE_MIN, PLAN_TEXT_MSGS,
                    WASENDER_API_KEY, WASENDER_WEBHOOK_SECRET, OPENAI_VOICE,
                    SYSTEM_PROMPT, FIRST_TURN_INSTRUCTION,
                    THROTTLE_VOICE_MSG, THROTTLE_TEXT_MSG)

log = logging.getLogger("lisa.tenancy")


def period_now() -> str:
    """Current billing period key (calendar month, UTC)."""
    return _dt.datetime.utcnow().strftime("%Y-%m")


def next_reset_date() -> str:
    """Human PT-BR date the current period rolls over (first of next month)."""
    today = _dt.date.today()
    nxt = (today.replace(day=1) + _dt.timedelta(days=32)).replace(day=1)
    return nxt.strftime("%d/%m/%Y")


def new_tenant(tenant_id: str, name: str, wasender_api_key: str, **kw) -> dict:
    """Build a tenant dict pre-filled with the standard white-label plan."""
    return {
        "tenant_id": tenant_id,
        "name": name,
        "active": kw.get("active", True),
        "wasender_api_key": wasender_api_key,
        "wasender_webhook_secret": kw.get("wasender_webhook_secret", ""),
        "voice_min": int(kw.get("voice_min", PLAN_VOICE_MIN)),
        "text_msgs": int(kw.get("text_msgs", PLAN_TEXT_MSGS)),
        "voice": kw.get("voice", OPENAI_VOICE),
        "system_prompt": kw.get("system_prompt", ""),      # "" → use global SYSTEM_PROMPT
        "first_turn": kw.get("first_turn", ""),            # "" → use global FIRST_TURN_INSTRUCTION
        "throttle_voice_msg": kw.get("throttle_voice_msg", ""),
        "throttle_text_msg": kw.get("throttle_text_msg", ""),
        "openai_api_key": kw.get("openai_api_key", ""),    # "" → use global key
        "support_contact": kw.get("support_contact", ""),
    }


def ensure_default_tenant() -> None:
    """Seed the owner tenant from env on boot if it doesn't exist yet, so the
    existing single-tenant Lisa keeps working on /webhook with unlimited caps."""
    if store.get_tenant(DEFAULT_TENANT_ID):
        return
    if not WASENDER_API_KEY:
        log.warning("default tenant not seeded: WASENDER_API_KEY empty")
        return
    t = new_tenant(DEFAULT_TENANT_ID, DEFAULT_TENANT_NAME, WASENDER_API_KEY,
                   wasender_webhook_secret=WASENDER_WEBHOOK_SECRET or "",
                   voice_min=DEFAULT_VOICE_MIN, text_msgs=DEFAULT_TEXT_MSGS)
    store.upsert_tenant(t)
    log.info("seeded default tenant '%s' (caps voice=%s text=%s)", DEFAULT_TENANT_ID,
             DEFAULT_VOICE_MIN or "∞", DEFAULT_TEXT_MSGS or "∞")


def resolve(tenant_id: str | None) -> dict | None:
    """Look up an ACTIVE tenant. None tenant_id → the default tenant."""
    tid = tenant_id or DEFAULT_TENANT_ID
    t = store.get_tenant(tid)
    if not t or not t.get("active", True):
        return None
    return t


# ── persona accessors (fall back to the global Lisa persona) ─────────────────
def persona(t: dict) -> dict:
    return {
        "system_prompt": t.get("system_prompt") or SYSTEM_PROMPT,
        "first_turn": t.get("first_turn") or FIRST_TURN_INSTRUCTION,
        "voice": t.get("voice") or OPENAI_VOICE,
        "openai_api_key": t.get("openai_api_key") or "",
    }


# ── caps / throttle ──────────────────────────────────────────────────────────
def usage_snapshot(t: dict) -> dict:
    """Current-period usage for a tenant, with caps + remaining, ready for the API."""
    u = store.get_usage(t["tenant_id"], period_now())
    voice_used_sec = float(u.get("voice_in_sec", 0)) + float(u.get("voice_out_sec", 0))
    voice_cap_sec = int(t.get("voice_min", 0)) * 60
    text_cap = int(t.get("text_msgs", 0))
    return {
        "period": period_now(),
        "reset": next_reset_date(),
        "voice_min_cap": int(t.get("voice_min", 0)),
        "voice_min_used": round(voice_used_sec / 60, 2),
        "voice_min_left": (None if voice_cap_sec == 0 else round(max(0, voice_cap_sec - voice_used_sec) / 60, 2)),
        "text_cap": text_cap,
        "text_used": int(u.get("text_count", 0)),
        "text_left": (None if text_cap == 0 else max(0, text_cap - int(u.get("text_count", 0)))),
        "cost_usd": round(float(u.get("cost_usd", 0)), 4),
    }


def voice_blocked(t: dict) -> bool:
    cap_sec = int(t.get("voice_min", 0)) * 60
    if cap_sec == 0:
        return False  # unlimited
    u = store.get_usage(t["tenant_id"], period_now())
    return (float(u.get("voice_in_sec", 0)) + float(u.get("voice_out_sec", 0))) >= cap_sec


def text_blocked(t: dict) -> bool:
    cap = int(t.get("text_msgs", 0))
    if cap == 0:
        return False  # unlimited
    u = store.get_usage(t["tenant_id"], period_now())
    return int(u.get("text_count", 0)) >= cap


def voice_throttle_msg(t: dict) -> str:
    return (t.get("throttle_voice_msg") or THROTTLE_VOICE_MSG).format(reset=next_reset_date())


def text_throttle_msg(t: dict) -> str:
    return (t.get("throttle_text_msg") or THROTTLE_TEXT_MSG).format(reset=next_reset_date())


# ── metering (called after each successful turn) ──────────────────────────────
def record_voice(t: dict, in_sec: float, out_sec: float, cost_usd: float) -> None:
    store.add_usage(t["tenant_id"], period_now(),
                    voice_in_sec=in_sec, voice_out_sec=out_sec, cost_usd=cost_usd)


def record_text(t: dict, cost_usd: float) -> None:
    store.add_usage(t["tenant_id"], period_now(), text_count=1, cost_usd=cost_usd)

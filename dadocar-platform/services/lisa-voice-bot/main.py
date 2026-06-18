"""main.py — FastAPI app for the Lisa WhatsApp voice bot (white-label, multi-tenant).

Loop (per the architecture):
  WaSender -> POST /webhook/<tenant_id>  (messages.received)   [/webhook = default tenant]
  -> resolve tenant (brand, WaSender creds, plan caps, persona)
  -> CHECK the tenant's plan cap BEFORE the paid call; if over → send a short text
     notice and stop (throttle = notice + pause), so the customer never overpays and
     we never eat unmetered cost.
  -> if audio: decrypt-media -> OGG -> ffmpeg mp3 -> gpt-audio -> serve reply mp3 ->
     WaSender send-audio(audioUrl);  if text: gpt-5-mini -> WaSender send-text
  -> METER the exact billed tokens (seconds + USD) into the tenant's usage row.
  The bot mirrors the user's modality: audio in → audio only, text in → text only.
Heavy work runs in a BackgroundTask so the webhook returns 200 immediately
(WaSender won't retry); inbound message ids are de-duplicated.
"""
import hmac
import logging
import time
import uuid
from collections import OrderedDict

from fastapi import BackgroundTasks, FastAPI, Header, Request, Response

import admin
import brain
import history
import tenancy
import usage
import wasender
from audio import to_mp3
from config import PUBLIC_BASE_URL

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("lisa.main")

app = FastAPI(title="Lisa WhatsApp Voice Bot (white-label)")
app.include_router(admin.router)


@app.on_event("startup")
async def _startup():
    tenancy.ensure_default_tenant()


# In-memory media store (id -> (mp3 bytes, ts)) and inbound dedup set.
_media: "OrderedDict[str, tuple[bytes, float]]" = OrderedDict()
_MEDIA_MAX, _MEDIA_TTL = 300, 3600
_seen: "OrderedDict[str, float]" = OrderedDict()
_SEEN_MAX = 2000


def _put_media(data: bytes) -> str:
    fid = uuid.uuid4().hex
    _media[fid] = (data, time.time())
    while len(_media) > _MEDIA_MAX:
        _media.popitem(last=False)
    return fid


def _seen_before(msg_id: str) -> bool:
    now = time.time()
    if msg_id in _seen:
        return True
    _seen[msg_id] = now
    while len(_seen) > _SEEN_MAX:
        _seen.popitem(last=False)
    return False


def _extract(event: dict) -> dict | None:
    """Normalize the WaSender messages.received payload into a small dict."""
    data = event.get("data") or {}
    m = data.get("messages") or data.get("message") or {}
    if isinstance(m, list):
        m = m[0] if m else {}
    key = m.get("key") or {}
    message = m.get("message") or {}
    remote_jid = key.get("remoteJid") or key.get("remoteJID") or ""
    return {
        "id": key.get("id") or "",
        "from_me": bool(key.get("fromMe")),
        "remote_jid": remote_jid,
        "is_group": remote_jid.endswith("@g.us"),
        "audio": message.get("audioMessage"),
        "text": message.get("conversation") or (message.get("extendedTextMessage") or {}).get("text"),
    }


def _mask(jid: str) -> str:
    """Mask a JID/number for logs — keep enough to debug, not the full PII."""
    d = "".join(c for c in (jid or "").split("@")[0] if c.isdigit())
    return (d[:4] + "***" + d[-2:]) if len(d) >= 6 else "***"


async def _handle(event: dict, info: dict, tenant: dict) -> None:
    tid = tenant["tenant_id"]
    key = tenant.get("wasender_api_key", "")
    p = tenancy.persona(tenant)
    # Reply to the FULL original JID (WaSender accepts JIDs). Stripping to digits
    # breaks @lid senders (privacy IDs that aren't phone numbers).
    to = info["remote_jid"]
    first = not history.get(tid, info["remote_jid"])
    log.info("[%s] inbound id=%s audio=%s text=%s first=%s", tid, _mask(to), bool(info["audio"]), bool(info["text"]), first)
    try:
        if info["audio"]:
            # Plan gate BEFORE the paid call — throttle = notice + pause.
            if tenancy.voice_blocked(tenant):
                log.info("[%s] voice cap reached → throttling %s", tid, _mask(to))
                await wasender.send_text(to, tenancy.voice_throttle_msg(tenant), key)
                return
            log.info("[%s] voice note from %s — decrypting", tid, _mask(to))
            url = await wasender.decrypt_media(event, key)
            raw = await wasender.download(url)
            mp3_in = to_mp3(raw)
            log.info("[%s] calling gpt-audio", tid)
            reply_mp3, transcript, resp = await brain.respond_to_audio(
                history.get(tid, info["remote_jid"]), mp3_in, first=first,
                system_prompt=p["system_prompt"], first_turn=p["first_turn"],
                voice=p["voice"], api_key=p["openai_api_key"])
            # Meter the exact billed audio (seconds + USD) into the tenant's usage row.
            tok = usage.parse(resp)
            in_sec, out_sec = usage.audio_seconds(tok)
            tenancy.record_voice(tenant, in_sec, out_sec, usage.audio_cost_usd(tok))
            history.add_user_audio_marker(tid, info["remote_jid"])
            history.add_assistant(tid, info["remote_jid"], transcript)
            fid = _put_media(reply_mp3)
            audio_url = f"{PUBLIC_BASE_URL}/media/{fid}.mp3"
            log.info("[%s] reply audio %.1fs (in %.1fs) -> sending", tid, out_sec, in_sec)
            await wasender.send_audio(to, audio_url, key)
        elif info["text"]:
            if tenancy.text_blocked(tenant):
                log.info("[%s] text cap reached → throttling %s", tid, _mask(to))
                await wasender.send_text(to, tenancy.text_throttle_msg(tenant), key)
                return
            log.info("[%s] text from %s (%d chars)", tid, _mask(to), len(info["text"]))
            reply, resp = await brain.respond_to_text(
                history.get(tid, info["remote_jid"]), info["text"], first=first,
                system_prompt=p["system_prompt"], first_turn=p["first_turn"], api_key=p["openai_api_key"])
            tenancy.record_text(tenant, usage.text_cost_usd(usage.parse(resp)))
            history.add_user_text(tid, info["remote_jid"], info["text"])
            history.add_assistant(tid, info["remote_jid"], reply)
            if reply:
                await wasender.send_text(to, reply, key)
    except Exception as e:  # noqa: BLE001 — never crash the worker; log clearly
        log.exception("[%s] handler failed for %s: %s", tid, _mask(to), e)
        try:
            await wasender.send_text(to, "Desculpa, tive um probleminha pra responder agora. Pode tentar de novo? 🙏", key)
        except Exception:
            pass


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/media/{file_id}")
async def media(file_id: str):
    fid = file_id.removesuffix(".mp3")
    item = _media.get(fid)
    if not item or (time.time() - item[1]) > _MEDIA_TTL:
        return Response(status_code=404)
    return Response(content=item[0], media_type="audio/mpeg")


async def _webhook(tenant_id: str | None, request: Request, bg: BackgroundTasks, signature: str | None) -> dict:
    tenant = tenancy.resolve(tenant_id)
    if not tenant:
        log.warning("webhook for unknown/inactive tenant '%s'", tenant_id)
        return {"ok": True}  # never make WaSender retry

    # Per-tenant shared-secret check (fail closed when that tenant has a secret).
    secret = tenant.get("wasender_webhook_secret") or ""
    if secret:
        if not signature or not hmac.compare_digest(signature, secret):
            return {"ok": True}  # silently drop bad-signature posts
    try:
        event = await request.json()
    except Exception:
        return {"ok": True}
    log.info("[%s] webhook event=%s", tenant["tenant_id"], event.get("event"))

    info = _extract(event)
    if not info or info["from_me"] or info["is_group"] or not info["remote_jid"]:
        return {"ok": True}
    if not info["audio"] and not info["text"]:
        return {"ok": True}
    if info["id"] and _seen_before(info["id"]):
        return {"ok": True}

    bg.add_task(_handle, event, info, tenant)
    return {"ok": True}


@app.post("/webhook")
async def webhook_default(request: Request, bg: BackgroundTasks, x_webhook_signature: str | None = Header(default=None)):
    """Backward-compatible path → the default (owner) tenant."""
    return await _webhook(None, request, bg, x_webhook_signature)


@app.post("/webhook/{tenant_id}")
async def webhook_tenant(tenant_id: str, request: Request, bg: BackgroundTasks, x_webhook_signature: str | None = Header(default=None)):
    """Per-customer webhook — each WaSender session points here with its tenant id."""
    return await _webhook(tenant_id, request, bg, x_webhook_signature)

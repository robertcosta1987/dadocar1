"""main.py — FastAPI app for the Lisa WhatsApp voice bot.

Loop (per the architecture):
  WaSender -> POST /webhook  (messages.received)
  -> if audio: decrypt-media -> download OGG -> ffmpeg to mp3 -> gpt-audio
     -> store reply mp3, serve at GET /media/{id}.mp3 -> WaSender send-audio(audioUrl)
     -> also send the transcript as a text fallback
  -> if text: gpt-5-mini text reply -> WaSender send-text
Heavy work runs in a BackgroundTask so the webhook returns 200 immediately
(WaSender won't retry); inbound message ids are de-duplicated.
"""
import hmac
import logging
import time
import uuid
from collections import OrderedDict

from fastapi import BackgroundTasks, FastAPI, Header, Request, Response

import brain
import history
import wasender
from audio import to_mp3
from config import PUBLIC_BASE_URL, WASENDER_WEBHOOK_SECRET

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("lisa.main")

app = FastAPI(title="Lisa WhatsApp Voice Bot")

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


def _jid_to_to(remote_jid: str) -> str:
    digits = "".join(ch for ch in remote_jid.split("@")[0] if ch.isdigit())
    return f"+{digits}" if digits else remote_jid


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


async def _handle(event: dict, info: dict) -> None:
    to = _jid_to_to(info["remote_jid"])
    try:
        if info["audio"]:
            log.info("voice note from %s — decrypting", to)
            url = await wasender.decrypt_media(event)
            raw = await wasender.download(url)
            log.info("downloaded %d bytes — transcoding", len(raw))
            mp3_in = to_mp3(raw)
            log.info("calling gpt-audio")
            reply_mp3, transcript = await brain.respond_to_audio(history.get(info["remote_jid"]), mp3_in)
            history.add_user_audio_marker(info["remote_jid"])
            history.add_assistant(info["remote_jid"], transcript)
            fid = _put_media(reply_mp3)
            audio_url = f"{PUBLIC_BASE_URL}/media/{fid}.mp3"
            log.info("sending audio reply -> %s", audio_url)
            await wasender.send_audio(to, audio_url)
            if transcript:
                await wasender.send_text(to, transcript)
        elif info["text"]:
            log.info("text from %s: %.60s", to, info["text"])
            reply = await brain.respond_to_text(history.get(info["remote_jid"]), info["text"])
            history.add_user_text(info["remote_jid"], info["text"])
            history.add_assistant(info["remote_jid"], reply)
            if reply:
                await wasender.send_text(to, reply)
    except Exception as e:  # noqa: BLE001 — never crash the worker; log clearly
        log.exception("handler failed for %s: %s", to, e)
        try:
            await wasender.send_text(to, "Desculpa, tive um probleminha pra responder agora. Pode tentar de novo? 🙏")
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


@app.post("/webhook")
async def webhook(request: Request, bg: BackgroundTasks, x_webhook_signature: str | None = Header(default=None)):
    # Verify the shared-secret signature (fail closed when a secret is configured).
    if WASENDER_WEBHOOK_SECRET:
        if not x_webhook_signature or not hmac.compare_digest(x_webhook_signature, WASENDER_WEBHOOK_SECRET):
            return Response(status_code=401)
    else:
        log.warning("WASENDER_WEBHOOK_SECRET not set — webhook signature NOT verified")

    try:
        event = await request.json()
    except Exception:
        return {"ok": True}  # ignore unparseable; never make WaSender retry

    info = _extract(event)
    if not info or info["from_me"] or info["is_group"] or not info["remote_jid"]:
        return {"ok": True}
    if not info["audio"] and not info["text"]:
        return {"ok": True}  # ignore other message types gracefully
    if info["id"] and _seen_before(info["id"]):
        return {"ok": True}

    bg.add_task(_handle, event, info)
    return {"ok": True}

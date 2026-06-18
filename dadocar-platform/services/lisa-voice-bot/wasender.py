"""wasender.py — WasenderAPI client (verified against wasenderapi.com/api-docs).

- decrypt_media(event, api_key) -> public URL of the decrypted media (POST /api/decrypt-media,
  returns {success, publicUrl} valid ~1h).
- download(url) -> bytes.
- send_audio(to, audio_url, api_key) -> POST /api/send-message {to, audioUrl}.
- send_text(to, text, api_key)       -> POST /api/send-message {to, text}.
Auth: Authorization: Bearer <api_key>. Each white-label tenant has its OWN WaSender
session key, so the key is passed per call (falls back to the global env key).
"""
import logging
import httpx
from config import WASENDER_API_BASE, WASENDER_API_KEY

log = logging.getLogger("lisa.wasender")


def _headers(api_key: str | None) -> dict:
    return {"Authorization": f"Bearer {api_key or WASENDER_API_KEY}", "Content-Type": "application/json"}


async def decrypt_media(event: dict, api_key: str = "") -> str:
    """event = the full webhook body ({data:{messages:{key,message:{audioMessage}}}}).
    Returns a temporary public URL to download the decrypted media."""
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(f"{WASENDER_API_BASE}/decrypt-media", headers=_headers(api_key), json=event)
    if r.status_code != 200:
        raise RuntimeError(f"decrypt-media {r.status_code}: {r.text[:300]}")
    j = r.json()
    url = j.get("publicUrl") or j.get("data", {}).get("publicUrl")
    if not url:
        raise RuntimeError(f"decrypt-media returned no publicUrl: {j}")
    return url


async def download(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as c:
        r = await c.get(url)
    r.raise_for_status()
    return r.content


async def _send(body: dict, api_key: str) -> dict:
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(f"{WASENDER_API_BASE}/send-message", headers=_headers(api_key), json=body)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"send-message {r.status_code}: {r.text[:300]}")
    return r.json()


async def send_audio(to: str, audio_url: str, api_key: str = "") -> dict:
    return await _send({"to": to, "audioUrl": audio_url}, api_key)


async def send_text(to: str, text: str, api_key: str = "") -> dict:
    return await _send({"to": to, "text": text}, api_key)

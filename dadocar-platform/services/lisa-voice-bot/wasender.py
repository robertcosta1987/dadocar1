"""wasender.py — WasenderAPI client (verified against wasenderapi.com/api-docs).

- decrypt_media(event) -> public URL of the decrypted media (POST /api/decrypt-media,
  returns {success, publicUrl} valid ~1h).
- download(url) -> bytes.
- send_audio(to, audio_url) -> POST /api/send-message {to, audioUrl}.
- send_text(to, text)      -> POST /api/send-message {to, text}.
Auth: Authorization: Bearer <WASENDER_API_KEY>.
"""
import logging
import httpx
from config import WASENDER_API_BASE, WASENDER_API_KEY

log = logging.getLogger("lisa.wasender")


def _headers() -> dict:
    return {"Authorization": f"Bearer {WASENDER_API_KEY}", "Content-Type": "application/json"}


async def decrypt_media(event: dict) -> str:
    """event = the full webhook body ({data:{messages:{key,message:{audioMessage}}}}).
    Returns a temporary public URL to download the decrypted media."""
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(f"{WASENDER_API_BASE}/decrypt-media", headers=_headers(), json=event)
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


async def _send(body: dict) -> dict:
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(f"{WASENDER_API_BASE}/send-message", headers=_headers(), json=body)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"send-message {r.status_code}: {r.text[:300]}")
    return r.json()


async def send_audio(to: str, audio_url: str) -> dict:
    return await _send({"to": to, "audioUrl": audio_url})


async def send_text(to: str, text: str) -> dict:
    return await _send({"to": to, "text": text})

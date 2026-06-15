# Lisa — WhatsApp voice bot (OpenAI speech‑to‑speech)

Receives WhatsApp **voice notes** and replies **with voice** using OpenAI's
speech‑to‑speech model (`gpt-audio`) as the whole brain — one model call, no
separate STT/LLM/TTS — with **WasenderAPI** as the WhatsApp gateway. Typed text
messages are answered with text (model `gpt-5-mini`). Same Lisa persona and the
same WaSender + OpenAI credentials as the Placas360 web bot.

## Flow
1. `POST /webhook` — WaSender calls this on `messages.received` (signature verified via `X-Webhook-Signature`).
2. Voice note → `POST /api/decrypt-media` → download the decrypted OGG → **ffmpeg** → mp3.
3. `gpt-audio` chat completion (`modalities:["text","audio"]`, `audio:{voice:"coral",format:"mp3"}`, input `input_audio`) → reply **mp3** + **transcript**.
4. Reply mp3 stored and served at `GET /media/{id}.mp3`; sent via WaSender **`send-message {audioUrl}`**; transcript also sent as a text fallback.
5. Per‑contact in‑memory history for context (capped).

## Modules
`main.py` (FastAPI + routes) · `wasender.py` (decrypt/download/send) · `brain.py`
(OpenAI audio + text) · `audio.py` (ffmpeg) · `history.py` · `config.py` (persona + env).

## Run locally
```bash
cp .env.example .env   # fill OPENAI_API_KEY, WASENDER_API_KEY, WASENDER_WEBHOOK_SECRET
pip install -r requirements.txt        # needs ffmpeg installed (brew install ffmpeg)
uvicorn main:app --reload --port 8000
python test_webhook.py                 # posts a sample text event to localhost
```

## Deploy to Render (Docker, ffmpeg included)
1. Render → **New Web Service** → connect this repo → **Root Directory** `services/lisa-voice-bot` → Runtime **Docker** (or use `render.yaml` Blueprint).
2. Set env vars: `OPENAI_API_KEY`, `WASENDER_API_KEY`, `WASENDER_WEBHOOK_SECRET` (the same secret you'll put in WaSender), plus the defaults from `render.yaml`.
3. Deploy. Copy the service URL and set **`PUBLIC_BASE_URL`** to it (e.g. `https://lisa-voice-bot.onrender.com`); redeploy.
4. In the **WaSender dashboard**, point the webhook to `https://<your-service>/webhook` and set the webhook secret to the same `WASENDER_WEBHOOK_SECRET`. (This replaces the previous Next.js text webhook — this service handles both voice and text.)

## Test
Send a **voice note** to the WhatsApp number connected to WaSender → Lisa replies with a voice note + a text transcript. Send a **text** → Lisa replies with text.

> Note: pointing the WaSender webhook here takes over message handling from the
> Next.js bot (it answers text too), so nothing is lost.

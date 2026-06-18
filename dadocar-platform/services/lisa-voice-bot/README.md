# Lisa — WhatsApp voice bot (OpenAI speech‑to‑speech)

> ⚠️ **Legacy / Placas360-feature lineage.** The canonical **white-label platform**
> (multi-tenant, metered plans, `/admin` console) now lives in its own repo at
> `present/LISA/lisa-whitelabel-platform/` and is what deploys to Azure
> (`lisa-voice-bot` container app). Treat Placas360 as **tenant #1** of that
> platform. New work happens there, not here.

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
`main.py` (FastAPI + routes + per-turn cap check & metering) · `wasender.py`
(decrypt/download/send, per-tenant key) · `brain.py` (OpenAI audio + text, returns
`usage`) · `audio.py` (ffmpeg) · `history.py` (per-tenant context) · `config.py`
(persona + env) · `store.py` (Azure Table Storage tenants+usage) · `tenancy.py`
(tenant resolution, plans, throttle) · `usage.py` (tokens→seconds+USD) · `admin.py`
(token-gated control plane + console).

## White-label, multi-tenant + metered plans
Sold as a white-label service: each customer is a **tenant** = one WaSender session
(one WhatsApp number) + a plan (voice minutes + text messages/month) + optional brand
persona/voice. Usage is metered from the OpenAI `usage` block (exact billed tokens →
seconds + USD) and stored per tenant/month in **Azure Table Storage** (separate from
the Placas360 SQL DB, by design). When a tenant exceeds a cap, Lisa sends a short
PT-BR notice and pauses that modality until the next month (**throttle = notice +
pause**) — so the customer never overpays and we never eat unmetered cost. The cap is
checked **before** the paid OpenAI call.

- **Routing:** each WaSender session posts to **`/webhook/<tenant_id>`**. The bare
  `/webhook` maps to the owner (default) tenant, so the existing Lisa keeps working.
- **Plans:** `voice_min` and `text_msgs` per tenant (`0` = unlimited). Voice cap counts
  **billed audio seconds in + out** combined. Period = calendar month (resets the 1st).
- **Admin console:** `GET /admin` (token-gated, `LISA_ADMIN_TOKEN`) to add customers,
  set plans/persona, and watch usage + cost/margin. JSON API under `/admin/tenants`.

### Onboarding a customer
1. Create a WaSender session for the customer's WhatsApp number; copy its **API key**.
2. Open `https://<service>/admin`, paste the admin token, fill `tenant_id`, brand name,
   the WaSender key, and the plan (e.g. 100 min / 500 msgs). Save.
3. In WaSender, set that session's **webhook URL** to `https://<service>/webhook/<tenant_id>`
   (and a per-tenant webhook secret if desired).
4. Done — Lisa answers that number under the customer's plan, brand and voice.

### Cost backstop
Per-tenant caps protect each plan; also set a **hard monthly spend limit on the OpenAI
project key** (Dashboard → Limits) as a global safety net.

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

## Azure setup for the tenant/usage store + secrets
The store is Azure Table Storage. Create (or reuse) a Storage account and wire its
connection string + the admin token as Container App secrets (run in the
`587a98de…` / 3E_Internal subscription, RG `rg-lisa-voice-brs`):

```bash
# 1) Storage account (Tables) — reuse an existing one if you have it
az storage account create -g rg-lisa-voice-brs -n lisavoicestore --sku Standard_LRS -l brazilsouth
CONN=$(az storage account show-connection-string -g rg-lisa-voice-brs -n lisavoicestore --query connectionString -o tsv)

# 2) Container App secrets + env
az containerapp secret set -g rg-lisa-voice-brs -n lisa-voice-bot \
  --secrets lisa-store-conn="$CONN" lisa-admin-token="$(openssl rand -hex 24)"
az containerapp update -g rg-lisa-voice-brs -n lisa-voice-bot \
  --set-env-vars LISA_STORE_CONN=secretref:lisa-store-conn LISA_ADMIN_TOKEN=secretref:lisa-admin-token \
                 LISA_PLAN_VOICE_MIN=100 LISA_PLAN_TEXT_MSGS=500
```

The two tables (`tenants`, `usage`) are auto-created on first run. Without
`LISA_STORE_CONN` the bot falls back to a non-durable in-memory store (dev only).
Print the admin token with `az containerapp secret show -g rg-lisa-voice-brs -n lisa-voice-bot --secret-name lisa-admin-token`.

## Test
Send a **voice note** to the WhatsApp number connected to WaSender → Lisa replies with a voice note + a text transcript. Send a **text** → Lisa replies with text.

For metering/throttle: set a tenant to `voice_min: 1` in `/admin`, send ~2 minutes of
voice notes → Lisa should reply normally, then send the "limite de minutos" notice and
pause voice until the next month, while text still works. Watch `cost_usd` climb per
turn in the admin console.

> Note: pointing the WaSender webhook here takes over message handling from the
> Next.js bot (it answers text too), so nothing is lost.

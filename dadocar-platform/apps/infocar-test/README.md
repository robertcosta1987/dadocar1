# Infocar test app

Local + Vercel-deployable tool to inspect Infocar's vehicle data API end-to-end. **No Azure involvement.**

Two parallel implementations sharing one Infocar client in [`lib/infocar.js`](lib/infocar.js):

- **Local**: Express proxy at `server/proxy.js` serving `web/` at `localhost:3001`.
- **Vercel**: serverless functions under `api/` + static files in `web/` (configured by [`vercel.json`](vercel.json)).

Both paths require a **shared-secret gate** in production. Locally the gate is optional (off by default).

## Prerequisites

- Node 20+
- Either the Vercel CLI **or** a Vercel-connected GitHub repo for deploys.

## Run locally

```bash
cd apps/infocar-test
cp .env.example .env
# Fill in:
#   INFOCAR_ID_KEY / INFOCAR_USERNAME / INFOCAR_PASSWORD  (once activated)
#   DADOCAR_GATE_SECRET (optional locally; required on Vercel)
npm install
npm start
```

Open <http://localhost:3001>.

If `DADOCAR_GATE_SECRET` is unset, the local proxy is open. If set, the frontend will prompt you for the token on load (one prompt per browser session — stored in `sessionStorage`, cleared on tab close).

## Deploy to Vercel

The Vercel project's **Root Directory** must be `apps/infocar-test/` (not the repo root).

Required environment variables (Project Settings → Environment Variables):

| Name | Value | Notes |
|---|---|---|
| `DADOCAR_GATE_SECRET` | any random secret | Generate with `openssl rand -hex 24`. Without this, every API call returns 503 — the deployment refuses to serve open. |
| `INFOCAR_ID_KEY` | from Infocar | Leave blank until Infocar credentials are activated. |
| `INFOCAR_USERNAME` | from Infocar | Same. |
| `INFOCAR_PASSWORD` | from Infocar | Same. |

**Via the CLI:**

```bash
cd apps/infocar-test

# Set env vars (paste secret values when prompted)
echo "<random-secret>" | vercel env add DADOCAR_GATE_SECRET production
echo ""                | vercel env add INFOCAR_ID_KEY production
echo ""                | vercel env add INFOCAR_USERNAME production
echo ""                | vercel env add INFOCAR_PASSWORD production

# Deploy
vercel --prod
```

**Via the Dashboard:**

1. Project → Settings → General → set **Root Directory** to `apps/infocar-test`.
2. Project → Settings → Environment Variables → add the four above (Production scope).
3. Trigger a redeploy.

After the deploy, visit the URL. The gate prompt should appear; paste the secret and the UI behaves identically to the local version.

## State: credentials not yet activated

While `INFOCAR_*` env vars are empty:

- `/api/*` returns `HTTP 503 credentials_missing`.
- The frontend renders a friendly warning card.
- Everything else (gate prompt, tab switching, plate validation, theme toggle) still works.

Once credentials are filled in, **redeploy** (Vercel) or restart the proxy (local) — no code changes needed.

## Endpoints

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/healthz` | `{ ok, credentials_set, gate_enforced }`. Gated. |
| GET | `/api/vehicle/plate/:plate` | Proxies to Infocar's `CodificacaoFipe/placa/{plate}`. |
| GET | `/api/vehicle/chassi/:chassi` | Proxies to Infocar's `CodificacaoFipe/chassi/{chassi}`. |

Every API call requires `Authorization: Bearer <DADOCAR_GATE_SECRET>` when the gate is enforced. The frontend supplies it automatically once the user has entered it.

Both vehicle endpoints set an `x-upstream-latency-ms` response header. The token is cached in-memory (per-process for the local proxy; per-warm-invocation for each Vercel function instance).

## What the proxy does

- Caches the Infocar bearer token in-memory for ~7h45m (Infocar tokens are valid 8h; refreshed early).
- Forwards Infocar's response **verbatim** — no field stripping, no normalization. The point is to inspect raw vendor output.
- Logs each upstream call: timestamp, route, masked plate/VIN, status, latency.

## Frontend

Plain HTML + CSS + JS. No build step.

- Toggle plate / chassi mode.
- Input is uppercased and validated (`ABC1234` / `ABC1D23` for plates; 17-char VIN with no I/O/Q).
- Submit is disabled until input is valid.
- Response renders in three sections: `Dados do Veículo` grid, `Preços FIPE` cards (BRL-formatted), `JSON Bruto` (collapsible, syntax-highlighted, copy button).
- Theme toggle in the top-right; system preference is the default.
- Gate prompt appears on load if no secret is stored in `sessionStorage`. A 401 from any API call clears the stored secret and re-prompts.

## What to try (once credentials are active)

- Plate: `EFS8F45`
- Chassi (VIN): `9BWKB05W89P075362`

Both are documented in the Infocar integration manual as guaranteed to return data with test credentials.

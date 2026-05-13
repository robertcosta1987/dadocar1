# Infocar test app

Thin Vercel + local-dev front-end that talks to the **Dadocar aggregator** Function App in Azure. No vendor credentials live here anymore — the Function App holds them in Key Vault and runs all providers (today: Infocar / FIPE; tomorrow: whatever you register next under `services/enrichment-function/src/providers/`).

```
Browser  →  Vercel proxy  →  Azure Function App  →  vendor(s)  →  Function App  →  Vercel  →  Browser
         (gate secret)     (function key)           (Infocar etc.)
```

Two parallel implementations sharing one tiny client in [`lib/aggregator.js`](lib/aggregator.js):

- **Local**: Express proxy at `server/proxy.js` serving `web/` at `localhost:3001`.
- **Vercel**: serverless functions under `api/` + static files in `web/` (configured by [`vercel.json`](vercel.json)).

Both paths require a **shared-secret gate** in production. Locally the gate is optional (off by default).

## Prerequisites

- Node 20+
- The Azure Function App URL + a function key. Today the dev environment is at:
  - URL: `https://dadocar-dev-func-enrich-brs.azurewebsites.net`
  - Key: `az functionapp keys list -g rg-dadocar-dev-brs -n dadocar-dev-func-enrich-brs --query functionKeys.default -o tsv`

## Run locally

```bash
cd apps/infocar-test
cp .env.example .env
# Fill in:
#   AZURE_FUNCTION_URL   (the dev Function App URL)
#   AZURE_FUNCTION_KEY   (the default function key from the command above)
#   DADOCAR_GATE_SECRET  (optional locally; required on Vercel)
npm install
npm start
```

Open <http://localhost:3001>.

If `DADOCAR_GATE_SECRET` is unset, the local proxy is open. If set, the frontend will prompt for the token on load (stored in `sessionStorage`, cleared on tab close).

## Deploy to Vercel

The Vercel project's **Root Directory** is `dadocar-platform/apps/infocar-test`.

Required environment variables (Project Settings → Environment Variables, Production scope):

| Name | Value | Notes |
|---|---|---|
| `AZURE_FUNCTION_URL` | the Function App URL | one-time |
| `AZURE_FUNCTION_KEY` | a function-app function key | rotate when desired |
| `DADOCAR_GATE_SECRET` | any random secret | `openssl rand -hex 24` |

After setting them, redeploy. The Vercel functions never hold Infocar credentials — those live in Azure Key Vault only.

## State: aggregator not yet configured

If `AZURE_FUNCTION_URL` / `AZURE_FUNCTION_KEY` are unset:

- `/api/*` returns `HTTP 503 aggregator_unconfigured`.
- The frontend renders a warning card pointing back to this README.
- The gate prompt still works; the rest of the UI still loads.

## Endpoints (Vercel + local proxy)

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/healthz` | Local; `{ ok, aggregator_configured }`. Gated. |
| GET | `/api/providers` | Proxies to the Function App `/api/providers`. Gated. |
| GET | `/api/vehicle/plate/:plate` | Proxies to `/api/vehicle/plate/{plate}`. Gated + plate-validated. |
| GET | `/api/vehicle/chassi/:chassi` | Proxies to `/api/vehicle/chassi/{chassi}`. Gated + VIN-validated. |

Optional query string `?sources=infocar,denatran,…` is forwarded to the aggregator — limits which providers run.

Every API call requires `Authorization: Bearer <DADOCAR_GATE_SECRET>` when the gate is enforced. The frontend supplies it automatically once the user has entered the token.

The aggregator response shape:

```json
{
  "query":             { "kind": "plate", "value": "EFS8F45" },
  "generated_at":      "…",
  "ran_providers":     ["infocar"],
  "skipped_providers": [],
  "unknown_sources":   [],
  "sources": [
    {
      "id":               "infocar",
      "display_name":     "Infocar · Codificação FIPE",
      "ok":               true,
      "upstream_status":  200,
      "latency_ms":       412,
      "data":             { "dados": { "dadosDoVeiculo": { … }, "fipes": [ … ] } }
    }
  ]
}
```

The frontend renders the first OK source's data into the existing `Dados do Veículo` + `Preços FIPE` cards and lists every source's status (id, ok/fail, latency) in the meta band. Adding a vendor in the Function App will surface here automatically.

## Frontend

Plain HTML + CSS + JS. No build step.

- Toggle plate / chassi mode.
- Input is uppercased and validated (`ABC1234` / `ABC1D23` for plates; 17-char VIN with no I/O/Q).
- Submit is disabled until input is valid.
- Response renders in three sections: `Dados do Veículo` grid, `Preços FIPE` cards (BRL-formatted), `JSON Bruto` (collapsible, syntax-highlighted, copy button).
- Theme toggle in the top-right; system preference is the default.
- Gate prompt appears on load if no secret is stored in `sessionStorage`. A 401 from any API call clears the stored secret and re-prompts.

## What to try

- Plate: `EFS8F45` (the test plate documented in the Infocar manual)
- Chassi (VIN): `9BWKB05W89P075362`

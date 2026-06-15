# pricing-function-checktudo

Azure Function App: **CheckTudo vehicle-data integration**. Looks up a Brazilian
plate (or chassi) against the [CheckTudo](https://api.checktudo.com.br)
**synchronous** query API (`POST /api/vehicle/{userId}`) for a **selectable
product** (querycode) and returns the result JSON inline — markedly faster than
the old async order→poll flow.

This is a **separate, independent** Function App from the KBB/Molicar
`pricing-function` — same resource group, mirrored structure, but its own app,
its own content share, and its own Key Vault secrets. Neither depends on the
other.

## Layout

```
services/pricing-function-checktudo
├── package.json                    # @azure/functions v4, identity, keyvault-secrets
├── host.json                       # Functions host config; routePrefix=api
├── local.settings.json.example     # copy → local.settings.json (KEYVAULT_URL preset; port 7073)
└── src/
    ├── functions/
    │   └── checktudoLookup.js      # HTTP triggers (plate/vin/products/health)
    ├── lib/
    │   ├── secrets.js              # Key Vault reader, 5-min in-memory cache
    │   └── validation.js           # plate / VIN / CPF regex + normalisers
    └── providers/
        └── checktudo.js            # login → sync vehicle query, product catalog
```

## HTTP surface

| Method | Path                                          | Auth      | Description                                                            |
| ------ | --------------------------------------------- | --------- | --------------------------------------------------------------------- |
| GET    | `/api/checktudo/plate/{plate}?product=<code>` | function  | Synchronous lookup by plate. `product` = querycode (default 66). |
| GET    | `/api/checktudo/vin/{vin}?product=<code>`     | function  | Same, keyed by chassi (VIN).                                          |
| GET    | `/api/products`                               | function  | Selectable querycodes + display names + default.                     |
| GET    | `/api/health`                                 | anonymous | Liveness. Leaks nothing about credentials.                           |

Success envelope:

```json
{
  "ok": true,
  "product": { "code": 66, "name": "Veículo Total" },
  "queryId": "…",
  "refClass": "…",
  "data": { "…": "the product's responseJSON" },
  "latency_ms": 4213,
  "cached_upstream": false,
  "poll_attempts": 3
}
```

Failure envelope (HTTP 200 — caller inspects `ok`; input-validation errors are
HTTP 400):

```json
{ "ok": false, "product": { "code": 66, "name": "Veículo Total" },
  "error": "poll_timeout", "message": "…", "upstream_status": 504, "latency_ms": 28010 }
```

## Selectable products (querycode → name)

| code | product                          |
| ---- | -------------------------------- |
| 66   | Veículo Total (default)          |
| 67   | Veículo Essencial                |
| 13   | Decodificador e Precificador     |
| 71   | Dados Cadastrais do Veículo      |
| 76   | Decodificador + Histórico FIPE   |
| 241  | Decodificador V.4                |

The full CheckTudo catalog has ~70 codes (vehicle + person). Only the vehicle
decoder family is exposed here. Add to `PRODUCTS` in `providers/checktudo.js` to
expose more.

## CheckTudo API flow (verified live)

1. `POST /auth/login { username, password }` → `body.token` (JWT, ~24h) and
   `body.user._id` (the integration account id). The token is the `Authorization`
   header value for every query call (raw, no `Bearer ` prefix).
2. `POST /api/vehicle/{userId}` `{ querycode, keys: { placa | chassi } }`
   → `{ status: { cod }, body: { headerInfos: { queryid, isAsyncQuery },
   data, billing, error } }`. **Synchronous** — the result is returned inline.
   - `cod 200` → full data inline (first query for a plate+product).
   - `cod 206` → the vendor deduped a recently-run plate+product (anti re-bill)
     and returns **no inline data**, but the `headerInfos.queryid` lets us
     recover the canonical result via
     `GET /api/query/json-response/{queryId}` — not billed.
3. Async fallback: if a product is ever flagged `isAsyncQuery` with no inline
   data, we poll `GET /api/query/json-response/{queryId}` until it lands.

All requests carry browser-like headers (User-Agent + Origin + Referer) because
CheckTudo sits behind Cloudflare, which can `1010`-block non-browser signatures.

## Secrets (Key Vault)

| Secret name           | Value                                |
| --------------------- | ------------------------------------ |
| `checktudo-username`  | CheckTudo login e-mail               |
| `checktudo-password`  | CheckTudo login password             |

Read via `DefaultAzureCredential` → the Function App's Managed Identity in
Azure, or the developer's `az login` session locally.

## Local development

```bash
cp local.settings.json.example local.settings.json   # KEYVAULT_URL preset
npm install
npm start                       # port 7073 (avoids enrichment/pricing on 7072)
```

Smoke tests:

```bash
curl http://localhost:7073/api/health
curl 'http://localhost:7073/api/products?code=<function-key>'
curl 'http://localhost:7073/api/checktudo/plate/ABC1D23?product=66&code=<function-key>'
```

## Deploy

Provisioned separately from the rest of the stack (the existing pricing app was
created ad-hoc). See `infrastructure/scripts/provision-checktudo-func.sh` and
`infrastructure/bicep/modules/functions-checktudo.bicep`. After the app exists:

```bash
func azure functionapp publish dadocar-dev-func-checktudo-brs
```

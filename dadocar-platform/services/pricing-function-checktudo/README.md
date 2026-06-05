# pricing-function-checktudo

Azure Function App: **CheckTudo vehicle-data integration**. Looks up a Brazilian
plate (or chassi) against the [CheckTudo](https://api.checktudo.com.br) async
query API for a **selectable product** (querycode) and returns the result JSON.

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
        └── checktudo.js            # login → order → poll, product catalog
```

## HTTP surface

| Method | Path                                          | Auth      | Description                                                            |
| ------ | --------------------------------------------- | --------- | --------------------------------------------------------------------- |
| GET    | `/api/checktudo/plate/{plate}?product=<code>` | function  | Async order→poll lookup by plate. `product` = querycode (default 66). |
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

1. `POST /auth/login { username, password }` → `body.token` (JWT, ~24h). This
   token is the `Authorization` header value for every `/api/query/*` call
   (raw, no `Bearer ` prefix).
2. `POST /api/query/order` `{ querycode, keys: { placa | chassi }, duplicity:false }`
   → `body { orderId, queryId, status:"enqueued" }`.
3. `GET /api/query/json-response/:queryId` → `body { refClass, responseJSON }`
   once complete; polled until ready or a 28s budget expires.

`duplicity:false` reuses a recently-run document to avoid re-billing.

> The printed manual's `generate-api-key` step belongs to the **synchronous**
> `/api/vehicle/:userid` path and is **not** used here. Proven: the order
> endpoint returns `410 Consulta inválida` (auth OK) with the login token and
> `401 Token de navegação inválido` with the apiKey.

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

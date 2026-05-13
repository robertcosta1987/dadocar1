# Enrichment Function

Azure Function App that fronts every vehicle-data provider behind one entry point. Customer queries a plate → the function fans out to all ready providers in parallel → response is a single JSON with each vendor's payload namespaced under `sources[]`.

Today there's one provider: **Infocar (Codificação FIPE)**. The abstraction is built so adding the next vendor is one new file + one line in the registry — no changes to the HTTP triggers, no new env vars beyond the secret names in Key Vault.

## What's where

```
services/enrichment-function/
├── host.json                       # Functions host config (route prefix, AI sampling)
├── package.json                    # @azure/functions v4, identity, keyvault-secrets
├── local.settings.json.example     # local-dev settings template
├── .funcignore                     # excluded from `func azure functionapp publish`
└── src/
    ├── functions/
    │   └── vehicleLookup.js        # 4 HTTP routes
    ├── providers/
    │   ├── _types.js               # contract every provider implements (JSDoc)
    │   ├── index.js                # registry — add new providers here
    │   └── infocar.js              # FIPE provider
    └── lib/
        ├── secrets.js              # Key Vault reader, 5-min in-memory cache
        └── validation.js           # plate + VIN regex
```

## Routes

All under the configured prefix `api/` (see `host.json`).

| Method | Path                         | Auth        | Purpose |
|---|---|---|---|
| GET    | `/api/healthz`               | anonymous   | Liveness probe for APIM. |
| GET    | `/api/providers`             | function    | Lists every registered provider and whether its credentials are present in Key Vault. |
| GET    | `/api/vehicle/plate/{plate}` | function    | Looks up a plate via every ready provider in parallel. |
| GET    | `/api/vehicle/chassi/{chassi}` | function  | Same, by VIN. |

Both lookup routes accept `?sources=id1,id2,...` to subset providers. Unknown ids are silently dropped (reported back under `unknown_sources`). Empty/missing = all ready providers run.

### Response shape

```json
{
  "query":             { "kind": "plate", "value": "EFS8F45" },
  "generated_at":      "2026-05-13T10:11:12.345Z",
  "ran_providers":     ["infocar"],
  "skipped_providers": [],
  "unknown_sources":   [],
  "sources": [
    {
      "id":               "infocar",
      "display_name":     "Infocar · Codificação FIPE",
      "ok":               true,
      "error":            null,
      "message":          null,
      "upstream_status":  200,
      "latency_ms":       412,
      "data":             { "dados": { "dadosDoVeiculo": { ... }, "fipes": [ ... ] } }
    }
  ]
}
```

Adding a new provider only adds another item under `sources[]`. Existing consumers keep working.

## Add a new provider

1. **Seed its credentials in Key Vault.** Pick stable secret names (e.g. `denatran-api-key`).
2. **Write `src/providers/<id>.js`** mirroring `infocar.js`:
   - Reads its secrets via `getSecrets([...])` from `../lib/secrets`.
   - Exports `{ id, displayName, isReady, lookupByPlate, lookupByVin }`.
   - Returns the `ProviderResponse` shape documented in `_types.js`.
3. **Register it in `src/providers/index.js`**:
   ```js
   const denatran = require("./denatran");
   const PROVIDERS = [infocar, denatran];
   ```
4. **Document the secret names** in this README under "Configured providers".

No HTTP-trigger changes. The aggregator picks up the new source automatically and customers see one more entry under `sources[]`.

## Configured providers

| id | Display name | Required Key Vault secrets |
|---|---|---|
| `infocar` | Infocar · Codificação FIPE | `infocar-id-key`, `infocar-username`, `infocar-password` |

## Required Function App settings

These need to be set on the Function App (Bicep already provisions the App with MI + KV permissions; the URL itself isn't yet baked into the template):

| Setting          | Value                                                      | Notes |
|---|---|---|
| `KEYVAULT_URL`   | `https://dadocardevkvbrso3uo.vault.azure.net/`             | One-time set via `az functionapp config appsettings set`. |
| `FUNCTIONS_WORKER_RUNTIME` | `node`                                           | Set by Bicep. |
| `FUNCTIONS_EXTENSION_VERSION` | `~4`                                          | Set by Bicep. |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | `<from monitoring module>`          | Set by Bicep. |
| `AzureWebJobsStorage` | `<from storage module>`                               | Set by Bicep. |

Apply the missing one:

```bash
az functionapp config appsettings set \
  -g rg-dadocar-dev-brs \
  -n dadocar-dev-func-enrich-brs \
  --settings KEYVAULT_URL=https://dadocardevkvbrso3uo.vault.azure.net/
```

## Local dev

Requires the [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) and `az login` against the Dadocar dev subscription (so `DefaultAzureCredential` can fall through to your developer token for Key Vault reads).

```bash
cd services/enrichment-function
cp local.settings.json.example local.settings.json
npm install
func start                       # listens on http://localhost:7071
```

Then:

```bash
# liveness
curl -sS http://localhost:7071/api/healthz | jq

# provider readiness (replace <FUNC_KEY> with the function key; locally
# any value passes when running on `func start`, but production deploys
# require the real key)
curl -sS -H "x-functions-key: <FUNC_KEY>" \
  http://localhost:7071/api/providers | jq

# lookup a plate
curl -sS -H "x-functions-key: <FUNC_KEY>" \
  http://localhost:7071/api/vehicle/plate/EFS8F45 | jq
```

## Deploy

```bash
cd services/enrichment-function
npm install                      # produces node_modules/ that gets uploaded
func azure functionapp publish dadocar-dev-func-enrich-brs --javascript
```

The publish step uploads `src/`, `host.json`, `package.json`, and the built `node_modules/`. Items in `.funcignore` are excluded.

After the first deploy, get the function key:

```bash
az functionapp keys list -g rg-dadocar-dev-brs -n dadocar-dev-func-enrich-brs \
  --query "functionKeys.default" -o tsv
```

Pass that as `x-functions-key` (or `?code=...`) on every call to a `function`-auth route.

## What's intentionally out of scope (for now)

- **Cosmos write** of every lookup into the `vehicles` cache container. Will land when we want cache-hit fast-paths.
- **Event Hub publish** to `query-events`. Will land when downstream analytics consumers exist.
- **Cross-instance token cache** in the `secrets` Cosmos container. Today each Function instance keeps its own Infocar bearer token in memory — wasteful at scale but correct.
- **APIM integration**. The function is callable directly via function key; APIM products / subscription keys / rate limits land in a later phase.

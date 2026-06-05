# pricing-function

Azure Function App: **vehicle pricing aggregator**. Looks up a Brazilian plate
against any number of registered pricing providers and returns a unified JSON
broken down by sale channel (NewVehicle, UsedDealer, SellPrivateParty,
SellDealer, FPP).

Today there's one provider: **Molicar (KBB Pricing + Decoder)**. The
abstraction follows the same provider-registry pattern as
`services/enrichment-function` so adding the next vendor is one new file +
one line in the registry — no changes to the HTTP triggers, no new env vars
beyond the secret names in Key Vault.

## Layout

```
services/pricing-function
├── package.json                    # @azure/functions v4, identity, keyvault-secrets
├── host.json                       # Functions host config; routePrefix=api
├── .funcignore                     # excludes README, local.settings.json, etc. from publish
├── .gitignore                      # never commit local.settings.json
├── local.settings.json.example     # copy → local.settings.json and fill KEYVAULT_URL
└── src/
    ├── functions/
    │   └── pricingLookup.js        # HTTP triggers: /pricing/plate/{plate}, /providers, /health
    ├── lib/
    │   ├── secrets.js              # Key Vault reader, 5-min in-memory cache
    │   └── validation.js           # plate/VIN regex + normalisers
    └── providers/
        ├── _types.js               # JSDoc contract every provider satisfies
        ├── index.js                # registry — `require("./<id>")`, push, done
        └── molicar.js              # Molicar token + plate API
```

## HTTP surface

| Method | Path                              | Auth        | Description                                                                              |
| ------ | --------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| GET    | `/api/pricing/plate/{plate}`      | function    | Fans out to every ready pricing provider keyed by plate. Returns the unified `sources[]` shape. |
| GET    | `/api/pricing/vin/{vin}`          | function    | Same flow, keyed by VIN. Both modes documented in PricingAPI v3.0.6 §3.                  |
| GET    | `/api/providers`                  | function    | Lists every registered provider and whether its credentials are present in Key Vault.    |
| GET    | `/api/health`                     | anonymous   | Liveness only; deliberately leaks nothing about credential state.                        |

Query-string options on the lookup route:

| Param          | Effect                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------- |
| `sources=a,b`  | Comma-separated subset of provider ids. Default = "all ready providers".                            |

The response shape is:

```jsonc
{
  "sources": [
    {
      "id": "molicar",
      "ok": true,
      "upstream_status": 200,
      "latency_ms": 412,
      "data": { /* the vendor's raw JSON, see "Molicar response shape" below */ }
    }
  ],
  "ran_providers": ["molicar"],
  "skipped_providers": []                // entries with reason: "missing_credentials" or "unknown_provider"
}
```

## Adding a new pricing provider

1. **Seed its credentials in Key Vault.** Pick stable secret names (e.g.
   `xpprecos-api-key`).
2. **Create `src/providers/<id>.js`** following the `_types.js` contract.
   Reads its secrets via `getSecrets([...])` from `../lib/secrets`.
3. **Register it** by adding `require("./<id>")` to the `PROVIDERS` array in
   `src/providers/index.js`. That's the whole wiring.
4. **Document the secret names** in this README under "Configured providers".
   When a provider's credentials are missing, the HTTP trigger silently
   skips it and reports it under `skipped_providers`; ready providers are
   unaffected.

## Configured providers

| id        | Display name                  | Required Key Vault secrets                          |
| --------- | ----------------------------- | --------------------------------------------------- |
| `molicar` | Molicar · KBB Pricing         | `molicar-client-id`, `molicar-client-secret`        |

## Molicar response shape

The vendor returns a single JSON object with four top-level groups. We
forward it verbatim under `sources[].data`:

```jsonc
{
  "Decoder":     { "Plate", "Vin", "ModelYear", "Status", "MolicarId" },
  "VehicleData": { "Brand", "Model", "Version", "ManufacturedYear", "FuelType", "Transmission", /* … */ },
  "Pricing":     { "MolicarPrice" },
  "KBBPricing":  {
    "UF", "Grade", "MY", "Mileage", "Color",
    "NewVehicle":       { "Min", "Max", "FairPrice" },
    "UsedDealer":       { "Min", "Max", "FairPrice" },
    "SellPrivateParty": { "Min", "Max", "FairPrice" },
    "SellDealer":       { "Min", "Max", "FairPrice" },
    "FPP":              { "Min", "Max", "FairPrice" }
  }
}
```

Glossary of the KBB sale categories (so the UI can render labelled
sections):

| Category           | Meaning                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| `NewVehicle`       | Reference price for the same model when new (zero-km).                   |
| `UsedDealer`       | Retail price at a dealership for the used unit.                          |
| `SellPrivateParty` | Asking price between private parties (no dealer).                        |
| `SellDealer`       | Trade-in price paid by a dealer when buying the used unit.               |
| `FPP`              | Floor Price Point — dealer's wholesale/lowest acceptable offer.          |

## Local development

Requires the [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local)
and `az login` against the Dadocar dev subscription (so `DefaultAzureCredential`
can fall through to your developer token for Key Vault reads).

```bash
cp local.settings.json.example local.settings.json
# edit nothing — KEYVAULT_URL is already the dev vault
npm install
npm start                      # uses port 7072 to avoid clashing with enrichment-function
```

Smoke tests:

```bash
# liveness
curl http://localhost:7072/api/health

# registered providers
curl 'http://localhost:7072/api/providers?code=<function-key>'

# real lookup (plate)
curl 'http://localhost:7072/api/pricing/plate/FCC3G90?code=<function-key>'

# real lookup (VIN)
curl 'http://localhost:7072/api/pricing/vin/9BWZZZ377VT004251?code=<function-key>'
```

## Vendor HTTP code mapping

Per PricingAPI v3.0.6 §6 the Molicar upstream can return:

| Upstream | Surface in `sources[i]`                    | Suggested caller behaviour                |
| -------- | ------------------------------------------ | ----------------------------------------- |
| 200      | `ok: true, data: { ... }`                  | render                                    |
| 302      | followed transparently by `fetch`          | n/a                                       |
| 400      | function returns 400 with `invalid_plate`  | input validation upstream of fetch        |
| 401      | `ok: false, error: "upstream_401"`         | rotate `molicar-client-secret` in KV      |
| 403      | `ok: false, error: "upstream_403"`         | confirm tenant plan covers the route      |
| 404      | `ok: false, error: "upstream_404"`         | UI: "placa não encontrada"                |
| 429      | `ok: false, error: "upstream_429"`         | back off; APIM should throttle pre-hop    |
| 502      | `ok: false, error: "upstream_502"`         | retry once, then surface to operator      |

## Production notes

- **Cross-instance token cache.** Each Function instance keeps its own
  Molicar bearer token in memory. Wasteful at scale but correct. A shared
  cache via Cosmos `secrets` container is a future enhancement (the
  enrichment-function has the same trade-off).
- **Rate limiting.** No client-side rate limit; APIM is expected to throttle
  per-subscription.
- **Logging.** The plate value is logged with the last 4 characters masked
  (`q=ABC***`) — same convention as enrichment-function.
- **Failure isolation.** If Molicar errors, the trigger still returns 200
  with `sources[0].ok = false`. Callers MUST inspect `ok` per source.

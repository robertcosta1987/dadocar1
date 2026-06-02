# Dadocar — Architecture, Flows & Future Integrations

Project: **Dadocar** — a vehicle‑data API platform that resells Infocar's FIPE pricing API with a caching, billing and analytics layer on top.

At MVP the repo is split into **two independent halves**:

1. **`apps/infocar-test/`** — a *live* tool (local Express + Vercel serverless) that talks to Infocar end‑to‑end, with no Azure involvement. This is what currently produces real requests/responses.
2. **`infrastructure/`** — the **DEV** Azure environment, provisioned by Bicep but **deployed empty** (no application code yet). `services/*` are `.gitkeep` placeholders.

All diagrams below are Mermaid; they render natively on GitHub and in most Markdown viewers.

---

## 1. High‑level architecture (current state)

```mermaid
graph TB
  subgraph LIVE["LIVE — apps/infocar-test  (Vercel and/or local)"]
    User((User browser))
    FE["Frontend<br/>web/index.html + app.js<br/>vanilla DOM, no build"]
    SS[("sessionStorage<br/>dadocar:gate-secret")]
    Local["Local proxy<br/>server/proxy.js (Express)<br/>:3001"]
    Vercel["Vercel functions<br/>api/healthz.js<br/>api/vehicle/plate/[plate].js<br/>api/vehicle/chassi/[chassi].js"]
    Gate["_gate.js / gateCheck<br/>Authorization: Bearer<br/>timingSafeEqual"]
    Lib["lib/infocar.js<br/>token cache + validators<br/>PLATE_RE / VIN_RE"]
    Infocar[("Infocar API<br/>api.datacast3.com<br/>POST /api/Token/GerarToken<br/>GET /api/v1.0/CodificacaoFipe/...")]

    User -->|HTTP| FE
    FE <-->|read/write| SS
    FE -->|Authorization: Bearer secret| Local
    FE -->|Authorization: Bearer secret| Vercel
    Local --> Gate
    Vercel --> Gate
    Gate --> Lib
    Lib -->|POST GerarToken<br/>GET CodificacaoFipe| Infocar
  end

  subgraph AZURE["AZURE DEV — rg-dadocar-dev-brs  (provisioned empty)"]
    APIM["APIM Consumption<br/>dadocar-dev-apim-brs<br/>(no products / APIs / policies)"]
    FUNC["Function App (Linux, Node 20)<br/>dadocar-dev-func-enrich-brs<br/>SystemAssigned MI<br/>(no code deployed)"]
    KV[("Key Vault RBAC<br/>dadocardevkvbrs****<br/>secrets: NOT seeded")]
    COS[("Cosmos NoSQL<br/>db: dadocar (400 RU/s shared)<br/>containers:<br/>vehicles /placa · 30d TTL<br/>fipe_prices /codigoFipe<br/>vehicle_index /lookup_key · 30d<br/>customers /customer_id<br/>secrets /secret_name")]
    STG[("Storage HNS (Data Lake Gen2)<br/>dadocardevstbrs****<br/>query-log · token-lock · function-host")]
    EH[("Event Hub Basic 1 TU<br/>dadocar-dev-evhns-brs<br/>hub: query-events · 1 part · 24h")]
    MON["App Insights<br/>+ Log Analytics"]

    FUNC -. KV Secrets User .- KV
    FUNC -. Cosmos Data Contributor .- COS
    FUNC -. Blob Data Contributor .- STG
    FUNC -. EventHubs Data Sender .- EH
    FUNC -. AI conn string .- MON
    APIM -. future .- FUNC
  end

  classDef stub stroke-dasharray:4 4,opacity:0.85;
  class APIM,FUNC,KV,COS,STG,EH,MON stub;
```

Legend: dashed boxes inside the Azure subgraph indicate resources that are provisioned but contain **no application code or data** yet — that's the MVP scope as called out in `README.md` § "MVP scope" and `docs/dev-setup.md` § 10.

---

## 2. Request flow — current MVP (plate / chassi lookup)

Both the local Express proxy (`server/proxy.js`) and the Vercel function (`api/vehicle/plate/[plate].js`) execute the *same logic*, sharing `lib/infocar.js`.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant FE as Frontend (app.js)
  participant SS as sessionStorage
  participant PRX as Proxy<br/>(Express OR Vercel fn)
  participant LIB as lib/infocar.js
  participant TC as in-memory<br/>token cache
  participant INF as Infocar API

  U->>FE: open page
  FE->>SS: get "dadocar:gate-secret"
  alt secret missing
    FE-->>U: show #gateCard
    U->>FE: paste shared secret
    FE->>SS: store secret
  end
  U->>FE: enter plate / VIN
  FE->>FE: regex validate (PLATE_OLD ∣ PLATE_MERCO ∣ VIN_RE)
  FE->>PRX: GET /api/vehicle/plate/:plate<br/>Authorization: Bearer <secret>
  PRX->>PRX: enforceGate() — timingSafeEqual
  alt gate fail
    PRX-->>FE: 401 unauthorized
    FE->>SS: clearGateSecret()
    FE-->>U: re-show gate ("Token inválido")
  end
  PRX->>PRX: credentialsAreSet()?
  alt creds missing
    PRX-->>FE: 503 credentials_missing
    FE-->>U: warning card
  end
  PRX->>PRX: server-side re-validate regex
  PRX->>LIB: infocarGet("/api/v1.0/CodificacaoFipe/placa/" + plate)
  LIB->>TC: token cached & not within 15min of expiry?
  alt cache miss
    LIB->>INF: POST /api/Token/GerarToken<br/>{chave: base64(user:pass)}<br/>infocar-id-Key header
    INF-->>LIB: { token }
    LIB->>TC: store token, expiresAt = now + 8h
  end
  LIB->>INF: GET /api/v1.0/CodificacaoFipe/placa/:plate<br/>Authorization: Bearer <infocar-token><br/>infocar-id-Key header
  INF-->>LIB: vehicle JSON  (or 4xx/5xx)
  LIB-->>PRX: { status, latencyMs, contentType, body }
  PRX->>PRX: console.log(timestamp, route, masked tail, status, latency)
  PRX-->>FE: forward Infocar response **verbatim**<br/>+ header x-upstream-latency-ms
  FE->>FE: parse body.dados.dadosDoVeiculo<br/>render BRL FIPE cards<br/>show JSON Bruto (collapsible)
  FE-->>U: result UI
```

Key implementation details worth keeping in mind when reading the sequence:

- **Verbatim forwarding.** `infocarGet()` returns the raw body string and the proxy does `res.status(out.status).type(out.contentType).send(out.body)` — *no field stripping*. That's the explicit point of the test app.
- **Token cache is per-process / per-warm-invocation.** Cold Vercel starts re-fetch the token; that's documented as acceptable because `GerarToken` is idempotent and cheap.
- **Token TTL = 8h, refreshed 15 min early.** Constants `TOKEN_TTL_MS` and `TOKEN_REFRESH_MARGIN` in `lib/infocar.js`.
- **Fetch timeout is 20 s** (`FETCH_TIMEOUT_MS`) — both for the token call and the lookup; an abort produces a `502 upstream_unreachable`.

---

## 3. Data flow

### 3a. Today — no persistence

```mermaid
flowchart LR
  Q["plate / VIN<br/>(in URL path)"]
  PRX["Express / Vercel function"]
  TC["in-memory token cache<br/>(module-scope, 8h)"]
  INF[(Infocar)]
  LOG["console.log<br/>(masked tail only)"]
  RESP["HTTP response to user<br/>JSON forwarded verbatim"]

  Q --> PRX
  PRX <--> TC
  PRX -->|POST GerarToken<br/>GET CodificacaoFipe| INF
  PRX --> LOG
  PRX --> RESP
```

Nothing persists between requests except the in-memory bearer token. Logs only ever see `EFS…` (first 3 characters + `***`) thanks to `maskTail()`.

### 3b. Tomorrow — Azure data path the empty resources are shaped for

```mermaid
flowchart LR
  CLI["Customer client<br/>API key in header"]
  APIM2["APIM<br/>product · subscription key<br/>rate-limit / quota policies"]
  FN2["Function App<br/>(enrichment-orchestrator)"]
  KV2[("Key Vault<br/>infocar-id-key<br/>infocar-username<br/>infocar-password")]
  VI[("Cosmos<br/>vehicle_index<br/>/lookup_key · 30d TTL")]
  VE[("Cosmos<br/>vehicles<br/>/placa · 30d TTL")]
  FP[("Cosmos<br/>fipe_prices<br/>/codigoFipe · ∞ TTL")]
  CUST[("Cosmos<br/>customers<br/>/customer_id · ∞ TTL")]
  TL[("Storage container<br/>token-lock<br/>(blob lease)")]
  EH2[("Event Hub<br/>query-events · 24h")]
  QL[("Storage Data Lake<br/>query-log/<br/>partitioned archive")]
  INF2[(Infocar)]

  CLI --> APIM2 -->|JWT/key validated| FN2
  FN2 -->|customer lookup| CUST
  FN2 -->|cache lookup| VI
  VI -- hit --> FN2
  VI -- miss --> FN2
  FN2 -->|secrets (MI)| KV2
  FN2 -->|lease| TL
  FN2 -->|on miss<br/>POST/GET| INF2
  INF2 --> FN2
  FN2 -->|upsert| VE
  FN2 -->|upsert prices| FP
  FN2 -->|emit usage event| EH2
  EH2 -->|capture / consumer fn| QL
  FN2 --> CLI
```

The shape of each Cosmos container in `modules/cosmos.bicep` makes the intended access pattern unambiguous:

| Container | Partition key | TTL | Role |
|---|---|---|---|
| `vehicles` | `/placa` | 30 d | Cache of full Infocar payload keyed by plate |
| `fipe_prices` | `/codigoFipe` | ∞ (manual) | Reference table of FIPE codes/prices, refreshed by job |
| `vehicle_index` | `/lookup_key` | 30 d | Generic lookup → `placa` mapping (e.g. VIN → placa) |
| `customers` | `/customer_id` | ∞ | Tenant record: plan, status, APIM subscription, Stripe ids |
| `secrets` | `/secret_name` | ∞ | App-managed secret metadata / per-tenant key hashes |

---

## 4. Responses

The proxy is designed so that **the frontend can route on `status` + `body.error`** without ever inspecting Infocar's raw error formats.

```mermaid
flowchart TD
  R[GET /api/vehicle/plate/:plate<br/>or /api/vehicle/chassi/:chassi]
  R -->|missing/invalid Bearer| E401["401 unauthorized<br/>{ error: 'unauthorized', message }"]
  R -->|gate var unset on Vercel| E503G["503 gate_unconfigured<br/>(fail-closed)"]
  R -->|INFOCAR_* unset| E503C["503 credentials_missing"]
  R -->|server-side regex fail| E400["400 invalid_plate<br/>or invalid_chassi"]
  R -->|GerarToken HTTP !ok| E502T["502 token_fetch_failed<br/>{ error, message }"]
  R -->|fetch timeout / network| E502U["502 upstream_unreachable"]
  R -->|Infocar 404| FW404["404 (Infocar JSON, verbatim)<br/>UI shows 'Veículo não encontrado'"]
  R -->|Infocar 200| OK200["200 OK<br/>body forwarded verbatim<br/>+ x-upstream-latency-ms header"]
```

### Healthz envelope
```jsonc
GET /api/healthz                       // gate-enforced
200 → { ok: true, credentials_set: true|false, gate_enforced: true|false }
```

### 200 OK — body shape the frontend depends on
Inspected in `web/app.js` → `renderResult()`:
```jsonc
{
  "dados": {
    "dadosDoVeiculo": { /* k/v pairs → rendered into Dados grid */ },
    /* FIPE-related fields are parsed for BRL formatting */
    ...
  }
}
```
The raw payload is always shown verbatim inside the `JSON Bruto` collapsible panel — the proxy never reshapes it.

### Error envelope (proxy-generated)
```jsonc
{ "error": "<machine_code>", "message": "<human readable, sometimes PT-BR>" }
```
The frontend has explicit branches for `unauthorized`, `credentials_missing`, `invalid_plate`, `invalid_chassi`, generic non-2xx, and network failure.

---

## 5. Future integrations

The empty `services/*` folders and the empty Azure resources are not arbitrary — they map one-to-one to a planned commercial topology.

```mermaid
graph TB
  subgraph customer["Customer-facing (not built yet)"]
    SU["Sign-up site"]
    DASH["Customer dashboard"]
    MKT["Marketing site"]
  end

  subgraph control["Control plane — services/"]
    PO["provisioning-orchestrator<br/>create APIM subscription<br/>+ customers doc on sign-up"]
    SWH["stripe-webhook-handler<br/>map Stripe events → tenant status"]
    TM["token-manager<br/>refresh Infocar token<br/>w/ blob-lease lock"]
    DEID["deidentification-job<br/>scheduled scrub of PII<br/>past retention"]
  end

  subgraph runtime["Runtime data plane (today provisioned empty)"]
    APIM3["APIM<br/>products + subscriptions<br/>rate-limit / quota policies"]
    FN3["enrichment Function<br/>cache-aside on Cosmos<br/>emit usage events"]
    EH3[("Event Hub<br/>query-events")]
    QL3[("Storage<br/>query-log Data Lake")]
    TL3[("Storage<br/>token-lock")]
    COS3[("Cosmos<br/>vehicles · fipe_prices ·<br/>vehicle_index · customers · secrets")]
    KV3[("Key Vault<br/>infocar-* secrets")]
  end

  subgraph external["External SaaS"]
    STR[("Stripe")]
    INF3[("Infocar")]
  end

  SU --> PO
  PO --> APIM3
  PO --> COS3
  STR --> SWH --> COS3
  DASH --> APIM3
  APIM3 --> FN3
  FN3 -->|read creds<br/>via MI| KV3
  TM -->|rotate/lock| KV3
  TM --> TL3
  FN3 --> COS3
  FN3 --> EH3
  EH3 --> QL3
  DEID --> QL3
  DEID --> COS3
  FN3 -->|cache miss| INF3
```

### Roadmap mapping — placeholder → capability → trigger

| Folder / resource (today empty) | Capability it will own | Trigger / binding |
|---|---|---|
| `services/token-manager/` | Centralised Infocar token refresh, with a blob-lease lock in the `token-lock` container so only one instance refreshes at a time | Timer + on-demand call from the enrichment Function |
| `services/provisioning-orchestrator/` | On new tenant sign-up: create APIM product subscription, write `customers/{customer_id}` doc, optionally seed per-tenant secrets | HTTP from sign-up site **or** Stripe `checkout.session.completed` |
| `services/stripe-webhook-handler/` | Translate Stripe webhooks (`invoice.paid`, `customer.subscription.deleted`, `customer.subscription.updated`, dunning) into tenant status changes in Cosmos `customers` | Stripe webhook HTTP, signature verified |
| `services/deidentification-job/` | Scheduled PII scrub: remove plate/VIN/contact fields from `query-log` Data Lake partitions and from Cosmos `vehicles` past retention | Timer trigger |
| `services/provisioning-orchestrator/` (continued) | Generate per-tenant API keys (APIM subscription keys), email the customer | After APIM subscription create |
| Enrichment Function | Paid `/v1/vehicle/...` endpoint: cache-aside on `vehicles`/`vehicle_index`, fall back to Infocar via `token-manager`, write back, emit Event Hub event | HTTP **through APIM** |
| APIM (empty today) | Productise the API: OpenAPI import, subscription keys, rate-limit / quota policies, developer portal, optional JWT validation | — |
| Event Hub `query-events` | Decoupled stream of usage events for billing & analytics; 24 h retention → Capture / consumer to `query-log` | Function output binding |
| Cosmos `secrets` | App-managed secret metadata (per-tenant key hashes, rotation timestamps) — distinct from Key Vault secrets which hold *Infocar's* credentials | Provisioning orchestrator, token manager |
| Cosmos `customers` | Source of truth for tenant: plan, status, Stripe customer/subscription IDs, APIM subscription id | Provisioning orchestrator + stripe-webhook-handler |
| Production environment | `prod.bicepparam` exists as a placeholder; no script deploys to prod today | Activated when MVP graduates |
| CI/CD | Currently zero; deploys are manual via `infrastructure/scripts/deploy-dev.sh` / `destroy-dev.sh` | GitHub Actions (or similar) to be added |

### Identity & secrets — already wired

These are the role grants that already exist in the empty environment and that the future code will rely on (from `modules/*.bicep`):

| Role | Assignee | Scope |
|---|---|---|
| Key Vault Secrets Officer | deployer Service Principal | Key Vault — so `az keyvault secret set` works without re-running Bicep |
| Key Vault Secrets User | Function App MI | Key Vault — runtime read of `infocar-*` |
| Cosmos DB Built-in Data Contributor | Function App MI | Cosmos account — data plane only (local auth keys are *disabled*) |
| Storage Blob Data Contributor | Function App MI | Storage account — `query-log`, `token-lock`, `function-host` |
| Azure Event Hubs Data Sender | Function App MI | Event Hub namespace |

So when application code arrives, no further role plumbing is needed; only the Infocar secrets need to be seeded (`az keyvault secret set …` per `docs/dev-setup.md` § 6).

---

## 6. Out-of-scope today (explicit)

From `README.md` and `docs/dev-setup.md` § 10:

- Any application code in `services/*`.
- Customer-facing apps (sign-up, dashboard, marketing).
- Stripe integration (no webhook handler, no product mapping).
- APIM products, subscriptions, OpenAPI specs, policies — APIM is provisioned **empty**.
- Production environment — `prod.bicepparam` is a placeholder; no script deploys to prod.
- CI/CD pipelines.
- Cross-region failover / zone redundancy in dev — Cosmos is single-region, Event Hub Basic, no AZ.

# Placas360 — Catálogo de Recursos Azure (PRODUÇÃO)

> **Esta infraestrutura Azure É PRODUÇÃO do Placas360.** O único ambiente "dev" é o
> **frontend no Vercel** (preview). Não há banco/infra de homologação separados — há
> **um único banco central** (`carros_ativos_db`). Credenciais ficam no **Key Vault**.
>
> **Convenção de nomes (alvo):** `placas360-<env>-<svc>-brs` com `env = prd`
> (globais sem hífen: `placas360prd<svc>brs<sufixo>`). Regra de renomeação:
> `dev → prd` · `dadocar/dado → placas360`.
>
> Assinatura: `587a98de-…` (3E_Internal) · Região: **Brazil South** · RG atual: `rg-dadocar-dev-brs`.
> Última atualização: 2026-06-23.

## Tags (aplicadas em TODOS os 25 recursos — 2026-06-23)
`project=Placas360` · `env=prd` · `costCenter=placas360-prod` · `managedBy=bicep` (preservada).
As tags já refletem produção/Placas360; os **nomes** ainda são legados (`dadocar-dev-*`) até a migração (ver runbook abaixo).

## Catálogo (nome atual → nome-alvo)

| Recurso atual | Tipo | Função | Nome-alvo | Risco na renomeação |
|---|---|---|---|---|
| `rg-dadocar-dev-brs` | Resource Group | contêiner de tudo | `rg-placas360-prd-brs` | RG não renomeia; novo RG + mover/recriar |
| `dadocar-dev-sql-webclient-dv02-brs` (+ `carros_ativos_db`) | Azure SQL Server + DB | **banco central** (webclient/Vercel, Lisa, funções) | `placas360-prd-sql-webclient-brs` | **Alto** — FQDN muda → toda connection string (Vercel/Lisa/funções/KV); migração de dados |
| `dadocardevcosbrso3uo` | Cosmos DB | dados NoSQL | `placas360prdcosbrs<sufixo>` | **Alto** — migração de dados + endpoints |
| `dadocardevstbrso3uo` | Storage | AzureWebJobs/conteúdo das Functions | `placas360prdstbrs<sufixo>` | Médio — recriar Functions/content share |
| `dadocardevanunciosbrs` | Storage (`$web`) | **imagens de anúncio (públicas)** | `placas360prdanunciosbrs` | **Alto** — URLs https das imagens estão salvas no banco (`test_vehicles.photos`); migrar blobs **e reescrever URLs** |
| `dadocardevkvbrso3uo` | Key Vault | segredos (DB, provedores) | `placas360prdkvbrs<sufixo>` | Médio — copiar segredos + reconceder RBAC das identidades |
| `dadocar-dev-apim-brs` | API Management | gateway da API pública | `placas360-prd-apim-brs` | **Alto** — hostname muda → **clientes de API (Moneycar/Profitcar) quebram** até atualizar URL |
| `dadocar-dev-acs-brs` | Communication Services | e-mail/comunicação | `placas360-prd-acs-brs` | Médio — reconfigurar connection string |
| `dadocar-dev-email-brs` (+ `AzureManagedDomain`, `email.placas360.com`) | Email Services + Domains | envio de e-mail | `placas360-prd-email-brs` | Médio — re-vincular domínio `email.placas360.com` (manter o domínio) |
| `dadocar-dev-vision-eus` | Cognitive Services (Vision) | OCR de placa (East US) | `placas360-prd-vision-eus` | Médio — recriar + chave; sufixo `eus` = região East US |
| `dadocar-dev-evhns-brs` | Event Hubs Namespace | eventos | `placas360-prd-evhns-brs` | Médio — recriar + reconceder |
| `dadocar-dev-log-brs` | Log Analytics | logs | `placas360-prd-log-brs` | Baixo — recriar; histórico não migra |
| `dadocar-dev-appi-brs` | App Insights | telemetria | `placas360-prd-appi-brs` | Baixo — recriar; re-vincular às Functions |
| `dadocar-dev-asp-func-brs` | App Service Plan | plano das Functions | `placas360-prd-asp-func-brs` | Baixo — recriar |
| `dadocar-dev-func-checktudo-brs` | Function App | proxy CheckTudo | `placas360-prd-func-checktudo-brs` | Médio — recriar + republish + KEYVAULT_URL |
| `dadocar-dev-func-pricing-brs` | Function App | preço (KBB/Molicar) | `placas360-prd-func-pricing-brs` | Médio — idem |
| `dadocar-dev-func-enrich-brs` | Function App | enriquecimento | `placas360-prd-func-enrich-brs` | Médio — idem |
| `dadocar-dev-func-deident-brs` | Function App | **expurgo/retenção LGPD** | `placas360-prd-func-deident-brs` | Baixo — recriar + republish + KEYVAULT_URL |
| `dadocar-dev-stapp-www-brs` | Static Web App | site institucional | `placas360-prd-stapp-www-brs` | Baixo — recriar + domínio |
| `dadocar-dev-stapp-docs-brs` | Static Web App | docs | `placas360-prd-stapp-docs-brs` | Baixo — recriar + domínio |

> O webclient (Placas360) roda no **Vercel** (não é recurso Azure). Lisa fica em
> `rg-lisa-voice-brs` e o cost-report em `rg-reports-brs` — fora deste RG.

## Por que "renomear" = migração (não rename)
Quase nenhum recurso Azure permite renomear in-place (RG, SQL Server, Storage, Key
Vault, Function App, App Insights, Cosmos, APIM). "Renomear" = **criar novo (blue/green)
via Bicep + migrar dados + reapontar consumidores + retirar o antigo**.

## IaC pronta para a migração
- `infrastructure/bicep/main.bicep`: nomes globais agora derivam de `namePrefix`
  (`compactPrefix = toLower(replace(namePrefix,'-',''))`) — **retrocompatível**
  (`dadocar-dev` continua gerando os nomes atuais).
- `infrastructure/bicep/prod.bicepparam`: alvo **`placas360-prd-*`** / `rg-placas360-prd-brs` / tags Placas360.
- `infrastructure/bicep/dev.bicepparam`: stack atual (nomes legados), tags já em produção.

## Runbook de migração (executar em janela, com aprovação)
1. **Provisionar** o stack novo: `az deployment sub create --location brazilsouth --parameters prod.bicepparam` (cria `rg-placas360-prd-brs` + recursos `placas360-prd-*`). Custo dobra durante a transição.
2. **Segredos:** copiar do KV antigo → novo (`webclient-database-url`, `checktudo-*`, `infocar-*`, `molicar-*`); reconceder *Key Vault Secrets User* às identidades das Functions.
3. **Dados:**
   - SQL: migrar `carros_ativos_db` (export/import ou `CREATE DATABASE ... AS COPY OF`/geo-restore) para o novo server.
   - Cosmos: container copy (Data Migration Tool / `az cosmosdb` restore).
   - Storage `$web` anúncios: `azcopy` dos blobs **+ reescrever** `test_vehicles.photos` (URLs absolutas do host antigo → novo) no banco.
4. **Reapontar consumidores:**
   - **Vercel** (webclient): `DATABASE_URL`, endpoints de blob (`ANUNCIO_*`), chaves de API/APIM.
   - **Lisa** (`rg-lisa-voice-brs`): connection string do banco, se usar.
   - **Functions**: `KEYVAULT_URL` para o KV novo; republish.
   - **Clientes de API** (Moneycar/Profitcar): comunicar **novo hostname do APIM** + nova chave (coordenar antes).
5. **Republish** das 4 Functions no stack novo (`func azure functionapp publish placas360-prd-func-*`).
6. **Cutover:** validar tudo no novo; trocar DNS/URLs; monitorar.
7. **Retirar** o stack antigo após período de observação (manter backup do SQL/Cosmos).
8. **Rollback:** manter o stack antigo intacto até o cutover ser confirmado; reverter URLs se necessário.

> Operação outward-facing e irreversível em partes (dados, hostnames). Requer
> aprovação + janela de manutenção + coordenação com clientes de API. Não executada
> automaticamente.

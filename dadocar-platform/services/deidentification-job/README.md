# deidentification-job — Job de retenção/anonimização LGPD (Art. 15/16)

Azure Function App que aplica a política de retenção do Placas360 / DadoCar:
anonimiza PII de `api_request_logs`, exclui consultas veiculares antigas e (opt-in)
anonimiza contas inativas — preservando registros fiscais (Art. 16).

Espelha a fonte da verdade em `apps/webclient/src/lib/lgpd/retention.ts` e o script
`apps/webclient/scripts/lgpd-retention.ts`. **Mantenha os dois em sincronia.**

## Gatilhos
- **Timer:** diariamente às **03:00 UTC** (`0 0 3 * * *`).
- **HTTP** (authLevel `function`): `GET/POST /api/retention?apply=1&accounts=1` — execução sob demanda.

## Política (confirmada — OPEN_DECISIONS #2)
| Dado | Ação | Janela |
|---|---|---|
| `api_request_logs` (placa, ip, user_agent, país, cidade) | anonimizar (mantém linha p/ conciliação fiscal) | 1 ano |
| consultas `checktudo`/`infocar`/`kbb` | excluir | 1 ano |
| contas inativas (`users`) | desativar + anonimizar (opt-in) | 2 anos |

Janelas sobrescrevíveis por env `LGPD_RETENTION_*_DAYS`.

## Segurança / modo
- **DRY-RUN por padrão.** Só executa de fato com `RETENTION_APPLY=1` (ou `?apply=1`).
- Contas inativas só entram com `RETENTION_INCLUDE_ACCOUNTS=1` (ou `?accounts=1`).
- Tudo parametrizado em `@cutoff`; nenhum dado pessoal é registrado em log.

## Configuração (App Settings)
Ver `local.settings.json.example`. Essenciais: `DATABASE_URL`, `RETENTION_APPLY`,
`RETENTION_INCLUDE_ACCOUNTS`. Recomenda-se obter `DATABASE_URL` do Key Vault.

## Rodar localmente
```bash
npm install
cp local.settings.json.example local.settings.json   # preencher DATABASE_URL; manter RETENTION_APPLY=0
npm start                                             # dry-run no timer/HTTP
```

## Deploy (quando aprovado — não incluído aqui)
```bash
func azure functionapp publish <nome-da-function-app>
```
Subir primeiro em **DRY-RUN** (`RETENTION_APPLY=0`), conferir os logs de contagem e,
só então, habilitar `RETENTION_APPLY=1`. Produção não é alterada por este repositório.

"""admin.py — token-protected white-label control plane.

JSON API (Bearer LISA_ADMIN_TOKEN) to onboard/manage customers and read usage, plus
a tiny HTML console at GET /admin. Secrets are never echoed back in full.

  GET    /admin/tenants                 list tenants + current-period usage
  POST   /admin/tenants                 create/update a tenant (JSON body)
  GET    /admin/tenants/{id}            one tenant + usage
  DELETE /admin/tenants/{id}[?hard=1]   deactivate (soft) or delete (hard)
  GET    /admin/tenants/{id}/usage?period=YYYY-MM
"""
import logging

from fastapi import APIRouter, Header, HTTPException, Request, Response

import store
import tenancy
from config import LISA_ADMIN_TOKEN

log = logging.getLogger("lisa.admin")
router = APIRouter(prefix="/admin")

_SECRET_FIELDS = ("wasender_api_key", "wasender_webhook_secret", "openai_api_key")


def _auth(authorization: str | None) -> None:
    if not LISA_ADMIN_TOKEN:
        raise HTTPException(503, "admin disabled: LISA_ADMIN_TOKEN not configured")
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token or token != LISA_ADMIN_TOKEN:
        raise HTTPException(401, "unauthorized")


def _safe(t: dict) -> dict:
    """Tenant view with secrets masked (last 4 only)."""
    out = dict(t)
    for f in _SECRET_FIELDS:
        v = t.get(f) or ""
        out[f] = (f"…{v[-4:]}" if len(v) >= 4 else ("set" if v else ""))
    return out


@router.get("/tenants")
async def list_tenants(authorization: str | None = Header(default=None)):
    _auth(authorization)
    out = []
    for t in store.list_tenants():
        out.append({**_safe(t), "usage": tenancy.usage_snapshot(t)})
    return {"tenants": out}


@router.post("/tenants")
async def upsert_tenant(request: Request, authorization: str | None = Header(default=None)):
    _auth(authorization)
    body = await request.json()
    tid = (body.get("tenant_id") or "").strip()
    if not tid:
        raise HTTPException(400, "tenant_id required")
    if not (body.get("wasender_api_key") or "").strip() and not store.get_tenant(tid):
        raise HTTPException(400, "wasender_api_key required for a new tenant")

    existing = store.get_tenant(tid) or {}
    # Start from existing (so partial updates keep prior values), then the standard
    # plan template, then apply only the fields actually provided in the body.
    base = tenancy.new_tenant(tid, body.get("name") or existing.get("name") or tid,
                              body.get("wasender_api_key") or existing.get("wasender_api_key") or "")
    merged = {**base, **existing}
    for k, v in body.items():
        if v is not None:
            merged[k] = v
    merged["tenant_id"] = tid
    # normalize numeric/bool
    merged["voice_min"] = int(merged.get("voice_min", 0) or 0)
    merged["text_msgs"] = int(merged.get("text_msgs", 0) or 0)
    merged["active"] = bool(merged.get("active", True))
    store.upsert_tenant(merged)
    log.info("tenant upserted: %s (voice=%s text=%s active=%s)", tid, merged["voice_min"], merged["text_msgs"], merged["active"])
    return {"ok": True, "tenant": {**_safe(merged), "usage": tenancy.usage_snapshot(merged)}}


@router.get("/tenants/{tid}")
async def get_tenant(tid: str, authorization: str | None = Header(default=None)):
    _auth(authorization)
    t = store.get_tenant(tid)
    if not t:
        raise HTTPException(404, "not found")
    return {**_safe(t), "usage": tenancy.usage_snapshot(t)}


@router.delete("/tenants/{tid}")
async def delete_tenant(tid: str, hard: int = 0, authorization: str | None = Header(default=None)):
    _auth(authorization)
    t = store.get_tenant(tid)
    if not t:
        raise HTTPException(404, "not found")
    if hard:
        store.delete_tenant(tid)
        return {"ok": True, "deleted": tid}
    t["active"] = False
    store.upsert_tenant(t)
    return {"ok": True, "deactivated": tid}


@router.get("/tenants/{tid}/usage")
async def tenant_usage(tid: str, period: str | None = None, authorization: str | None = Header(default=None)):
    _auth(authorization)
    t = store.get_tenant(tid)
    if not t:
        raise HTTPException(404, "not found")
    if period:
        u = store.get_usage(tid, period)
        return {"tenant_id": tid, "period": period, "usage": u}
    return {"tenant_id": tid, "usage": tenancy.usage_snapshot(t)}


@router.get("")
async def console():
    """Minimal HTML console. Auth happens client-side: it asks for the admin token
    and sends it as a Bearer header to the JSON API above (token kept in localStorage)."""
    return Response(content=_CONSOLE_HTML, media_type="text/html")


_CONSOLE_HTML = """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Lisa — White-label Admin</title>
<style>body{font:14px system-ui,sans-serif;max-width:880px;margin:24px auto;padding:0 16px;color:#111}
h1{font-size:20px}input,button,textarea{font:inherit;padding:7px 9px;margin:3px 0;border:1px solid #ccc;border-radius:7px}
input,textarea{width:100%}label{font-size:12px;color:#555;margin-top:6px;display:block}
button{background:#1f6feb;color:#fff;border:0;cursor:pointer;font-weight:600}.row{display:flex;gap:8px}.row>div{flex:1}
table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border-bottom:1px solid #eee;padding:7px;text-align:left;font-size:13px}
.card{border:1px solid #e5e5e5;border-radius:12px;padding:14px;margin:14px 0}.muted{color:#777;font-size:12px}</style></head>
<body><h1>Lisa — White-label Admin</h1>
<div class="card"><label>Admin token</label><input id="tok" type="password" placeholder="LISA_ADMIN_TOKEN">
<button onclick="save()">Salvar token & carregar</button> <span id="st" class="muted"></span></div>
<div class="card"><h3>Novo / editar cliente</h3>
<div class="row"><div><label>tenant_id (sem espaços)</label><input id="tid" placeholder="acme"></div>
<div><label>Nome da marca</label><input id="name" placeholder="ACME Veículos"></div></div>
<label>WaSender API key (sessão do cliente)</label><input id="wak" placeholder="bearer key da sessão WaSender">
<label>WaSender webhook secret (opcional)</label><input id="wsec" placeholder="">
<div class="row"><div><label>Minutos de voz/mês (0 = ilimitado)</label><input id="vmin" type="number" value="100"></div>
<div><label>Mensagens de texto/mês (0 = ilimitado)</label><input id="tmsg" type="number" value="500"></div>
<div><label>Voz OpenAI</label><input id="voice" placeholder="coral"></div></div>
<label>System prompt (opcional — vazio usa a Lisa padrão)</label><textarea id="sp" rows="3"></textarea>
<button onclick="upsert()">Salvar cliente</button>
<p class="muted">Webhook do cliente no WaSender → <code id="wh"></code>/webhook/&lt;tenant_id&gt;</p></div>
<div id="list"></div>
<script>
const $=id=>document.getElementById(id); $('wh').textContent=location.origin;
function tok(){return localStorage.getItem('lisa_tok')||''}
function save(){localStorage.setItem('lisa_tok',$('tok').value.trim());load()}
async function api(p,opt={}){opt.headers=Object.assign({'Authorization':'Bearer '+tok(),'Content-Type':'application/json'},opt.headers||{});const r=await fetch('/admin'+p,opt);if(!r.ok){throw new Error((await r.json()).detail||r.status)}return r.json()}
async function load(){try{const d=await api('/tenants');$('st').textContent='ok';render(d.tenants)}catch(e){$('st').textContent='erro: '+e.message}}
function render(ts){let h='<table><tr><th>Cliente</th><th>Plano</th><th>Uso voz</th><th>Uso texto</th><th>Custo US$</th><th>Ativo</th><th></th></tr>';
for(const t of ts){const u=t.usage;h+=`<tr><td><b>${t.tenant_id}</b><br><span class=muted>${t.name||''}</span></td>
<td>${t.voice_min||'∞'} min<br>${t.text_msgs||'∞'} msg</td>
<td>${u.voice_min_used} / ${t.voice_min||'∞'}</td><td>${u.text_used} / ${t.text_msgs||'∞'}</td>
<td>${u.cost_usd}</td><td>${t.active?'sim':'não'}</td>
<td><button onclick="edit('${t.tenant_id}')">editar</button> <button onclick="del('${t.tenant_id}')">desativar</button></td></tr>`}
h+='</table>';$('list').innerHTML=h;window._ts=ts}
function edit(id){const t=window._ts.find(x=>x.tenant_id===id);$('tid').value=t.tenant_id;$('name').value=t.name||'';$('vmin').value=t.voice_min||0;$('tmsg').value=t.text_msgs||0;$('voice').value=t.voice||'';$('sp').value=t.system_prompt||'';$('wak').placeholder='(mantém atual: '+t.wasender_api_key+')';$('wak').value='';window.scrollTo(0,0)}
async function upsert(){const b={tenant_id:$('tid').value.trim(),name:$('name').value.trim(),voice_min:+$('vmin').value,text_msgs:+$('tmsg').value,voice:$('voice').value.trim(),system_prompt:$('sp').value};
const wak=$('wak').value.trim();if(wak)b.wasender_api_key=wak;const ws=$('wsec').value.trim();if(ws)b.wasender_webhook_secret=ws;
try{await api('/tenants',{method:'POST',body:JSON.stringify(b)});$('st').textContent='salvo';load()}catch(e){alert('erro: '+e.message)}}
async function del(id){if(!confirm('Desativar '+id+'?'))return;await api('/tenants/'+id,{method:'DELETE'});load()}
if(tok()){$('tok').value=tok();load()}
</script></body></html>"""

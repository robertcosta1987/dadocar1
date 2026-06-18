"""store.py — durable, lightweight tenant + usage store.

White-label data lives OUTSIDE the Placas360 SQL DB (separate store, by design):
Azure Table Storage when LISA_STORE_CONN is set, else an in-memory fallback so the
bot still runs locally / single-tenant. Two logical tables:

  tenants:  PK="tenant"   RK=<tenant_id>   → brand, WaSender creds, plan caps, persona
  usage:    PK=<tenant_id> RK=<period YYYY-MM> → voice_in_sec, voice_out_sec, text_count, cost_usd

Usage increments are atomic via ETag optimistic concurrency (retry loop), so the
meter never under-counts under the bot's low concurrency.
"""
import logging
import threading

from config import LISA_STORE_CONN

log = logging.getLogger("lisa.store")

_TENANTS = "tenants"
_USAGE = "usage"
_TPK = "tenant"  # single partition for the tenant catalog

# Fields persisted for a usage row (all numeric, default 0).
_USAGE_FIELDS = ("voice_in_sec", "voice_out_sec", "text_count", "cost_usd")


class _MemoryBackend:
    """Non-durable dict store. Fine for local dev / single-tenant; logs a warning."""

    def __init__(self):
        self._tenants: dict[str, dict] = {}
        self._usage: dict[tuple[str, str], dict] = {}
        self._lock = threading.Lock()
        log.warning("LISA_STORE_CONN not set — using IN-MEMORY store (NOT durable). Set it in production.")

    def get_tenant(self, tid):
        with self._lock:
            t = self._tenants.get(tid)
            return dict(t) if t else None

    def list_tenants(self):
        with self._lock:
            return [dict(t) for t in self._tenants.values()]

    def upsert_tenant(self, tenant):
        with self._lock:
            self._tenants[tenant["tenant_id"]] = dict(tenant)

    def delete_tenant(self, tid):
        with self._lock:
            self._tenants.pop(tid, None)

    def get_usage(self, tid, period):
        with self._lock:
            row = self._usage.get((tid, period)) or {}
            return {f: row.get(f, 0) for f in _USAGE_FIELDS}

    def add_usage(self, tid, period, **deltas):
        with self._lock:
            row = self._usage.setdefault((tid, period), {f: 0 for f in _USAGE_FIELDS})
            for f in _USAGE_FIELDS:
                row[f] = round(row.get(f, 0) + deltas.get(f, 0), 4)
            return dict(row)


class _TableBackend:
    """Azure Table Storage backend."""

    def __init__(self, conn):
        from azure.data.tables import TableServiceClient
        self._svc = TableServiceClient.from_connection_string(conn)
        self._svc.create_table_if_not_exists(_TENANTS)
        self._svc.create_table_if_not_exists(_USAGE)
        self._tenants = self._svc.get_table_client(_TENANTS)
        self._usage = self._svc.get_table_client(_USAGE)
        log.info("Azure Table Storage store ready (tables: %s, %s)", _TENANTS, _USAGE)

    # tenants
    def get_tenant(self, tid):
        from azure.core.exceptions import ResourceNotFoundError
        try:
            e = self._tenants.get_entity(_TPK, tid)
        except ResourceNotFoundError:
            return None
        return _entity_to_tenant(e)

    def list_tenants(self):
        rows = self._tenants.query_entities(f"PartitionKey eq '{_TPK}'")
        return [_entity_to_tenant(e) for e in rows]

    def upsert_tenant(self, tenant):
        from azure.data.tables import UpdateMode
        e = {"PartitionKey": _TPK, "RowKey": tenant["tenant_id"], **_tenant_to_entity(tenant)}
        self._tenants.upsert_entity(e, mode=UpdateMode.REPLACE)

    def delete_tenant(self, tid):
        from azure.core.exceptions import ResourceNotFoundError
        try:
            self._tenants.delete_entity(_TPK, tid)
        except ResourceNotFoundError:
            pass

    # usage
    def get_usage(self, tid, period):
        from azure.core.exceptions import ResourceNotFoundError
        try:
            e = self._usage.get_entity(tid, period)
        except ResourceNotFoundError:
            return {f: 0 for f in _USAGE_FIELDS}
        return {f: e.get(f, 0) for f in _USAGE_FIELDS}

    def add_usage(self, tid, period, **deltas):
        from azure.data.tables import UpdateMode
        from azure.core.exceptions import ResourceNotFoundError, ResourceExistsError, HttpResponseError
        for attempt in range(6):
            try:
                e = self._usage.get_entity(tid, period)
                for f in _USAGE_FIELDS:
                    e[f] = round(float(e.get(f, 0)) + deltas.get(f, 0), 4)
                try:
                    self._usage.update_entity(e, mode=UpdateMode.REPLACE, etag=e.metadata["etag"], match_condition=_IF_UNMODIFIED())
                    return {f: e[f] for f in _USAGE_FIELDS}
                except HttpResponseError:  # ETag conflict → someone else wrote; retry
                    continue
            except ResourceNotFoundError:
                e = {"PartitionKey": tid, "RowKey": period, **{f: round(deltas.get(f, 0), 4) for f in _USAGE_FIELDS}}
                try:
                    self._usage.create_entity(e)
                    return {f: e[f] for f in _USAGE_FIELDS}
                except ResourceExistsError:  # created concurrently → loop and merge
                    continue
        # Give up after retries: book the deltas best-effort so we don't lose the meter.
        log.error("add_usage: ETag contention exhausted for %s/%s", tid, period)
        cur = self.get_usage(tid, period)
        return {f: round(cur.get(f, 0) + deltas.get(f, 0), 4) for f in _USAGE_FIELDS}


def _IF_UNMODIFIED():
    from azure.core import MatchConditions
    return MatchConditions.IfNotModified


# Tenant <-> entity flattening (Table Storage stores flat scalar props only).
_TENANT_STR = ("tenant_id", "name", "wasender_api_key", "wasender_webhook_secret",
               "voice", "system_prompt", "first_turn", "throttle_voice_msg",
               "throttle_text_msg", "openai_api_key", "support_contact")
_TENANT_INT = ("voice_min", "text_msgs")
_TENANT_BOOL = ("active",)


def _tenant_to_entity(t):
    e = {}
    for k in _TENANT_STR:
        if t.get(k) is not None:
            e[k] = str(t[k])
    for k in _TENANT_INT:
        e[k] = int(t.get(k, 0) or 0)
    for k in _TENANT_BOOL:
        e[k] = bool(t.get(k, True))
    return e


def _entity_to_tenant(e):
    t = {"tenant_id": e["RowKey"]}
    for k in _TENANT_STR:
        if k in e and e[k] != "":
            t[k] = e[k]
    for k in _TENANT_INT:
        t[k] = int(e.get(k, 0) or 0)
    for k in _TENANT_BOOL:
        t[k] = bool(e.get(k, True))
    return t


def _build():
    if LISA_STORE_CONN:
        try:
            return _TableBackend(LISA_STORE_CONN)
        except Exception as ex:  # noqa: BLE001 — never crash boot on store init
            log.exception("Table Storage init failed (%s) — falling back to memory", ex)
    return _MemoryBackend()


_backend = _build()

# Public API (thin pass-through to the active backend).
get_tenant = lambda tid: _backend.get_tenant(tid)              # noqa: E731
list_tenants = lambda: _backend.list_tenants()                 # noqa: E731
upsert_tenant = lambda t: _backend.upsert_tenant(t)            # noqa: E731
delete_tenant = lambda tid: _backend.delete_tenant(tid)        # noqa: E731
get_usage = lambda tid, period: _backend.get_usage(tid, period)        # noqa: E731
add_usage = lambda tid, period, **d: _backend.add_usage(tid, period, **d)  # noqa: E731

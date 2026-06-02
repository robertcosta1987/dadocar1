# 009 — LGPD de-identification job over `query-log`

- **Status**: Open
- **Effort**: 1 week
- **Depends on**: [008](008-data-lake-pipeline.md) — needs historical Parquet partitions to operate on
- **Blocks**: any move toward enterprise/regulated customers that audits data retention

## Why

Today every query event in EH and (soon, after 008) in Storage contains the raw `query_value` (full plate or VIN). LGPD treats license plates as personal data when combined with other vehicle metadata. We chose to keep the raw value in event payloads *only because* `query_value_hash` (sha256) is already populated next to it from day one — analytics work that needs to group by vehicle can do so on the hash without ever reading the raw value.

The plan is: after some retention window (e.g. 90 days), rewrite old partitions in-place to drop `query_value` and keep only `query_value_hash`. This is the standard "minimisation" pattern under LGPD Art. 6 / 18.

## Scope

In:

- A scheduled job (Databricks notebook or Synapse pipeline, daily) that:
  - Identifies partitions older than the retention threshold (`dt < today - 90`).
  - Rewrites each Parquet file to a new version with `query_value` nulled out.
  - Atomically swaps the file (write new, validate row count + hash distribution, then move).
- A small `docs/lgpd/retention-policy.md` documenting the retention window and the justification.
- A compliance log (`docs/lgpd/deidentification-log.md` or a Cosmos audit container) of every partition rewritten, with timestamp + row count.

Out:

- Right-to-be-forgotten (DSAR) workflow — that's a separate piece because it needs lookup by data subject, not by partition.
- Encryption-at-rest of `query_value` — we have RBAC on Storage already, encryption-at-rest is on by default in Azure Storage; the value here is in *deletion*, not encryption.

## Approach

1. Decide retention: start with 90 days, document the reasoning (vendor SLA windows + dispute resolution).
2. Write the job as a notebook against the Parquet table (Spark or DuckDB depending on cluster choice).
3. Run it manually first against a single old partition, audit the diff, then schedule.
4. Add an alert: job hasn't run successfully in 36 hours → page.

## Success criteria

- A randomly-sampled event from a >90-day-old partition has `query_value: null` and a non-empty `query_value_hash`.
- The compliance log shows every partition rewrite with the operator/job-run ID.
- A simple analytic query ("queries per vehicle in 2024-Q4") still produces the same answer before and after the rewrite (grouping on the hash).

## References

- [`queryEvents.js`](../../../services/enrichment-function/src/lib/queryEvents.js) — note explaining why both `query_value` and `query_value_hash` are present
- [IaaS.MD §3 compliance](../../IaaS.MD#3-compliance-posture)

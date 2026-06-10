# Decisions log

This folder records **architecture and product decisions** for Dadocar. Two flavors:

- **`NNNN-*.md` files** in this folder — **active decisions**. One per material commitment (architecture, scope, vendor choice, deployment posture). Each lives as a single file that's updated as the decision evolves.
- **`next-steps/`** — the **backlog** of work that's known-needed but not yet done. One file per tracked work item, with status, scope, dependencies, and effort estimate. These are not "decisions" — they're commitments to track gaps until they close.

## File conventions

- Filename: `NNNN-kebab-case-title.md`, four-digit zero-padded sequence.
- First line is `# NNNN — Title`.
- Each decision file has, at minimum:
  - **Status** (Active / Superseded by NNNN / Reverted)
  - **Date** (initial decision date; record updates inline below)
  - **Context** — why we're deciding now
  - **Decision** — what we picked
  - **Consequences** — what this enables, what we accept
  - **Current state** — checkboxes / table of what's live and what's pending under this decision
  - **Triggers for revisiting** — what would cause us to change course

## When to write a new decision file

A new file goes here when:

- A material architectural choice is made (e.g. "Use APIM for customer-facing entry" vs "use Vercel directly").
- A vendor / SaaS commitment is made.
- The deployment posture changes (alpha → closed beta → public).
- An item from `next-steps/` is started — its scope graduates into a decision or its closure is recorded in an existing decision.

## When to update an existing decision file

When the state changes. The "Current state" table is the living view. Append a dated note under "Updates" if the change is meaningful enough to record narrative-style.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-closed-beta-launch.md) | Closed-beta launch + immediate data-lake foundations | Active |
| [0002](0002-web-deploy-aesthetics-standard.md) | Web-deploy aesthetics standard | Active |
| [0003](0003-doc-update-workflow.md) | Doc-update workflow on every deploy | Active |
| [0004](0004-pricing-function-molicar.md) | Pricing aggregator (KBB / Molicar) as a second Function App | Active |
| [0005](0005-kbb-consultas-cache-and-history.md) | KBB consultation history + cache on Azure SQL | Active |
| [0006](0006-checktudo-integration.md) | CheckTudo vehicle-data integration | Active |
| [0007](0007-webclient-productization.md) | Webclient productization: auth, tenant isolation, Master, recall AI | Active |
| [0008](0008-api-usage-metering.md) | API usage metering + customer subscriptions (CheckTudo) | Active |
| [0009](0009-subscription-provisioning-and-limits.md) | Subscription provisioning, consumption limits & forced password change | Active |

## Next steps

See [`next-steps/README.md`](next-steps/README.md) for the catalog of open work items.

# BRD v2 governance API

This document records the API boundary implemented from the updated `[Hệ thống PM] BRD_Updated`.
It is intentionally additive: existing task, worklog, cost and snapshot tables remain readable while
the new records provide the missing approval and reconciliation state.

## Workflow rules

- A task must have `taskTypeLayer1` (`PRE_SALE`, `DELIVERY`, `PM`) and `taskTypeLayer2`
  (`CUSTOMER_PROJECT`, `INTERNAL_PROJECT`, `TICKET_MAINTENANCE`, `DAY_OFF_COMPANY`) before it can
  be included in P&L.
- A submitted task plan becomes `APPROVED` only after PM/Dx/BD review. An approved plan is immutable.
  Any change is represented by `TaskTimelineChangeRequest`; the approval writes `TaskPlanHistory`.
- Standard work is capped at 480 minutes per employee/day. Overtime is a separate `OvertimePlan` and
  never becomes P&L cost until approved. Day-off records are billing-exempt.
- `ResourceMonthlyCost` is effective-dated and stores P1–P4, OT, insurance, PIT and total income.
  A locked period is immutable.
- `PnlTimeEntryAllocation` stores one classification per worklog: `INCLUDED`, `EXCLUDED`, or `PENDING`.
  The reconciliation endpoint guarantees `included + excluded + pending = logwork`.

## Endpoints

All endpoints are workspace-scoped through the authenticated principal.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/tasks/:taskId/plan/submit` | Submit two-layer type and plan for approval |
| POST | `/tasks/:taskId/plan/approve` | PM/Dx/BD approve and lock baseline |
| POST | `/tasks/:taskId/timeline-change-requests` | Request a post-approval timeline change |
| PATCH | `/timeline-change-requests/:requestId/review` | Approve/reject and write immutable history |
| POST | `/overtime-plans` | Create a separate OT plan |
| PATCH | `/overtime-plans/:planId/review` | Approve/reject OT |
| POST | `/resource-costs/monthly` | Upsert effective-dated monthly P1–P4 cost |
| POST | `/pnl-periods` | Open or update a project/portfolio period |
| POST | `/pnl-periods/:periodId/lock` | Lock a confirmed period |
| POST | `/pnl-periods/:periodId/reopen` | Reopen with mandatory reason and actor audit |
| POST | `/pnl-periods/:periodId/rebuild-allocations` | Reclassify worklogs for the period |
| GET | `/pnl-periods/:periodId/reconciliation` | Return the auditable hour equation |

The Next.js BFF can proxy these paths without exposing database credentials. Production deployment should
apply `prisma/migrations/20260922120000_brd_v2_governance/migration.sql` only after backup and migration review.

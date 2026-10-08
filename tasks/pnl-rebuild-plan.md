# Implementation Plan: PM P&L Control Center

## Scope

Rebuild `/pnl` around one period-consistent API response, exception-first overview, portfolio control table, and concise project detail. Preserve permissions, reconciliation, lock/reopen, and export contracts.

## Dependency graph

`P&L domain aggregation` → `typed API response` → `frontend view model` → `overview/portfolio UI` → `detail/export` → `runtime QA`.

## Vertical slices

### Task 1 — Period-consistent P&L read model

Acceptance:

- API accepts the selected period and returns totals/projects from the same period.
- Response exposes source/data-quality/basis fields and explicit unavailable values.
- Existing permission checks remain enforced.

Verification: focused API tests, contracts typecheck.

### Task 2 — Exception-first overview

Acceptance:

- Overview has compact filters, executive summary, and needs-attention table.
- No duplicated title, decorative charts, or silent demo fallback.
- URL keeps period and filters.

Verification: web typecheck/build and component tests where present.

### Task 3 — Portfolio control table

Acceptance:

- Table shows revenue, cost, margin, hours, variance, data quality, owner, next action.
- Sort/filter and row navigation preserve query state.

Verification: focused selector tests and browser smoke.

### Task 4 — Project detail reduction

Acceptance:

- Detail leads with financial result and controls.
- Reconciliation and person/task cost data remain available below the fold.
- Daily/matrix views are secondary and do not dominate the page.

Verification: browser smoke for detail/back navigation.

### Task 5 — Export and governance regression

Acceptance:

- Export uses the same filtered read model.
- Lock/reopen and permission boundaries remain intact.

Verification: API tests, export smoke, diff review.

## Risks

- Existing P&L API may be consumed by dashboard components; keep additive endpoint/contract until consumers migrate.
- Current project summary does not carry all time-period calculations; calculate period allocations from time entries server-side.
- Forecast is not authoritative in current schema; show unavailable instead of inventing a number.

## Checkpoints

- After Task 1: API response is period-consistent and tested.
- After Task 3: overview and portfolio are usable without detail.
- Before completion: full web/API typecheck, build, diff review, local browser smoke.

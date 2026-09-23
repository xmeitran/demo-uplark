# Projects Server-Side Filter Pagination

## Context

The production `/projects` route paginates live CRM projects at 10 rows per page. Search, status, and category filters must apply to the full project table before pagination so totals, next-page state, and visible rows stay consistent.

## Design

- The web route calls `GET /api/projects` with `limit`, `offset`, `q`, `status`, and `category` query params.
- UI status labels are translated to backend project status codes before the request.
- The API service builds one Prisma `where` clause and reuses it for both `findMany` and `count`.
- Search matches project name, project code, account name, and opportunity title.
- Category maps to `opportunity.stage`; `Delivery` also includes projects without an opportunity.

## Production Guardrail

Do not reintroduce client-side filtering over the loaded page for `/projects`. The client may sort the current page, but filtering that affects totals must remain in the API query.

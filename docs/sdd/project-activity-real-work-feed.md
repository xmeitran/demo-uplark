# Project Activity Real Work Feed

## Context

The project detail `Activity` tab must show real user activity across the full available workspace. Imported projects can have real task time entries even when the dedicated `ProjectActivity` table is still empty, so the UI must not collapse to a small empty-state card in that case.

## Design

- The web project detail page keeps reading persisted project activity from `GET /api/projects/:projectId/activity`.
- The same page also derives activity rows from live task `timeEntries` returned by `GET /api/tasks?projectId=...`.
- Derived work-log rows preserve the real user name, avatar identity, work date, note, task, stage, and actual hours.
- The final feed merges persisted project activity and derived work logs, then sorts newest first.
- The `Activity` tab renders full width with a main feed and a compact summary rail for event count, active users, actual hours, tasks touched, logged entries, and project notes.

## Production Guardrail

Do not gate the project `Activity` tab only on `ProjectActivity` rows. Real task work logs are production activity and must remain visible even when the operational activity table has no rows for imported historical projects.

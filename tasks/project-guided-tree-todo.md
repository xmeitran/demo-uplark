# Tasks: Guided Project Todo Tree

## Slice 1 — Contracts and persistence

- [x] Add nested task/subtask template contracts.
- [x] Normalize and validate task tree.
- [x] Seed tasks/subtasks during project creation transaction.
- [ ] Add API tests for nested creation and invalid parent references.

## Slice 2 — Template and AI import

- [x] Parse Task/Subtask columns from flat and multi-sheet imports.
- [x] Extend AI draft response and preview counts.
- [x] Send nested draft through Create Project popup.
- [x] Show an expandable Milestone → Stage → Task → Subtask tree in the AI preview and editor.

## Slice 3 — Project Detail

- [x] Render four-level hierarchy.
- [x] Add Subtask action and modal.
- [x] Wire create flow and canonical refresh; existing edit/delete/detail flows remain available.
- [x] Preserve legacy projects and show nested tasks without changing their stored data.

## Slice 4 — Verification

- [x] Focused API/unit tests.
- [x] Web typecheck/build.
- [x] Local browser smoke test.
- [x] Update plan and record known limitations.

Known limitation: progress and hour totals are still calculated from the existing task summaries; a later pass should decide whether parent-task totals include leaf subtasks or remain an explicit roll-up policy.

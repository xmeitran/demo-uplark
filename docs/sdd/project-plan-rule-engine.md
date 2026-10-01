# Rule-based project plan preview

## Goal

Give project creators a deterministic, zero-cost way to turn a project brief into a reviewable `Milestone -> Stage -> Task` plan inside the existing Lark project creation modal.

## Scope for the first slice

- Add a protected `POST /projects/plan-preview` endpoint.
- Select the requested active milestone template, or fall back to the built-in pilot template.
- Generate a small task checklist from stage names and the project scope using deterministic keyword rules.
- Return stable preview-only IDs; never persist a project, milestone, stage, or task from this endpoint.
- Add a preview/apply control to the existing project creation modal.
- Applying the preview updates the modal's milestone/stage fields only. Project persistence remains behind the existing submit button.

## Non-goals

- No LLM, external provider, API key, or network call.
- No automatic project creation or task persistence.
- No changes to existing milestone-template storage format.
- No replacement of the existing manual/template creation paths.

## Contract

`POST /projects/plan-preview?principal=<principal>` accepts project name, scope, acceptance criteria, optional template key, and optional manual milestones. It returns:

```ts
{
  data: {
    source: "rule-engine",
    templateKey: string,
    summary: { milestoneCount: number, stageCount: number, taskCount: number },
    milestones: Array<{
      id: string,
      name: string,
      stages: Array<{
        id: string,
        stageKey: string,
        activity: string,
        tasks: Array<{ id: string, title: string, estimateMinutes: number }>
      }>
    }>
  }
}
```

## Safety

- Reuse the existing principal resolution and workspace scoping.
- Validate all input at the service boundary.
- IDs are opaque preview IDs and must not be sent to persistence APIs.
- Empty/unknown briefs still return the template's baseline checklist.

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActiveProjectAssignmentMemberships,
  buildProjectAssignmentReferenceRows
} from "./project-assignment-membership.mjs";

test("builds a unique active project/user membership union with source evidence", () => {
  const result = buildActiveProjectAssignmentMemberships([
    { projectKey: "project-2", userId: "user-2", source: "task_assignee" },
    { projectKey: "project-1", userId: "user-1", source: "stage_pic" },
    { projectKey: "project-1", userId: "user-1", source: "task_assignee" },
    { projectKey: "project-1", userId: "user-suspended", source: "task_assignee" },
    { projectKey: "", userId: "user-1", source: "task_assignee" },
    { projectKey: "project-1", userId: undefined, source: "task_assignee" }
  ], new Set(["user-1", "user-2"]), [
    { projectKey: "project-2", userId: "user-2" }
  ]);

  assert.deepEqual(result, [
    { projectKey: "project-1", userId: "user-1", sources: ["stage_pic", "task_assignee"] }
  ]);
});

test("does not add a second relation for an existing project member", () => {
  const result = buildActiveProjectAssignmentMemberships([
    { projectKey: "project-1", userId: "user-1", source: "task_assignee" }
  ], ["user-1"], [
    { projectKey: "project-1", userId: "user-1", relation: "DX_TEAM" }
  ]);

  assert.deepEqual(result, []);
});

test("returns an empty union when no assignment user is active", () => {
  assert.deepEqual(buildActiveProjectAssignmentMemberships([
    { projectKey: "project-1", userId: "user-1", source: "task_assignee" }
  ], []), []);
});

test("unions task owner, task assignee, and stage owner evidence by project/user", () => {
  const rows = buildProjectAssignmentReferenceRows({
    members: [{ projectId: "project-1", userId: "existing-user" }],
    tasks: [{
      id: "task-1",
      title: "Build",
      projectId: "project-1",
      project: { code: "PRJ-1", name: "Project 1" },
      assigneeUserId: "user-1",
      ownerUserId: "user-1"
    }, {
      id: "task-2",
      title: "Existing",
      projectId: "project-1",
      project: { code: "PRJ-1", name: "Project 1" },
      assigneeUserId: "existing-user",
      ownerUserId: "existing-user"
    }],
    stages: [{
      id: "stage-1",
      activity: "Design",
      projectId: "project-1",
      project: { code: "PRJ-1", name: "Project 1" },
      ownerUserId: "user-1"
    }]
  });

  assert.deepEqual(rows, [{
    projectId: "project-1",
    projectCode: "PRJ-1",
    projectName: "Project 1",
    userId: "user-1",
    sources: [{ kind: "stage_owner", id: "stage-1", label: "Design" },
      { kind: "task_assignee", id: "task-1", label: "Build" },
      { kind: "task_owner", id: "task-1", label: "Build" }]
  }]);
});

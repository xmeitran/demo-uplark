import { describe, expect, it } from "vitest";
import {
  buildCalendarMemberOptions,
  buildCalendarProjectOptions,
  filterCalendarEvents,
  pruneCalendarFilterIds,
  type CalendarFilterEvent
} from "./calendar-filters";

const events: Array<CalendarFilterEvent & { id: string }> = [
  {
    id: "event-1",
    projectId: "project-z",
    projectName: "Zeta",
    userId: "user-2",
    userDisplayName: "Tên từ sự kiện"
  },
  {
    id: "event-2",
    projectId: "project-a",
    projectName: "Ánh Dương",
    userId: "user-1",
    userDisplayName: "Bình"
  },
  {
    id: "event-3",
    projectId: "project-a",
    projectName: "Tên trùng không được dùng",
    userId: "user-2",
    userDisplayName: "Tên từ sự kiện"
  },
  {
    id: "event-without-project",
    userId: "user-3",
    userDisplayName: "Chưa có dự án"
  }
];

describe("calendar filters", () => {
  it("deduplicates and sorts project options by Vietnamese display label", () => {
    expect(buildCalendarProjectOptions(events)).toEqual([
      { value: "project-a", label: "Ánh Dương" },
      { value: "project-z", label: "Zeta" }
    ]);
  });

  it("omits missing project metadata instead of inventing an option", () => {
    expect(buildCalendarProjectOptions([
      { projectId: "project-hidden", userId: "user-1" },
      { projectName: "Không có ID", userId: "user-2" }
    ])).toEqual([]);
  });

  it("deduplicates members, enriches directory labels, and sorts them", () => {
    expect(buildCalendarMemberOptions(events, [
      { id: "user-2", name: "An", role: "Delivery", initials: "AN", color: "#2563eb" }
    ])).toEqual([
      {
        value: "user-2",
        label: "An",
        subtext: "Delivery",
        avatarUrl: undefined,
        initials: "AN",
        color: "#2563eb"
      },
      {
        value: "user-1",
        label: "Bình",
        subtext: undefined,
        avatarUrl: undefined,
        initials: undefined,
        color: undefined
      },
      {
        value: "user-3",
        label: "Chưa có dự án",
        subtext: undefined,
        avatarUrl: undefined,
        initials: undefined,
        color: undefined
      }
    ]);
  });

  it("uses OR within project and member groups", () => {
    expect(filterCalendarEvents(events, {
      projectIds: ["project-a", "project-z"],
      memberIds: []
    }).map((event) => event.id)).toEqual(["event-1", "event-2", "event-3"]);

    expect(filterCalendarEvents(events, {
      projectIds: [],
      memberIds: ["user-1", "user-3"]
    }).map((event) => event.id)).toEqual(["event-2", "event-without-project"]);
  });

  it("uses AND across project and member groups", () => {
    expect(filterCalendarEvents(events, {
      projectIds: ["project-a", "project-z"],
      memberIds: ["user-2"]
    }).map((event) => event.id)).toEqual(["event-1", "event-3"]);

    expect(filterCalendarEvents(events, {
      projectIds: ["project-a"],
      memberIds: ["user-2"]
    }).map((event) => event.id)).toEqual(["event-3"]);
  });

  it("returns the canonical collection when all filters are cleared", () => {
    expect(filterCalendarEvents(events, { projectIds: [], memberIds: [] })).toBe(events);
  });

  it("does not match project-less events while a project group is active", () => {
    expect(filterCalendarEvents(events, {
      projectIds: ["project-a", "project-z"],
      memberIds: ["user-3"]
    })).toEqual([]);
  });

  it("prunes only stale and duplicate selections while preserving explicit valid choices", () => {
    const options = buildCalendarProjectOptions(events);
    expect(pruneCalendarFilterIds(
      ["project-z", "stale-project", "project-a", "project-z"],
      options
    )).toEqual(["project-z", "project-a"]);
    expect(pruneCalendarFilterIds([], options)).toEqual([]);
  });
});

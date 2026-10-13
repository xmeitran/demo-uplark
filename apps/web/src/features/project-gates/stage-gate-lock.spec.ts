import { describe, expect, it } from "vitest";
import { gateBlockNote, stageGateBlocks } from "./stage-gate-lock";

const stages = [
  { id: "s-build", milestoneSortOrder: 20, sortOrder: 10 },
  { id: "s-intake", milestoneSortOrder: 10, sortOrder: 10 },
  { id: "s-validate", milestoneSortOrder: 10, sortOrder: 20 },
  { id: "s-pilot", milestoneSortOrder: 30, sortOrder: 10 },
  { id: "s-cr", milestoneSortOrder: 20, sortOrder: 90, changeRequestId: "cr-1" }
];
const g1 = { stageId: "s-validate", code: "G1", status: "not_submitted", definition: { name: "Đóng scope & kick-off" } };
const g4 = { stageId: "s-build", code: "G4", status: "not_submitted", definition: { name: "UAT" } };

describe("stageGateBlocks", () => {
  it("blocks every stage after a gate that is not passed, and names the nearest such gate", () => {
    expect(stageGateBlocks(stages, [g1, g4])).toEqual({
      "s-build": { code: "G1", name: "Đóng scope & kick-off" },
      "s-pilot": { code: "G4", name: "UAT" }
    });
  });

  it("opens the next stages once the gate is approved or opened by exception", () => {
    expect(stageGateBlocks(stages, [{ ...g1, status: "approved" }, { ...g4, status: "exception" }])).toEqual({});
  });

  it("never blocks the stage that carries the gate, a change-request stage, or a project without gates", () => {
    const blocks = stageGateBlocks(stages, [g1]);
    expect(blocks["s-intake"]).toBeUndefined();
    expect(blocks["s-validate"]).toBeUndefined();
    expect(blocks["s-cr"]).toBeUndefined();
    expect(stageGateBlocks(stages, [])).toEqual({});
  });

  it("writes the note with the gate and where to approve it", () => {
    expect(gateBlockNote({ code: "G1", name: "Đóng scope & kick-off" }, "ghi giờ"))
      .toBe("Điểm chốt G1 (Đóng scope & kick-off) chưa được duyệt nên chưa thể ghi giờ. Duyệt điểm chốt ở tab Điểm chốt & Tài liệu của dự án.");
  });
});

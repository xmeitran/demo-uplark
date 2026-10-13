/**
 * Read-only export of the issue-log rows of the retired type "Yêu cầu thay đổi" (chốt 13/10/2026: the flow left the
 * system; the rows stay stored and are no longer listed anywhere in the app). SELECT only — nothing is written.
 *
 *   DATABASE_URL=... node scripts/operations/export-change-requests.mjs <output.csv>
 */
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const output = process.argv[2];
if (!output) {
  console.error("Usage: node scripts/operations/export-change-requests.mjs <output.csv>");
  process.exit(1);
}

const prisma = new PrismaClient();
const day = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");
// RFC 4180; a leading = + - @ is prefixed so a spreadsheet does not run the cell as a formula.
const cell = (value) => {
  const text = String(value ?? "").replace(/^([=+\-@])/, "'$1");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

try {
  const rows = await prisma.projectRisk.findMany({
    where: { type: "change_request" },
    orderBy: [{ projectId: "asc" }, { code: "asc" }],
    select: {
      code: true, description: true, status: true, crStep: true, stepDueAt: true, dueAt: true, createdAt: true, closedAt: true, cancelReason: true, extension: true,
      project: { select: { code: true, name: true } }, owner: { select: { displayName: true } }, createdBy: { select: { displayName: true } }
    }
  });
  const header = ["Mã", "Mã dự án", "Dự án", "Mô tả", "Bước", "Trạng thái", "Ngày tạo", "Hạn bước", "Hạn xử lý", "Ngày đóng", "Người phụ trách", "Người tạo", "Lý do huỷ", "Thông tin riêng (JSON)"];
  const lines = rows.map((row) => [
    row.code, row.project?.code, row.project?.name, row.description, row.crStep, row.status, day(row.createdAt), day(row.stepDueAt), day(row.dueAt), day(row.closedAt),
    row.owner?.displayName, row.createdBy?.displayName, row.cancelReason, JSON.stringify(row.extension ?? {})
  ]);
  writeFileSync(output, `﻿${[header, ...lines].map((line) => line.map(cell).join(",")).join("\r\n")}\r\n`);
  console.log(`${rows.length} yêu cầu thay đổi → ${output}`);
} finally {
  await prisma.$disconnect();
}

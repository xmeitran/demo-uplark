export type CsvValue = string | number | boolean | null | undefined;

function safeCell(value: CsvValue) {
  let text = value == null ? "" : String(value);
  // Spreadsheet apps may ignore leading whitespace/control characters before
  // interpreting a formula. Put the neutralizing apostrophe at byte zero.
  if (/^\s*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function createCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]) {
  return [headers, ...rows].map((row) => row.map(safeCell).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, headers: readonly string[], rows: readonly (readonly CsvValue[])[]) {
  const blob = new Blob(["\uFEFF", createCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

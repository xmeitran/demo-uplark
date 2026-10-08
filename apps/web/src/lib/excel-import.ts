import ExcelJS from "exceljs";
import JSZip from "jszip";

function normalizePrefixedXml(xml: string) {
  return xml
    .replace(/<x:/g, "<")
    .replace(/<\/x:/g, "</")
    .replace(/\s+xmlns:x="[^"]+"/g, "");
}

/** Reads normal XLSX files and XLSX files exported with prefixed XML namespaces. */
export async function loadExcelWorkbook(arrayBuffer: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(arrayBuffer);
    return workbook;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/reading ['"]?sheets['"]?|undefined/i.test(message)) throw error;
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xmlEntries = Object.keys(zip.files).filter((name) => name.startsWith("xl/") && name.endsWith(".xml"));
    for (const name of xmlEntries) {
      const entry = zip.file(name);
      if (!entry) continue;
      zip.file(name, normalizePrefixedXml(await entry.async("text")));
    }
    const normalizedBuffer = await zip.generateAsync({ type: "arraybuffer" });
    const normalizedWorkbook = new ExcelJS.Workbook();
    await normalizedWorkbook.xlsx.load(normalizedBuffer);
    return normalizedWorkbook;
  }
}

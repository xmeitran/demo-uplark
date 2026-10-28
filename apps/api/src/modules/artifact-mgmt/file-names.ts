import { BadRequestException } from "@nestjs/common";
import { nonEmptyString } from "../../shared/http/request-context";

const BLOCKED_FILE_EXTENSIONS = new Set([
  ".app",
  ".bat",
  ".cmd",
  ".com",
  ".dll",
  ".dmg",
  ".exe",
  ".html",
  ".htm",
  ".js",
  ".jar",
  ".msi",
  ".ps1",
  ".scr",
  ".sh",
  ".svg",
  ".vbs",
  ".xhtml"
]);

/**
 * A file object's name. Uploaded bytes may not carry an executable extension; a link's name is only a label
 * (an external file is never downloaded), so links pass `blockExecutables = false`.
 */
export function validateFileName(value: unknown, blockExecutables = true) {
  const fileName = nonEmptyString(value, "fileName");
  if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("\0")) {
    throw new BadRequestException("fileName must not contain path separators");
  }
  const lowerName = fileName.toLowerCase();
  const extension = lowerName.includes(".") ? lowerName.slice(lowerName.lastIndexOf(".")) : "";
  if (blockExecutables && BLOCKED_FILE_EXTENSIONS.has(extension)) {
    throw new BadRequestException("File type is not allowed");
  }
  return fileName;
}

/** The URL of a link file object: http or https only. */
export function parseExternalUrl(value: unknown) {
  let externalUrl: URL;
  try {
    externalUrl = new URL(String(value ?? "").trim());
  } catch {
    throw new BadRequestException("externalUrl must be a valid URL");
  }
  if (!["http:", "https:"].includes(externalUrl.protocol)) {
    throw new BadRequestException("externalUrl must use http or https");
  }
  return externalUrl;
}

/**
 * Content-Disposition for a file name in any language (RFC 6266 / 5987): an ASCII `filename` for old clients and the
 * real name in `filename*`. A raw "THIẾT BỊ.xlsx" in the header makes Node refuse the response (ERR_INVALID_CHAR).
 */
export function contentDisposition(type: "inline" | "attachment", fileName: string) {
  const name = fileName.replace(/[\r\n]/g, " ");
  const ascii = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

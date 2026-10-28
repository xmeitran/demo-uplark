import type { TaskAttachmentSummary } from "@b2b-crm/contracts";

/**
 * Task attachments, shared by Task Detail and the project Task Board.
 * A link is a task-owned file object with storageProvider "external"; the files API only accepts http(s) URLs.
 */
export type TaskAttachmentView = {
  id: string;
  fileObjectId?: string;
  url?: string;
  ext: string;
  name: string;
  size: string;
  date: string;
  initials: string;
  bg: string;
  color: string;
};

export function attachmentStyle(ext: string) {
  const normalized = ext.toUpperCase();
  const bgMap: Record<string, string> = {
    PDF: "bg-red-50 text-red-600",
    PNG: "bg-emerald-50 text-emerald-600",
    JPG: "bg-emerald-50 text-emerald-600",
    JPEG: "bg-emerald-50 text-emerald-600",
    DOCX: "bg-blue-50 text-blue-600",
    DOC: "bg-blue-50 text-blue-600",
    XLSX: "bg-green-50 text-green-600",
    ZIP: "bg-purple-50 text-purple-600",
    LINK: "bg-indigo-50 text-indigo-600",
  };
  const [bg, color] = (bgMap[normalized] || "bg-slate-50 text-slate-600").split(" ");
  return { bg, color };
}

export function formatAttachmentSize(byteSize: number) {
  const sizeMB = (byteSize / (1024 * 1024)).toFixed(1);
  return Number(sizeMB) > 0 ? `${sizeMB} MB` : `${(byteSize / 1024).toFixed(0)} KB`;
}

export function mapTaskAttachmentToView(attachment: TaskAttachmentSummary): TaskAttachmentView {
  const name = attachment.file.fileName;
  const url = attachment.file.externalUrl;
  const ext = url ? "LINK" : name.split(".").pop()?.toUpperCase() || "FILE";
  const { bg, color } = attachmentStyle(ext);
  return {
    id: attachment.id,
    fileObjectId: attachment.fileObjectId,
    url,
    ext,
    name,
    size: url ? "—" : formatAttachmentSize(attachment.file.byteSize),
    date: new Date(attachment.createdAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "long", year: "numeric" }),
    initials: "KN",
    bg,
    color
  };
}

export function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",").pop() ?? "" : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

/** File input for an external link: a missing scheme becomes https://; an empty name lets the API use the host. */
export function linkFileInput(rawUrl: string, rawName: string) {
  const url = rawUrl.trim();
  return {
    storageProvider: "external",
    externalUrl: /^https?:\/\//i.test(url) ? url : `https://${url}`,
    // File names may not contain path separators.
    fileName: rawName.trim().replace(/[\\/]/g, "-") || undefined
  };
}

type AttachmentTask = { id: string; accountId?: string; projectId?: string };

function principalQuery(principal?: string) {
  return principal ? `?principal=${encodeURIComponent(principal)}` : "";
}

export async function listTaskAttachments(taskId: string, principal?: string) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/attachments${principalQuery(principal)}`, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`Could not load attachments: ${response.status}`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.data) ? (payload.data as TaskAttachmentSummary[]).map(mapTaskAttachmentToView) : [];
}

/** Creates the task-owned file object (uploaded bytes or an external link), then attaches it to the task. */
export async function createTaskAttachment(task: AttachmentTask, fileInput: Record<string, unknown>, principal?: string) {
  const query = principalQuery(principal);
  const fileResponse = await fetch(`/api/files${query}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: task.accountId,
      projectId: task.projectId,
      ownerType: "task",
      ownerId: task.id,
      customerVisible: false,
      internalOnly: true,
      allowedRoles: [],
      ...fileInput
    })
  });
  if (!fileResponse.ok) {
    throw new Error(`File upload failed: ${fileResponse.status}`);
  }
  const fileObject = await fileResponse.json();
  const attachmentResponse = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/attachments${query}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileObjectId: fileObject.id })
  });
  if (!attachmentResponse.ok) {
    throw new Error(`Task attachment link failed: ${attachmentResponse.status}`);
  }
  return mapTaskAttachmentToView(await attachmentResponse.json() as TaskAttachmentSummary);
}

/** Renames an attachment; a link can also get a new URL. */
export async function updateTaskAttachment(taskId: string, attachmentId: string, input: { fileName?: string; externalUrl?: string }, principal?: string) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}${principalQuery(principal)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(`Task attachment update failed: ${response.status}`);
  }
  return mapTaskAttachmentToView(await response.json() as TaskAttachmentSummary);
}

export async function deleteTaskAttachment(taskId: string, attachmentId: string, principal?: string) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}${principalQuery(principal)}`, {
    method: "DELETE",
    credentials: "same-origin"
  });
  if (!response.ok) {
    throw new Error(`Task attachment delete failed: ${response.status}`);
  }
}

/** A file keeps its extension when renamed: the user edits the part before it. */
export function splitFileExtension(name: string) {
  const match = /^(.*?)(\.[^.\s]{1,8})$/.exec(name);
  return match && match[1] ? { base: match[1], extension: match[2] } : { base: name, extension: "" };
}

/** Short-lived same-origin URL for an uploaded file; `inline` opens it in the browser instead of downloading. */
export async function createFileDownloadUrl(fileObjectId: string, inline = false) {
  const response = await fetch(`/api/files/${encodeURIComponent(fileObjectId)}/download-grants`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expiresInSeconds: 300 })
  });
  if (!response.ok) throw new Error(`Could not create download grant: ${response.status}`);
  const payload = await response.json() as { signedUrl?: string };
  if (!payload.signedUrl?.startsWith("/")) throw new Error("Download grant returned an invalid URL.");
  const url = new URL(payload.signedUrl, window.location.origin);
  if (inline) url.searchParams.set("inline", "1");
  return `${url.pathname}${url.search}`;
}

/** Saves an uploaded file to the user's downloads, under its own name. */
export async function downloadFileObject(fileObjectId: string) {
  const anchor = document.createElement("a");
  anchor.href = await createFileDownloadUrl(fileObjectId);
  anchor.download = "";
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** Opens an uploaded file in a new tab; the tab is opened before the await so popup blockers allow it. */
export async function openFileObject(fileObjectId: string) {
  const openedWindow = window.open("about:blank", "_blank");
  if (openedWindow) openedWindow.opener = null;
  try {
    const openUrl = await createFileDownloadUrl(fileObjectId, true);
    if (openedWindow && !openedWindow.closed) {
      openedWindow.location.href = openUrl;
    } else {
      window.location.assign(openUrl);
    }
  } catch (error) {
    openedWindow?.close();
    throw error;
  }
}

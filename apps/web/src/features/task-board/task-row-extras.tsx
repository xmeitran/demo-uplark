"use client";

/**
 * "Vấn đề" and "Tài liệu" on a Task Board row: two buttons that open a panel under the row
 * with the task's issue-log records and its attachments (files and links), without leaving the board.
 */
import Link from "next/link";
import React, { createContext, useContext, useState } from "react";
import { AlertCircle, Link2, Paperclip, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { ISSUE_LOG_STATUS_LABELS, ISSUE_LOG_TYPE_LABELS, type ProjectRiskSummary } from "@b2b-crm/contracts";
import { createTaskAttachment, deleteTaskAttachment, downloadFileObject, linkFileInput, listTaskAttachments, readFileAsBase64, splitFileExtension, updateTaskAttachment, type TaskAttachmentView } from "@/lib/task-attachments";

type TaskRowExtrasContextValue = {
  projectId: string;
  accountId?: string;
  principal?: string;
  issuesByTask: Map<string, ProjectRiskSummary[]>;
};

/** Provided by the project page around the Task Board; rows outside it show no extras. */
export const TaskRowExtrasContext = createContext<TaskRowExtrasContextValue | null>(null);

export function groupIssuesByTask(records: ProjectRiskSummary[]) {
  const byTask = new Map<string, ProjectRiskSummary[]>();
  for (const record of records) {
    if (record.taskId) byTask.set(record.taskId, [...(byTask.get(record.taskId) ?? []), record]);
  }
  return byTask;
}

const chipClass = "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold transition";
const actionClass = "inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-primary hover:text-primary";
const inputClass = "rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15";

export function useTaskRowExtras(task: { id: string; title: string; attachmentCount?: number }) {
  const context = useContext(TaskRowExtrasContext);
  const [panel, setPanel] = useState<"issues" | "docs" | null>(null);
  const [docs, setDocs] = useState<TaskAttachmentView[] | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);
  if (!context) return { buttons: null, panel: null };

  const issues = context.issuesByTask.get(task.id) ?? [];
  const openIssues = issues.filter((record) => record.isOpen).length;
  const docCount = docs?.length ?? task.attachmentCount ?? 0;
  const withPrincipal = (path: string) => context.principal ? `${path}&principal=${encodeURIComponent(context.principal)}` : path;

  const toggle = (next: "issues" | "docs") => {
    setPanel((current) => current === next ? null : next);
    if (next === "docs" && docs === null) {
      setDocsError(null);
      listTaskAttachments(task.id, context.principal)
        .then(setDocs)
        .catch(() => setDocsError("Không tải được tài liệu của task."));
    }
  };

  const buttons = (
    <>
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); toggle("issues"); }}
        aria-expanded={panel === "issues"}
        aria-label={`Vấn đề của task ${task.title}`}
        title={issues.length ? `${openIssues} đang mở / ${issues.length} vấn đề` : "Chưa có vấn đề"}
        className={`${chipClass} ${openIssues ? "border-rose-200 bg-rose-50 text-rose-700" : "border-border bg-background text-muted-foreground hover:text-foreground"} ${panel === "issues" ? "ring-2 ring-primary/20" : ""}`}
      >
        <AlertCircle className="h-3 w-3" />
        <span className="hidden sm:inline">Vấn đề</span>
        {issues.length > 0 && <span>{issues.length}</span>}
      </button>
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); toggle("docs"); }}
        aria-expanded={panel === "docs"}
        aria-label={`Tài liệu của task ${task.title}`}
        className={`${chipClass} ${docCount ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-border bg-background text-muted-foreground hover:text-foreground"} ${panel === "docs" ? "ring-2 ring-primary/20" : ""}`}
      >
        <Paperclip className="h-3 w-3" />
        <span className="hidden sm:inline">Tài liệu</span>
        {docCount > 0 && <span>{docCount}</span>}
      </button>
    </>
  );

  const panelNode = panel && (
    <div className="mx-4 mb-3 rounded-xl border border-border bg-muted/20 p-3" onClick={(event) => event.stopPropagation()}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-foreground">{panel === "issues" ? `Vấn đề của task (${issues.length})` : `Tài liệu đính kèm (${docCount})`}</p>
        <button type="button" onClick={() => setPanel(null)} aria-label="Đóng" className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-3.5 w-3.5" /></button>
      </div>
      {panel === "issues" ? (
        <>
          {issues.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">Task này chưa có vấn đề nào trong Sổ vấn đề.</p>
          ) : (
            <ul className="divide-y divide-border">
              {issues.map((record) => (
                <li key={record.id}>
                  <Link href={withPrincipal(`/projects/${encodeURIComponent(context.projectId)}?tab=Issues&issueId=${encodeURIComponent(record.id)}`)} className="flex items-center gap-2 py-2 text-xs hover:!text-primary">
                    <span className="shrink-0 font-black text-foreground">{record.code}</span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{ISSUE_LOG_TYPE_LABELS[record.type]}</span>
                    <span className="min-w-0 flex-1 truncate text-foreground" title={record.description}>{record.description}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${record.isOpen ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{ISSUE_LOG_STATUS_LABELS[record.status]}</span>
                    <span className="hidden shrink-0 text-[10px] text-muted-foreground md:inline">{record.ownerDisplayName ?? "Chưa phân công"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href={withPrincipal(`/projects/${encodeURIComponent(context.projectId)}?tab=Issues&reportTask=${encodeURIComponent(task.id)}`)} className={actionClass}>
              <Plus className="h-3.5 w-3.5" /> Báo vấn đề cho task này
            </Link>
          </div>
        </>
      ) : (
        <TaskDocsPanel
          task={{ id: task.id, accountId: context.accountId, projectId: context.projectId }}
          principal={context.principal}
          docs={docs}
          error={docsError}
          onError={setDocsError}
          setDocs={setDocs}
        />
      )}
    </div>
  );

  return { buttons, panel: panelNode };
}

const iconButtonClass = "shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50";

function TaskDocsPanel({ task, principal, docs, error, onError, setDocs }: {
  task: { id: string; accountId?: string; projectId: string };
  principal?: string;
  docs: TaskAttachmentView[] | null;
  error: string | null;
  onError: (message: string | null) => void;
  setDocs: React.Dispatch<React.SetStateAction<TaskAttachmentView[] | null>>;
}) {
  const [linkDraft, setLinkDraft] = useState<{ url: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // One row at a time is being edited or asked about; the other rows keep their actions.
  const [edit, setEdit] = useState<{ id: string; name: string; url: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const add = async (fileInput: Record<string, unknown>, failure: string) => {
    if (!task.accountId) return onError("Không xác định được khách hàng của task.");
    setSaving(true);
    onError(null);
    try {
      const doc = await createTaskAttachment(task, fileInput, principal);
      setDocs((current) => [doc, ...(current ?? [])]);
      setLinkDraft(null);
    } catch {
      onError(failure);
    } finally {
      setSaving(false);
    }
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await add({ fileName: file.name, contentType: file.type || "application/octet-stream", base64Data: await readFileAsBase64(file) }, `Không tải lên được ${file.name}.`);
  };

  const downloadFile = (fileObjectId?: string) => {
    if (fileObjectId) downloadFileObject(fileObjectId).catch(() => onError("Không tải được tập tin."));
  };

  const startEdit = (doc: TaskAttachmentView) => {
    setConfirmDeleteId(null);
    setEdit({ id: doc.id, name: doc.url ? doc.name : splitFileExtension(doc.name).base, url: doc.url ?? "" });
  };

  const saveEdit = async (doc: TaskAttachmentView) => {
    if (!edit) return;
    let input: { fileName?: string; externalUrl?: string };
    if (doc.url) {
      const link = linkFileInput(edit.url, edit.name);
      let fileName = link.fileName;
      try {
        fileName ??= new URL(link.externalUrl).hostname;
      } catch {
        // The API answers an invalid URL with its own error.
      }
      input = { fileName: fileName === doc.name ? undefined : fileName, externalUrl: link.externalUrl === doc.url ? undefined : link.externalUrl };
    } else {
      const base = edit.name.trim().replace(/[\\/]/g, "-");
      const fileName = `${base}${splitFileExtension(doc.name).extension}`;
      input = { fileName: !base || fileName === doc.name ? undefined : fileName };
    }
    if (input.fileName === undefined && input.externalUrl === undefined) return setEdit(null);
    setBusyId(doc.id);
    onError(null);
    try {
      const updated = await updateTaskAttachment(task.id, doc.id, input, principal);
      setDocs((current) => (current ?? []).map((item) => item.id === doc.id ? updated : item));
      setEdit(null);
    } catch {
      onError(doc.url ? "Không lưu được link. Kiểm tra lại đường dẫn (http/https)." : "Không đổi được tên tập tin.");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (doc: TaskAttachmentView) => {
    setBusyId(doc.id);
    onError(null);
    try {
      await deleteTaskAttachment(task.id, doc.id, principal);
      setDocs((current) => (current ?? []).filter((item) => item.id !== doc.id));
      setConfirmDeleteId(null);
    } catch {
      onError(`Không xóa được ${doc.name}.`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {error && <p role="alert" className="mb-2 text-xs text-rose-600">{error}</p>}
      {docs === null ? (
        !error && <p className="py-2 text-xs text-muted-foreground">Đang tải tài liệu…</p>
      ) : docs.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">Chưa có tài liệu đính kèm nào.</p>
      ) : (
        <ul className="divide-y divide-border">
          {docs.map((doc) => {
            const badge = <span className={`flex h-6 w-9 shrink-0 items-center justify-center rounded-md text-[9px] font-bold ${doc.bg} ${doc.color}`}>{doc.ext}</span>;
            const busy = busyId === doc.id;
            if (edit?.id === doc.id) {
              return (
                <li key={doc.id} className="py-2">
                  <form onSubmit={(event) => { event.preventDefault(); void saveEdit(doc); }} className="flex flex-wrap items-center gap-2">
                    {badge}
                    <span className="flex min-w-[160px] flex-1 items-center gap-1">
                      <input autoFocus aria-label="Tên tài liệu" value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })} placeholder={doc.url ? "Tên hiển thị (không bắt buộc)" : "Tên tập tin"} className={`${inputClass} min-w-0 flex-1`} />
                      {!doc.url && <span className="text-xs text-muted-foreground">{splitFileExtension(doc.name).extension}</span>}
                    </span>
                    {doc.url && <input inputMode="url" aria-label="Đường dẫn của link" value={edit.url} onChange={(event) => setEdit({ ...edit, url: event.target.value })} placeholder="https://..." className={`${inputClass} min-w-[200px] flex-[2]`} />}
                    <button type="submit" disabled={busy || (doc.url ? !edit.url.trim() : !edit.name.trim())} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60">{busy ? "Đang lưu" : "Lưu"}</button>
                    <button type="button" onClick={() => setEdit(null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted">Hủy</button>
                  </form>
                </li>
              );
            }
            if (confirmDeleteId === doc.id) {
              return (
                <li key={doc.id} className="flex flex-wrap items-center gap-2.5 py-2">
                  {badge}
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">Xóa <b>{doc.name}</b> khỏi task?</span>
                  <button type="button" onClick={() => void remove(doc)} disabled={busy} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">{busy ? "Đang xóa" : "Xóa"}</button>
                  <button type="button" onClick={() => setConfirmDeleteId(null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted">Hủy</button>
                </li>
              );
            }
            return (
              <li key={doc.id} className="flex items-center gap-2.5 py-2">
                {badge}
                {doc.url ? (
                  <a href={doc.url} target="_blank" rel="noopener noreferrer" title={doc.url} className="min-w-0 flex-1 truncate text-xs font-semibold !text-primary hover:underline">{doc.name}</a>
                ) : (
                  <button type="button" onClick={() => downloadFile(doc.fileObjectId)} title={`Tải về ${doc.name}`} className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-primary hover:underline">{doc.name}</button>
                )}
                <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">{doc.url ? "Link" : doc.size} · {doc.date}</span>
                <button type="button" onClick={() => startEdit(doc)} aria-label={`Sửa ${doc.name}`} title="Sửa" className={iconButtonClass}><Pencil className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => { setEdit(null); setConfirmDeleteId(doc.id); }} aria-label={`Xóa ${doc.name}`} title="Xóa" className={`${iconButtonClass} hover:!bg-rose-50 hover:!text-rose-600`}><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            );
          })}
        </ul>
      )}
      {linkDraft ? (
        <form onSubmit={(event) => { event.preventDefault(); if (linkDraft.url.trim()) void add(linkFileInput(linkDraft.url, linkDraft.name), "Không thể đính kèm link. Kiểm tra lại đường dẫn (http/https)."); }} className="mt-2 flex flex-wrap items-center gap-2">
          <input autoFocus inputMode="url" aria-label="Đường dẫn" value={linkDraft.url} onChange={(event) => setLinkDraft({ ...linkDraft, url: event.target.value })} placeholder="Dán link (https://...)" className={`${inputClass} min-w-[200px] flex-[2]`} />
          <input aria-label="Tên hiển thị" value={linkDraft.name} onChange={(event) => setLinkDraft({ ...linkDraft, name: event.target.value })} placeholder="Tên hiển thị (không bắt buộc)" className={`${inputClass} min-w-[140px] flex-1`} />
          <button type="submit" disabled={saving || !linkDraft.url.trim()} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60">{saving ? "Đang lưu" : "Thêm link"}</button>
          <button type="button" onClick={() => setLinkDraft(null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted">Hủy</button>
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <label className={`${actionClass} cursor-pointer ${saving ? "pointer-events-none opacity-60" : ""}`}>
            <input type="file" className="sr-only" onChange={(event) => void handleFile(event)} disabled={saving} />
            <Upload className="h-3.5 w-3.5" /> {saving ? "Đang tải lên…" : "Tải file"}
          </label>
          <button type="button" onClick={() => setLinkDraft({ url: "", name: "" })} className={actionClass}>
            <Link2 className="h-3.5 w-3.5" /> Đính kèm link
          </button>
        </div>
      )}
    </>
  );
}

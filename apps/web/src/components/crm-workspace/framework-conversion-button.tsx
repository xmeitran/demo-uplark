"use client";

/**
 * Table 9.1: an Admin moves ONE running project onto the TPL-001 framework. The dialog shows the dry run the API
 * computed (GET) and applies it on confirmation (POST, which writes a backup first). Shown only to Admins, and only
 * while the project has something to convert or its position still has to be confirmed.
 */
import { useCallback, useEffect, useState } from "react";
import { apiErrorMessage, readApiError } from "@/lib/api-error";
import { useAuth } from "@/lib/auth";
import { isAdminView } from "@/lib/auth-role";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { CrmSelect } from "./crm-select";

interface ConversionPlan {
  position: string;
  positionLabel: string;
  handling: string;
  steps: string[];
  notes: string[];
  operations: unknown[];
}

// The PM's answer when the system cannot tell where the project stands (PROJECT_POSITIONS in legacy-conversion.ts).
const POSITION_OPTIONS = [["before_g1", "Chưa qua G1"], ["milestone_2", "Đang ở Milestone 2"], ["milestone_3_4", "Đang ở Milestone 3 hoặc 4"]] as const;

function endpoint(projectId: string, position: string) {
  const query = new URLSearchParams();
  const principal = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("principal")?.trim();
  if (principal) query.set("principal", principal);
  if (position) query.set("position", position);
  return `/api/projects/${encodeURIComponent(projectId)}/framework-conversion${query.size ? `?${query}` : ""}`;
}

export function FrameworkConversionButton({ projectId, className = "" }: { projectId: string; className?: string }) {
  const { user } = useAuth();
  const isAdmin = isAdminView(user);
  const [plan, setPlan] = useState<ConversionPlan | null>(null);
  // Set once the system answered "Không xác định": the Admin then picks the position the PM confirmed.
  const [needsPosition, setNeedsPosition] = useState(false);
  const [position, setPosition] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupDirectory, setBackupDirectory] = useState<string | null>(null);

  const load = useCallback(async (nextPosition: string, signal?: AbortSignal) => {
    try {
      const response = await fetch(endpoint(projectId, nextPosition), { cache: "no-store", credentials: "same-origin", signal });
      if (!response.ok) throw await readApiError(response);
      const body = (await response.json()) as { plan: ConversionPlan };
      setPlan(body.plan);
      if (body.plan.position === "unknown") setNeedsPosition(true);
      setError(null);
    } catch (failure) {
      if (!signal?.aborted && nextPosition) setError(apiErrorMessage(failure, "Không tải được bản xem trước chuyển đổi."));
    }
  }, [projectId]);

  useEffect(() => {
    if (!isAdmin) return;
    const controller = new AbortController();
    void load("", controller.signal);
    return () => controller.abort();
  }, [isAdmin, load]);

  if (!isAdmin || !plan || (!plan.operations.length && !needsPosition && !backupDirectory)) return null;
  const canApply = plan.operations.length > 0 && !backupDirectory;

  const apply = async () => {
    if (!canApply) return backupDirectory ? window.location.reload() : setOpen(false);
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(endpoint(projectId, ""), { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(position ? { position } : {}) });
      if (!response.ok) throw await readApiError(response);
      setBackupDirectory(((await response.json()) as { backupDirectory?: string }).backupDirectory ?? "");
    } catch (failure) {
      setError(apiErrorMessage(failure, "Không chuyển đổi được. Chưa có gì thay đổi."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={className}>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border px-3 text-xs font-bold text-muted-foreground transition hover:bg-muted">
        Chuyển sang khung TPL-001
      </button>
      {open ? (
        <ConfirmActionDialog
          title="Chuyển sang khung TPL-001"
          tone={canApply ? "warning" : "info"}
          loading={saving}
          confirmLabel={backupDirectory !== null ? "Tải lại trang" : canApply ? "Áp dụng chuyển đổi" : "Đóng"}
          cancelLabel="Đóng"
          onCancel={() => (backupDirectory !== null ? window.location.reload() : setOpen(false))}
          onConfirm={apply}
        >
          {backupDirectory !== null ? (
            <p>Đã chuyển đổi. Bản sao lưu để hoàn tác nằm tại <code className="break-all">{backupDirectory}</code>.</p>
          ) : (
            <div className="space-y-2 text-left text-sm">
              <p><strong>Vị trí:</strong> {plan.positionLabel}. <strong>Cách xử lý (bảng 9.1):</strong> {plan.handling}.</p>
              {needsPosition ? (
                <div className="text-xs font-semibold text-muted-foreground">
                  <span className="mb-1 block">Vị trí do PM xác nhận</span>
                  <CrmSelect
                    ariaLabel="Vị trí do PM xác nhận"
                    value={position}
                    onChange={(value) => { setPosition(value); void load(value); }}
                    options={[{ value: "", label: "Chưa xác nhận" }, ...POSITION_OPTIONS.map(([value, label]) => ({ value, label }))]}
                  />
                </div>
              ) : null}
              {plan.steps.length ? <ul className="list-disc space-y-1 pl-5">{plan.steps.map((step) => <li key={step}>{step}</li>)}</ul> : <p>Không có gì để chuyển đổi.</p>}
              {plan.notes.map((note) => <p key={note} className="text-xs text-amber-700">{note}</p>)}
              {canApply ? <p className="text-xs text-muted-foreground">Hệ thống sao lưu dữ liệu của dự án trước khi áp dụng; có thể hoàn tác từ bản sao lưu.</p> : null}
              {error ? <p role="alert" className="text-xs text-rose-600">{error}</p> : null}
            </div>
          )}
        </ConfirmActionDialog>
      ) : null}
    </div>
  );
}

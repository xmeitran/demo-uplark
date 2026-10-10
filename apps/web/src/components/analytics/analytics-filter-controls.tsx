"use client";

import React, { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import type { AnalyticsFilterOption, WorkforceProjectsSummaryResponse } from "@b2b-crm/contracts";
import { CrmMultiSelect, CrmSelect } from "@/components/crm-workspace/crm-select";
import { AdvancedFilters, DateRangeFilter, FilterBar, FilterField } from "@/components/filters/filter-controls";
import type { DateRangePreset } from "@/components/filters/filter-dates";
import {
  ANALYTICS_DEFAULT_STATE,
  countActiveFilters,
  exclusiveEndDateToInclusiveEndDate,
  inclusiveEndDateToExclusiveEndDate,
  resolvePresetRange,
  type AnalyticsPreset,
  type AnalyticsUiState
} from "@/lib/analytics-url-state";
import { businessStatusLabel } from "./analytics-copy";

const PRESET_OPTIONS: Array<{ id: Exclude<AnalyticsPreset, "custom">; label: string }> = [
  { id: "7d", label: "7 ngày gần nhất" },
  { id: "30d", label: "30 ngày gần nhất" },
  { id: "90d", label: "90 ngày gần nhất" },
  { id: "month", label: "Tháng này" },
  { id: "quarter", label: "Quý này" }
];

const GRAIN_OPTIONS: Array<{ value: AnalyticsUiState["grain"]; label: string }> = [
  { value: "day", label: "Theo ngày" },
  { value: "week", label: "Theo tuần" },
  { value: "month", label: "Theo tháng" }
];

const BILLABLE_OPTIONS: Array<{ value: AnalyticsUiState["billable"]; label: string }> = [
  { value: "all", label: "Tất cả loại giờ" },
  { value: "billable", label: "Có tính phí" },
  { value: "non_billable", label: "Không tính phí" }
];

/** The state's range as inclusive days; analytics keeps an exclusive end in the URL. */
function inclusiveRange(state: AnalyticsUiState) {
  const range = resolvePresetRange(state);
  return { from: range.from, to: exclusiveEndDateToInclusiveEndDate(range.to) ?? range.to };
}

/**
 * The house multi-select with this screen's "apply" behaviour: ticks are shown at once but
 * sent together after a short pause, so each tick does not reload the report. `immediate`
 * is for the mobile sheet, which already has its own "Áp dụng".
 * A filter with fewer than two options is hidden unless it is already set.
 */
function AppliedMultiSelect({ label, options, selected, onApply, mapLabel, immediate }: {
  label: string;
  options: AnalyticsFilterOption[];
  selected: string[];
  onApply: (ids: string[]) => void;
  mapLabel?: (value: string) => string;
  immediate: boolean;
}) {
  const [draft, setDraft] = useState(selected);
  const timer = useRef<number | undefined>(undefined);
  const apply = useRef(onApply);
  apply.current = onApply;
  const selectedKey = selected.join(",");
  useEffect(() => { setDraft(selectedKey ? selectedKey.split(",") : []); }, [selectedKey]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (options.length < 2 && selected.length === 0) return null;
  return (
    <FilterField label={label}>
      <CrmMultiSelect
        ariaLabel={label}
        placeholder="Tất cả"
        searchPlaceholder={`Tìm ${label.toLocaleLowerCase("vi")}…`}
        options={options.map((option) => ({ value: option.id, label: mapLabel ? mapLabel(option.label) : option.label, meta: option.count === undefined ? undefined : String(option.count) }))}
        values={draft}
        onChange={(values) => {
          setDraft(values);
          window.clearTimeout(timer.current);
          if (immediate) apply.current(values);
          else timer.current = window.setTimeout(() => apply.current(values), 600);
        }}
      />
    </FilterField>
  );
}

export function AnalyticsFilterControls({ state, summary, onChange, onReset, onExportCsv, csvReady, mode = "desktop" }: {
  state: AnalyticsUiState;
  summary?: WorkforceProjectsSummaryResponse;
  onChange: (change: Partial<AnalyticsUiState>) => void;
  onReset: () => void;
  onExportCsv: () => void;
  csvReady: boolean;
  mode?: "desktop" | "mobile";
}) {
  const options = summary?.filterOptions;
  const inline = mode === "mobile";
  const projectOptions = (options?.projects ?? []).filter((project) => state.accountIds.length === 0 || Boolean(project.parentId && state.accountIds.includes(project.parentId)));
  const advancedCount = state.departmentIds.length + state.teamIds.length + state.userIds.length + state.projectStatuses.length + state.taskStatuses.length + state.workTypes.length + state.taskTypeLayer1Ids.length + state.taskTypeLayer2Ids.length + (state.billable === "all" ? 0 : 1);
  const presets: DateRangePreset[] = PRESET_OPTIONS.map((preset) => ({ ...preset, ...inclusiveRange({ ...state, preset: preset.id }) }));
  const dirty = countActiveFilters(state) > 0 || state.grain !== ANALYTICS_DEFAULT_STATE.grain;

  const main = (
    <>
      <FilterField label="Thời gian" className={inline ? "" : "shrink-0"}>
        <DateRangeFilter
          ariaLabel="Thời gian"
          maxDays={366}
          presets={presets}
          value={inclusiveRange(state)}
          onChange={(range, presetId) => onChange(presetId ? { preset: presetId as AnalyticsPreset } : { preset: "custom", from: range.from, to: inclusiveEndDateToExclusiveEndDate(range.to) })}
        />
      </FilterField>
      <FilterField label="Mức tổng hợp" className={inline ? "" : "w-40"}>
        <CrmSelect ariaLabel="Mức tổng hợp" options={GRAIN_OPTIONS} value={state.grain} onChange={(grain) => onChange({ grain: grain as AnalyticsUiState["grain"] })} />
      </FilterField>
      <AppliedMultiSelect immediate={inline} label="Khách hàng" options={options?.accounts ?? []} selected={state.accountIds} onApply={(accountIds) => {
        const validProjects = state.projectIds.filter((projectId) => {
          const project = (options?.projects ?? []).find((item) => item.id === projectId);
          return accountIds.length === 0 || Boolean(project?.parentId && accountIds.includes(project.parentId));
        });
        onChange({ accountIds, projectIds: validProjects });
      }} />
      <AppliedMultiSelect immediate={inline} label="Dự án" options={projectOptions} selected={state.projectIds.filter((id) => projectOptions.some((project) => project.id === id))} onApply={(projectIds) => onChange({ projectIds })} />
      <label className="flex h-10 items-center gap-2 rounded-[10px] border border-border px-3 text-[12px] font-semibold text-foreground">
        <input type="checkbox" checked={state.compare === "previous"} onChange={(event) => onChange({ compare: event.target.checked ? "previous" : "none" })} className="h-4 w-4 accent-[var(--color-primary)]" />
        So sánh với kỳ trước
      </label>
    </>
  );
  const advanced = (
    <>
      <AppliedMultiSelect immediate={inline} label="Phòng ban" options={options?.departments ?? []} selected={state.departmentIds} onApply={(departmentIds) => onChange({ departmentIds })} />
      <AppliedMultiSelect immediate={inline} label="Nhóm" options={options?.teams ?? []} selected={state.teamIds} onApply={(teamIds) => onChange({ teamIds })} />
      <AppliedMultiSelect immediate={inline} label="Nhân sự" options={options?.users ?? []} selected={state.userIds} onApply={(userIds) => onChange({ userIds })} />
      <AppliedMultiSelect immediate={inline} label="Trạng thái dự án" options={options?.projectStatuses ?? []} selected={state.projectStatuses} onApply={(projectStatuses) => onChange({ projectStatuses })} mapLabel={businessStatusLabel} />
      <AppliedMultiSelect immediate={inline} label="Trạng thái công việc" options={options?.taskStatuses ?? []} selected={state.taskStatuses} onApply={(taskStatuses) => onChange({ taskStatuses })} mapLabel={businessStatusLabel} />
      <AppliedMultiSelect immediate={inline} label="Loại công việc" options={options?.workTypes ?? []} selected={state.workTypes} onApply={(workTypes) => onChange({ workTypes })} mapLabel={businessStatusLabel} />
      <AppliedMultiSelect immediate={inline} label="Task Type · Nhóm" options={options?.taskTypeLayer1 ?? []} selected={state.taskTypeLayer1Ids} onApply={(taskTypeLayer1Ids) => onChange({ taskTypeLayer1Ids })} />
      <AppliedMultiSelect immediate={inline} label="Task Type · Bối cảnh" options={options?.taskTypeLayer2 ?? []} selected={state.taskTypeLayer2Ids} onApply={(taskTypeLayer2Ids) => onChange({ taskTypeLayer2Ids })} />
      <FilterField label="Loại giờ">
        <CrmSelect ariaLabel="Loại giờ" options={BILLABLE_OPTIONS} value={state.billable} onChange={(billable) => onChange({ billable: billable as AnalyticsUiState["billable"] })} />
      </FilterField>
    </>
  );
  const exportButton = (
    <button type="button" onClick={onExportCsv} disabled={!csvReady} className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[12px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
      <Download className="h-3.5 w-3.5" aria-hidden /> Xuất dữ liệu
    </button>
  );

  // The mobile sheet stacks every filter and has its own "Đặt lại" / "Áp dụng" footer.
  if (inline) return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{main}{advanced}{exportButton}</div>;

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <FilterBar onReset={dirty ? onReset : undefined} actions={exportButton}>
        {main}
        <AdvancedFilters count={advancedCount}>{advanced}</AdvancedFilters>
      </FilterBar>
    </div>
  );
}

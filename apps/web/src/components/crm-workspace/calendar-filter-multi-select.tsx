"use client";

import { CrmMultiSelect } from "./crm-select";
import type { CalendarFilterOption } from "@/lib/calendar-filters";

export function CalendarFilterMultiSelect({
  id,
  label,
  allLabel,
  countLabel,
  icon,
  options,
  selectedIds,
  onChange
}: {
  id: string;
  label: string;
  allLabel: string;
  countLabel: (count: number) => string;
  icon: "project" | "member";
  options: CalendarFilterOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <CrmMultiSelect
      id={id}
      ariaLabel={label}
      label={label}
      options={options.map((option) => ({
        value: option.value,
        label: option.label,
        meta: option.subtext,
        avatarUrl: icon === "member" ? option.avatarUrl : undefined,
        initials: icon === "member" ? option.initials : undefined,
        color: icon === "member" ? option.color : undefined,
        icon: icon === "project" ? "briefcase" : undefined
      }))}
      placeholder={allLabel}
      selectedCountLabel={countLabel}
      values={selectedIds}
      onChange={onChange}
    />
  );
}

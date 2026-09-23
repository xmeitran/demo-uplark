"use client";
import { MoneyAmount } from "@/components/money-amount";
import { useDialogAccessibility } from "@/hooks/use-dialog-accessibility";
import { formatVnd } from "@/lib/currency";


import React, { useState, useEffect, useMemo, useRef, useId } from "react";
import { createPortal } from "react-dom";
import type {
  AdminAccessMemberSummary,
  AdminAccessMembersResponse,
  AccountsResponse,
  AccountUsageReviewSummary,
  CapacitySummaryItem,
  CapacitySummaryResponse,
  OpportunitySummary,
  ProjectSummary,
  ContactSummary,
  ResourceListResponse
} from "@b2b-crm/contracts";
import { PolarisFallbackText, ShopifyDataTable, ShopifyIcon, ShopifySection } from "../shopify-ui";
import type { ShopifyIconName } from "../shopify-ui";
import { ModalLayer } from "../modal-layer";

// Formatting helpers with decimal detection
function formatDecimalVnd(value: number) {
  return formatVnd(value);
}

function formatDecimalNumber(value: number) {
  const hasDecimal = value % 1 !== 0;
  return new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: hasDecimal ? 2 : 0,
    maximumFractionDigits: 2
  }).format(value);
}

function formatVndInputValue(value: string | number | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return new Intl.NumberFormat("vi-VN").format(Number(digits));
}

function parseVndInputValue(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

function getAccountInitials(name?: string) {
  const parts = String(name || "KH")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (parts.length ? parts.slice(0, 2).map(part => part[0]).join("") : "KH").toUpperCase();
}

// Compact formatted representation for large numbers (keeps decimal if any)

const accountStageLabels: Record<string, string> = {
  prospect: "Khảo sát",
  qualified: "Đủ điều kiện",
  proposal: "Đề xuất",
  implementation: "Triển khai",
  active: "Đang hoạt động",
  at_risk: "Rủi ro",
  churned: "Ngừng hoạt động"
};

const accountHealthLabels: Record<string, string> = {
  green: "Ổn định",
  amber: "Cần chú ý",
  red: "Rủi ro cao"
};

const opportunityStageLabels: Record<string, string> = {
  discovery: "Khảo sát",
  proposal: "Đề xuất",
  negotiation: "Đàm phán",
  implementation: "Triển khai",
  won: "Đã thắng",
  lost: "Đã mất"
};

const forecastLabels: Record<string, string> = {
  pipeline: "Đang theo dõi",
  best_case: "Có tiềm năng",
  commit: "Cam kết",
  closed_won: "Đã thắng",
  closed_lost: "Đã mất"
};

const confidenceLabels: Record<string, string> = {
  high: "Cao",
  medium: "Vừa",
  low: "Thấp"
};

const contactInfluenceLabels: Record<string, string> = {
  economic_buyer: "Người quyết định",
  champion: "Người ủng hộ",
  detractor: "Đang rủi ro",
  neutral: "Liên hệ chính"
};

const projectStatusLabels: Record<string, string> = {
  planning: "Lên kế hoạch",
  active: "Đang triển khai",
  completed: "Hoàn tất",
  blocked: "Đang nghẽn"
};

function formatAccountStage(stage?: string) {
  if (!stage) return "Chưa rõ";
  return accountStageLabels[stage] ?? stage;
}

const accountStageOptions = [
  { value: "prospect", label: "Khảo sát", icon: "search" },
  { value: "qualified", label: "Đủ điều kiện", icon: "checkmark", iconTone: "info" },
  { value: "proposal", label: "Đề xuất", icon: "star" },
  { value: "implementation", label: "Triển khai", icon: "settings", iconTone: "info" },
  { value: "active", label: "Đang hoạt động", icon: "checkmark", iconTone: "success" },
  { value: "at_risk", label: "Rủi ro", icon: "alert-circle", iconTone: "critical" },
  { value: "churned", label: "Ngừng hoạt động", icon: "alert", iconTone: "critical" }
];

const ownerTeamOptions = [
  { value: "team-sales-services", label: "Sales Services", icon: "users" },
  { value: "", label: "Chưa gán đội", icon: "alert", iconTone: "warning" }
];

type AccountDropdownOption = {
  value: string;
  label: string;
  icon?: string;
  iconTone?: string;
  meta?: string;
};

function getHealthFromAccountStage(stage: string) {
  if (stage === "implementation" || stage === "active") return "green";
  if (stage === "at_risk" || stage === "churned") return "red";
  return "amber";
}

function getOwnerTeamIdFromLabel(label?: string) {
  if (!label || label === "Unassigned") return "";
  const match = ownerTeamOptions.find(option => option.label === label);
  return match?.value ?? "";
}

function getAccountPicName(account: { picName?: string; ownerTeam?: string }) {
  return account.picName || account.ownerTeam || "Chưa gán PIC";
}

function getRoleLabel(roleCode: string) {
  const labels: Record<string, string> = {
    FOUNDER_GM: "Founder/GM",
    SALES_OWNER: "Phụ trách bán hàng",
    DELIVERY_LEAD: "Lead triển khai",
    FINANCE_ADMIN: "Phụ trách tài chính",
    CUSTOMER_SUCCESS: "Chăm sóc khách hàng"
  };
  return labels[roleCode] ?? "Nội bộ";
}

function getMemberPicMeta(member: AdminAccessMemberSummary) {
  if (member.resourceDisplayRole) return member.resourceDisplayRole;
  const roles = member.roleCodes.map(getRoleLabel).filter(Boolean);
  if (roles.length > 0) return roles.join(", ");
  return member.departmentCode || member.email;
}

function getAccountPicOptions(resources: CapacitySummaryItem[], members: AdminAccessMemberSummary[] = []) {
  const optionsByUser = new Map<string, AccountDropdownOption>();

  members
    .filter((member) => member.subjectType === "internal" && member.status === "active")
    .forEach((member) => {
      optionsByUser.set(member.id, {
        value: member.id,
        label: member.displayName || member.email || member.id,
        icon: "users",
        meta: getMemberPicMeta(member)
      });
    });

  resources
    .filter(resource => resource.userId)
    .forEach(resource => {
      optionsByUser.set(resource.userId, {
        value: resource.userId,
        label: resource.userDisplayName || resource.userEmail || resource.userId,
        icon: "users",
        meta: resource.displayRole || resource.departmentCode || resource.userEmail
      });
    });

  return [
    { value: "", label: "Chưa gán PIC", icon: "alert", iconTone: "warning" },
    ...Array.from(optionsByUser.values()).sort((left, right) => left.label.localeCompare(right.label, "vi"))
  ];
}

async function readApiError(response: Response) {
  try {
    const body = await response.json();
    const message = body?.message;
    if (Array.isArray(message)) return message.join(", ");
    if (typeof message === "string") return message;
  } catch {
    // Fall through to generic status below.
  }
  return `Yêu cầu thất bại (${response.status}).`;
}

async function loadAccountPicMembers() {
  const response = await fetch("/api/admin/members", { cache: "no-store" });
  if (!response.ok) return [];
  const payload = await response.json() as AdminAccessMembersResponse;
  return payload.data ?? [];
}

function formatAccountHealth(health?: string) {
  if (!health) return "Chưa rõ";
  return accountHealthLabels[health] ?? health;
}

function formatOpportunityStage(stage?: string) {
  if (!stage) return "Chưa rõ";
  return opportunityStageLabels[stage] ?? stage;
}

function formatForecastCategory(value?: string) {
  if (!value) return "Chưa rõ";
  return forecastLabels[value] ?? value;
}

function formatConfidence(value?: string) {
  if (!value) return "Chưa rõ";
  return confidenceLabels[value] ?? value;
}

function formatContactInfluence(value?: string) {
  if (!value) return "Liên hệ chính";
  return contactInfluenceLabels[value] ?? "Liên hệ chính";
}

function getContactInfluenceTone(value?: string) {
  if (value === "economic_buyer" || value === "champion") return "success";
  if (value === "detractor") return "danger";
  return "neutral";
}

function formatProjectStatus(value?: string) {
  if (!value) return "Chưa rõ";
  return projectStatusLabels[value] ?? "Chưa rõ";
}

function getProjectStatusTone(value?: string) {
  if (value === "active" || value === "completed") return "success";
  if (value === "blocked") return "danger";
  return "neutral";
}

function formatReviewMonth(value?: string) {
  if (!value) return "Chưa rõ";
  const [year, month] = value.split("-");
  return year && month ? `Tháng ${month}/${year}` : value;
}

function formatShortDate(value?: string) {
  if (!value) return "Chưa có";
  return new Date(value).toLocaleDateString("vi-VN");
}

function getAccountDropdownIcon(name?: string): ShopifyIconName | null {
  switch (name) {
    case "alert-circle":
    case "alert":
      return "alert";
    case "cash-dollar":
      return "cash";
    case "checkmark":
    case "check":
      return "check";
    case "order":
      return "briefcase";
    case "person":
      return "users";
    case "settings":
      return "filter";
    case "share":
      return "trend";
    case "star":
    case "spark":
      return "spark";
    case "box":
      return "briefcase";
    case "clock":
    case "search":
      return name;
    default:
      return null;
  }
}

function getAccountDropdownIconColor(tone?: string) {
  switch (tone) {
    case "critical":
      return "var(--danger)";
    case "success":
      return "var(--success)";
    case "warning":
      return "var(--warning)";
    case "info":
      return "var(--brand-blue)";
    default:
      return "var(--text-muted)";
  }
}

// Custom Premium Dropdown Component
function CustomDropdown({
  label,
  value,
  options,
  onChange,
  searchable = false,
  searchPlaceholder = "Tìm kiếm..."
}: {
  label: string;
  value: string;
  options: AccountDropdownOption[];
  onChange: (val: string) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedOpt = options.find((o) => o.value === value) ?? options[0];
  const selectedIcon = getAccountDropdownIcon(selectedOpt?.icon);
  const selectedIconColor = getAccountDropdownIconColor(selectedOpt?.iconTone);
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!searchable || !normalizedQuery) return options;
    return options.filter((option) => {
      const haystack = `${option.label} ${option.meta ?? ""}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [options, query, searchable]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative", display: "flex", flexDirection: "column", gap: "var(--space-1)", flex: 1 }}>
      <span style={{ fontSize: "11px", fontWeight: 400, textTransform: "none", color: "var(--text-muted)", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
          padding: "var(--space-2) var(--space-3)",
          borderRadius: "var(--radius-sm)",
          border: `1px solid ${open ? "var(--accent)" : "var(--border)"}`,
          background: "var(--panel-strong)",
          color: "var(--text)",
          fontSize: "13px",
          fontWeight: 400,
          cursor: "pointer",
          textAlign: "left",
          transition: "all 0.2s ease",
          outline: "none"
        }}
        type="button"
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          {selectedIcon && (
            <span style={{ color: selectedIconColor, display: "inline-flex" }}>
              <ShopifyIcon name={selectedIcon} size={14} className="accounts-dropdown-icon" />
            </span>
          )}
          <span style={{ fontWeight: 600 }}>{selectedOpt?.label}</span>
        </div>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {open && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          width: "100%",
          marginTop: "var(--space-1)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          background: "var(--panel)",
          boxShadow: "var(--shadow-panel)",
          zIndex: 100,
          maxHeight: "220px",
          overflowY: "auto",
          padding: "var(--space-1)",
          animation: "shopify-section-enter 150ms ease-out"
        }}>
          {searchable ? (
            <div style={{ padding: "var(--space-1)" }}>
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setOpen(false);
                  }
                }}
                placeholder={searchPlaceholder}
                style={{
                  width: "100%",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--panel-strong)",
                  color: "var(--text)",
                  fontSize: "13px",
                  outline: "none",
                  padding: "var(--space-2) var(--space-3)"
                }}
              />
            </div>
          ) : null}
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt) => {
              const optionIcon = getAccountDropdownIcon(opt.icon);
              const optionIconColor = getAccountDropdownIconColor(opt.iconTone);
              return (
              <button
                key={opt.value}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChange(opt.value);
                  setOpen(false);
                }}
                role="option"
                aria-selected={opt.value === value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  width: "100%",
                  padding: "var(--space-2) var(--space-3)",
                  borderRadius: "var(--radius-sm)",
                  border: "none",
                  background: opt.value === value ? "var(--accent-soft)" : "transparent",
                  color: opt.value === value ? "var(--accent)" : "var(--text)",
                  fontSize: "13px",
                  fontWeight: opt.value === value ? 600 : 400,
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.1s ease",
                  outline: "none"
                }}
                type="button"
              >
                {optionIcon && (
                  <span style={{ color: optionIconColor, display: "inline-flex" }}>
                    <ShopifyIcon name={optionIcon} size={14} className="accounts-dropdown-icon" />
                  </span>
                )}
                <span style={{ flex: 1, display: "grid", gap: "2px", minWidth: 0 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.label}</span>
                  {opt.meta ? (
                    <small style={{ color: "var(--text-muted)", fontSize: "11px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {opt.meta}
                    </small>
                  ) : null}
                </span>
                {opt.value === value && (
                  <span style={{ color: "var(--success)", display: "inline-flex" }}>
                    <ShopifyIcon name="check" size={14} />
                  </span>
                )}
              </button>
              );
            })
          ) : (
            <div style={{ padding: "var(--space-3)", color: "var(--text-muted)", fontSize: "13px" }}>
              Không tìm thấy nhân sự phù hợp.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Tab Header Button Component
function TabHeader({
  active,
  onClick,
  label,
  icon
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button 
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1,
        padding: "var(--space-3) var(--space-2)",
        border: "none",
        background: active ? "var(--panel)" : hovered ? "rgba(0, 0, 0, 0.02)" : "transparent",
        color: active ? "var(--accent)" : hovered ? "var(--text)" : "var(--text-muted)",
        fontSize: "12.5px",
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        borderBottom: active ? "2.5px solid var(--accent)" : "2.5px solid transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-2)",
        transition: "all 0.2s ease",
        outline: "none"
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// Floating Toast Notification Icon Helper
function ToastIcon({ type }: { type: "success" | "danger" | "info" }) {
  if (type === "success") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: "4px" }}>
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    );
  }
  if (type === "danger") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: "4px" }}>
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="15" y1="9" x2="9" y2="15"></line>
        <line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: "4px" }}>
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="16" x2="12" y2="12"></line>
      <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>
  );
}

// Modal component wrapper
function Modal({
  isOpen,
  onClose,
  title,
  children,
  variant = "compact"
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  variant?: "compact" | "workspace";
}) {
  const dialogRef = useDialogAccessibility(isOpen, onClose);

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  return (
    <ModalLayer onClose={onClose}>
    <div 
      className={`accounts-modal-backdrop ${variant === "workspace" ? "workspace" : ""}`}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.62)",
        backdropFilter: "blur(8px)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflowY: "auto",
        padding: variant === "workspace" ? "24px" : "40px 0"
      }} 
      onClick={onClose}
    >
      <div 
        ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        className={`accounts-modal-surface ${variant === "workspace" ? "workspace" : ""}`}
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-panel)",
          width: variant === "workspace" ? "min(920px, calc(100vw - 48px))" : "90%",
          maxWidth: variant === "workspace" ? "920px" : "540px",
          maxHeight: "calc(100dvh - 48px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
        }} 
        onClick={e => e.stopPropagation()}
      >
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--space-4)",
          borderBottom: "1px solid var(--border)",
          background: "var(--panel-strong)"
        }}>
          <h3 style={{ fontSize: "15px", fontWeight: 600, color: "var(--text)", margin: 0 }}>{title}</h3>
          <button aria-label={`Close ${title}`} type="button" onClick={onClose} style={{
            minWidth: "44px", minHeight: "44px",
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            padding: "4px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            outlineOffset: "2px"
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div style={{
          padding: "var(--space-4)",
          overflow: "auto",
          flex: 1
        }}>
          {children}
        </div>
      </div>
    </div>
    </ModalLayer>
  );
}

// Custom Input field
function FormField({
  label,
  value,
  onChange,
  type = "text",
  placeholder = "",
  disabled = false,
  required = false,
  inputMode
}: {
  label: string;
  value: string;
  onChange: (e: any) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const fieldId = useId();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      <label htmlFor={fieldId} style={{ fontSize: "11px", fontWeight: 500, color: "var(--text-muted)", letterSpacing: "0.02em" }}>
        {label} {required && <span style={{ color: "var(--danger)" }}>*</span>}
      </label>
      <input
        id={fieldId}
        required={required}
        type={type}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        inputMode={inputMode}
        style={{
          padding: "var(--space-2) var(--space-3)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          background: disabled ? "var(--panel-muted)" : "var(--panel-strong)",
          color: disabled ? "var(--text-muted)" : "var(--text)",
          fontSize: "13px",
          outlineOffset: "2px",
          width: "100%"
        }}
      />
    </div>
  );
}

// Custom Textarea field
function FormTextArea({
  label,
  value,
  onChange,
  placeholder = "",
  rows = 3
}: {
  label: string;
  value: string;
  onChange: (e: any) => void;
  placeholder?: string;
  rows?: number;
}) {
  const fieldId = useId();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      <label htmlFor={fieldId} style={{ fontSize: "11px", fontWeight: 500, color: "var(--text-muted)", letterSpacing: "0.02em" }}>
        {label}
      </label>
      <textarea
        id={fieldId}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
        style={{
          padding: "var(--space-2) var(--space-3)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          background: "var(--panel-strong)",
          color: "var(--text)",
          fontSize: "13px",
          outlineOffset: "2px",
          width: "100%",
          resize: "vertical"
        }}
      />
    </div>
  );
}

// Create Account Form Dialog
function CreateAccountModal({
  isOpen,
  onClose,
  resources,
  members,
  onSave
}: {
  isOpen: boolean;
  onClose: () => void;
  resources: CapacitySummaryItem[];
  members: AdminAccessMemberSummary[];
  onSave: (data: any) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState("prospect");
  const [picUserId, setPicUserId] = useState("");
  const [annualValue, setAnnualValue] = useState("");
  const [commercialNotes, setCommercialNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const previewHealth = getHealthFromAccountStage(stage);
  const picOptions = getAccountPicOptions(resources, members);
  const selectedPicLabel = picOptions.find(option => option.value === picUserId)?.label ?? "Chưa gán PIC";

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setError("");
    const normalizedCode = code.trim().toUpperCase();
    if (!name.trim() || !normalizedCode) {
      setError("Cần nhập tên khách hàng và tên viết tắt.");
      return;
    }
    if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(normalizedCode)) {
      setError("Tên viết tắt cần dùng A-Z, 0-9 hoặc dấu gạch ngang, dài 2-32 ký tự.");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        code: normalizedCode,
        stage,
        picUserId: picUserId || undefined,
        annualValue: parseVndInputValue(annualValue),
        commercialNote: commercialNotes.trim() || undefined
      });
      setName("");
      setCode("");
      setStage("prospect");
      setPicUserId("");
      setAnnualValue("");
      setCommercialNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tạo khách hàng. Vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Tạo khách hàng" variant="workspace">
      <form onSubmit={handleSubmit} className="accounts-account-form">
        <div className="accounts-form-preview">
          <div>
            <span>Preview</span>
            <strong>{name.trim() || "Khách hàng mới"}</strong>
            <small>{code.trim().toUpperCase() || "CHUA-CO-MA"} · PIC: {selectedPicLabel}</small>
          </div>
          <div className="accounts-form-preview-badges">
            <s-badge tone={previewHealth === "green" ? "success" : previewHealth === "red" ? "critical" : "warning"}>
              {formatAccountHealth(previewHealth)}
            </s-badge>
            <s-badge tone="info">{formatAccountStage(stage)}</s-badge>
          </div>
        </div>

        {error ? <div className="accounts-form-error">{error}</div> : null}

        <section className="accounts-form-section">
          <span className="accounts-form-section-title">Thông tin cơ bản</span>
          <div className="accounts-form-grid">
            <FormField label="Tên khách hàng" value={name} onChange={e => setName(e.target.value)} placeholder="VD: Công ty khách hàng" required />
            <FormField label="Tên viết tắt" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="VD: ACC-CUSTOMER" required />
          </div>
        </section>

        <section className="accounts-form-section">
          <span className="accounts-form-section-title">Phụ trách & giá trị</span>
          <div className="accounts-form-grid">
            <CustomDropdown
              label="PIC"
              value={picUserId}
              options={picOptions}
              onChange={setPicUserId}
              searchable
              searchPlaceholder="Tìm tên, email hoặc vai trò..."
            />
            <FormField
              label="Giá trị hợp đồng năm (đ)"
              value={annualValue}
              onChange={e => setAnnualValue(formatVndInputValue(e.target.value))}
              inputMode="numeric"
              placeholder="VD: 350.000.000"
            />
          </div>
        </section>

        <section className="accounts-form-section">
          <span className="accounts-form-section-title">Trạng thái ban đầu</span>
          <div className="accounts-form-grid">
            <CustomDropdown
              label="Giai đoạn ban đầu"
              value={stage}
              options={accountStageOptions}
              onChange={setStage}
            />
            <div className="accounts-derived-field">
              <span>Sức khỏe hệ thống</span>
              <strong>{formatAccountHealth(previewHealth)}</strong>
              <small>Suy ra từ giai đoạn đang chọn</small>
            </div>
          </div>
        </section>

        <section className="accounts-form-section accounts-form-section-full">
          <span className="accounts-form-section-title">Ghi chú</span>
          <FormTextArea label="Ghi chú thương mại" value={commercialNotes} onChange={e => setCommercialNotes(e.target.value)} placeholder="Chiến lược, mục tiêu pilot, người quyết định..." />
        </section>

        <div className="accounts-form-actions">
          <button type="button" onClick={onClose} disabled={saving} style={{
            padding: "var(--space-2) var(--space-4)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text)",
            cursor: saving ? "not-allowed" : "pointer",
            fontSize: "13px"
          }}>Hủy</button>
          <button type="submit" disabled={saving || !name.trim() || !code.trim()} style={{
            padding: "var(--space-2) var(--space-4)",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: saving || !name.trim() || !code.trim() ? "var(--border)" : "var(--accent)",
            color: "#fff",
            cursor: saving || !name.trim() || !code.trim() ? "not-allowed" : "pointer",
            fontSize: "13px",
            fontWeight: 600
          }}>{saving ? "Đang tạo..." : "Tạo khách hàng"}</button>
        </div>
      </form>
    </Modal>
  );
}

// Edit Account Form Dialog
function EditAccountModal({
  isOpen,
  onClose,
  account,
  resources,
  members,
  onSave
}: {
  isOpen: boolean;
  onClose: () => void;
  account: any;
  resources: CapacitySummaryItem[];
  members: AdminAccessMemberSummary[];
  onSave: (data: any) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState("prospect");
  const [health, setHealth] = useState("green");
  const [picUserId, setPicUserId] = useState("");
  const [annualValue, setAnnualValue] = useState("");
  const [commercialNotes, setCommercialNotes] = useState("");
  const picOptions = getAccountPicOptions(resources, members);

  useEffect(() => {
    if (account) {
      setName(account.name || "");
      setCode(account.code || "");
      setStage(account.stage || "prospect");
      setHealth(account.health || "green");
      setPicUserId(account.picUserId || "");
      setAnnualValue(account.annualValue !== undefined ? formatVndInputValue(account.annualValue) : "");
      setCommercialNotes(account.commercialNote || "");
    }
  }, [account, isOpen]);

  const handleSubmit = (e: any) => {
    e.preventDefault();
    if (!name || !code) {
      alert("Cần nhập tên khách hàng và tên viết tắt.");
      return;
    }
    onSave({
      ...account,
      name,
      code,
      stage,
      health,
      picUserId,
      picName: picOptions.find(option => option.value === picUserId)?.label,
      annualValue: parseVndInputValue(annualValue),
      commercialNote: commercialNotes
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Sửa khách hàng: ${account?.name}`} variant="workspace">
      <form onSubmit={handleSubmit} className="accounts-account-form">
        <section className="accounts-form-section">
          <span className="accounts-form-section-title">Thông tin cơ bản</span>
          <div className="accounts-form-grid">
            <FormField label="Tên khách hàng" value={name} onChange={e => setName(e.target.value)} required />
            <FormField label="Tên viết tắt" value={code} onChange={e => setCode(e.target.value)} required />
          </div>
        </section>

        <section className="accounts-form-section">
          <span className="accounts-form-section-title">Phụ trách & giá trị</span>
          <div className="accounts-form-grid">
            <CustomDropdown
              label="PIC"
              value={picUserId}
              options={picOptions}
              onChange={setPicUserId}
              searchable
              searchPlaceholder="Tìm tên, email hoặc vai trò..."
            />
            <FormField
              label="Giá trị hợp đồng năm (đ)"
              value={annualValue}
              onChange={e => setAnnualValue(formatVndInputValue(e.target.value))}
              inputMode="numeric"
            />
          </div>
        </section>

        <section className="accounts-form-section">
          <span className="accounts-form-section-title">Trạng thái</span>
          <div className="accounts-form-grid">
            <CustomDropdown
              label="Giai đoạn"
              value={stage}
              options={accountStageOptions}
              onChange={setStage}
            />
            <CustomDropdown
              label="Sức khỏe"
              value={health}
              options={[
                { value: "green", label: "Ổn định", icon: "checkmark", iconTone: "success" },
                { value: "amber", label: "Cần chú ý", icon: "clock", iconTone: "warning" },
                { value: "red", label: "Rủi ro cao", icon: "alert-circle", iconTone: "critical" }
              ]}
              onChange={setHealth}
            />
          </div>
        </section>

        <section className="accounts-form-section accounts-form-section-full">
          <span className="accounts-form-section-title">Ghi chú</span>
          <FormTextArea label="Ghi chú thương mại" value={commercialNotes} onChange={e => setCommercialNotes(e.target.value)} />
        </section>

        <div className="accounts-form-actions">
          <button type="button" onClick={onClose} style={{
            padding: "var(--space-2) var(--space-4)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text)",
            cursor: "pointer",
            fontSize: "13px"
          }}>Hủy</button>
          <button type="submit" style={{
            padding: "var(--space-2) var(--space-4)",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 600
          }}>Lưu thay đổi</button>
        </div>
      </form>
    </Modal>
  );
}

// Sub-item: Contact Form Dialog
function ContactFormModal({
  isOpen,
  onClose,
  contact,
  onSave
}: {
  isOpen: boolean;
  onClose: () => void;
  contact: any;
  onSave: (data: any) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [influence, setInfluence] = useState("neutral");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (contact) {
      setName(contact.name || "");
      setRole(contact.role || "");
      setInfluence(contact.influence || "neutral");
      setEmail(contact.email || "");
      setPhone(contact.phone || "");
    } else {
      setName("");
      setRole("");
      setInfluence("neutral");
      setEmail("");
      setPhone("");
    }
    setError("");
    setSaving(false);
  }, [contact, isOpen]);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (!name) {
      setError("Cần nhập tên liên hệ.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({
        id: contact?.id,
        name: name.trim(),
        role: role.trim() || undefined,
        influence,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể lưu liên hệ.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={contact ? "Sửa liên hệ" : "Thêm liên hệ"}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {error ? <div className="accounts-form-error">{error}</div> : null}
        <FormField label="Họ tên" value={name} onChange={e => setName(e.target.value)} required />
        <FormField label="Chức danh / vai trò" value={role} onChange={e => setRole(e.target.value)} placeholder="VD: IT Director" />
        <FormField label="Email" value={email} onChange={e => setEmail(e.target.value)} placeholder="VD: contact@example.com" type="email" />
        <FormField label="Số điện thoại" value={phone} onChange={e => setPhone(e.target.value)} placeholder="VD: +84999000111" />
        
        <div style={{ zIndex: 1001 }}>
          <CustomDropdown
            label="Mức ảnh hưởng"
            value={influence}
            options={[
              { value: "economic_buyer", label: "Người quyết định", icon: "checkmark", iconTone: "success" },
              { value: "champion", label: "Người ủng hộ", icon: "star", iconTone: "success" },
              { value: "detractor", label: "Người cản trở", icon: "alert-circle", iconTone: "critical" },
              { value: "neutral", label: "Trung lập", icon: "person", iconTone: "neutral" }
            ]}
            onChange={setInfluence}
          />
        </div>
        
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <button type="button" onClick={onClose} style={{
            padding: "var(--space-2) var(--space-4)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text)",
            cursor: "pointer",
            fontSize: "13px"
          }}>Hủy</button>
          <button type="submit" disabled={saving} style={{
            padding: "var(--space-2) var(--space-4)",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: saving ? "var(--text-muted)" : "var(--accent)",
            color: "#fff",
            cursor: saving ? "progress" : "pointer",
            fontSize: "13px",
            fontWeight: 600
          }}>{saving ? "Đang lưu..." : contact ? "Lưu thay đổi" : "Thêm liên hệ"}</button>
        </div>
      </form>
    </Modal>
  );
}

// Sub-item: Opportunity Form Dialog
function OpportunityFormModal({
  isOpen,
  onClose,
  opportunity,
  onSave
}: {
  isOpen: boolean;
  onClose: () => void;
  opportunity: any;
  onSave: (data: any) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState("discovery");
  const [forecastCategory, setForecastCategory] = useState("pipeline");
  const [probability, setProbability] = useState("50");
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (opportunity) {
      setTitle(opportunity.title || "");
      setAmount(opportunity.amount !== undefined ? String(opportunity.amount) : "");
      setStage(opportunity.stage || "discovery");
      setForecastCategory(opportunity.forecastCategory || "pipeline");
      setProbability(opportunity.probability !== undefined ? String(opportunity.probability) : "50");
      setStale(!!opportunity.stale);
    } else {
      setTitle("");
      setAmount("");
      setStage("discovery");
      setForecastCategory("pipeline");
      setProbability("50");
      setStale(false);
    }
    setError("");
    setSaving(false);
  }, [opportunity, isOpen]);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (!title) {
      setError("Cần nhập tên cơ hội.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({
        id: opportunity?.id,
        title: title.trim(),
        amount: amount ? Number(amount) : 0,
        stage,
        forecastCategory,
        probability: Number(probability) || 0,
        stale
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể lưu cơ hội.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={opportunity ? "Sửa cơ hội" : "Tạo cơ hội"}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {error ? <div className="accounts-form-error">{error}</div> : null}
        <FormField label="Tên cơ hội" value={title} onChange={e => setTitle(e.target.value)} required />
        <FormField label="Giá trị (đ)" value={amount} onChange={e => setAmount(e.target.value)} type="number" placeholder="VD: 250000000" />
        <FormField label="Xác suất (%)" value={probability} onChange={e => setProbability(e.target.value)} type="number" placeholder="VD: 50" />
        
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", zIndex: 1001 }}>
          <CustomDropdown
            label="Giai đoạn"
            value={stage}
            options={[
              { value: "discovery", label: "Khảo sát", icon: "search" },
              { value: "proposal", label: "Đề xuất", icon: "star" },
              { value: "negotiation", label: "Đàm phán", icon: "share" },
              { value: "implementation", label: "Triển khai", icon: "settings" },
              { value: "won", label: "Đã thắng", icon: "checkmark", iconTone: "success" },
              { value: "lost", label: "Đã mất", icon: "alert-circle", iconTone: "critical" }
            ]}
            onChange={setStage}
          />
          <CustomDropdown
            label="Dự báo"
            value={forecastCategory}
            options={[
              { value: "pipeline", label: "Đang theo dõi", icon: "star" },
              { value: "best_case", label: "Có tiềm năng", icon: "clock" },
              { value: "commit", label: "Cam kết", icon: "checkmark", iconTone: "success" }
            ]}
            onChange={setForecastCategory}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <input 
            type="checkbox" 
            id="opp-stale" 
            checked={stale} 
            onChange={(e) => setStale(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          <label htmlFor="opp-stale" style={{ fontSize: "13px", fontWeight: 400, color: "var(--text)", cursor: "pointer" }}>
            Đánh dấu cần rà soát
          </label>
        </div>
        
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <button type="button" onClick={onClose} style={{
            padding: "var(--space-2) var(--space-4)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text)",
            cursor: "pointer",
            fontSize: "13px"
          }}>Hủy</button>
          <button type="submit" disabled={saving} style={{
            padding: "var(--space-2) var(--space-4)",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: saving ? "var(--text-muted)" : "var(--accent)",
            color: "#fff",
            cursor: saving ? "progress" : "pointer",
            fontSize: "13px",
            fontWeight: 600
          }}>{saving ? "Đang lưu..." : opportunity ? "Lưu thay đổi" : "Tạo cơ hội"}</button>
        </div>
      </form>
    </Modal>
  );
}

// Sub-item: Project Form Dialog
function ProjectFormModal({
  isOpen,
  onClose,
  project,
  onSave
}: {
  isOpen: boolean;
  onClose: () => void;
  project: any;
  onSave: (data: any) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [marginPercent, setMarginPercent] = useState("35");
  const [status, setStatus] = useState("planning");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (project) {
      setName(project.name || "");
      setCode(project.code || "");
      setMarginPercent(project.marginPercent !== undefined ? String(project.marginPercent) : "35");
      setStatus(project.status || "planning");
    } else {
      setName("");
      setCode("");
      setMarginPercent("35");
      setStatus("planning");
    }
    setError("");
    setSaving(false);
  }, [project, isOpen]);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setError("");
    if (!name.trim() || !code.trim()) {
      setError("Cần nhập tên dự án và tên viết tắt.");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        id: project?.id,
        name: name.trim(),
        code: code.trim(),
        marginPercent: Number(marginPercent) || 0,
        status
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể lưu dự án. Vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={project ? "Sửa dự án" : "Tạo dự án"}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {error ? <div className="accounts-form-error">{error}</div> : null}
        <FormField label="Tên dự án" value={name} onChange={e => setName(e.target.value)} required />
        <FormField label="Tên viết tắt" value={code} onChange={e => setCode(e.target.value)} required />
        <FormField label="Biên lợi nhuận (%)" value={marginPercent} onChange={e => setMarginPercent(e.target.value)} type="number" placeholder="VD: 35" />
        
        <div style={{ zIndex: 1001 }}>
          <CustomDropdown
            label="Trạng thái dự án"
            value={status}
            options={[
              { value: "planning", label: "Đang lên kế hoạch", icon: "clock" },
              { value: "active", label: "Đang chạy", icon: "star", iconTone: "info" },
              { value: "completed", label: "Hoàn tất", icon: "checkmark", iconTone: "success" }
            ]}
            onChange={setStatus}
          />
        </div>
        
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <button type="button" onClick={onClose} style={{
            padding: "var(--space-2) var(--space-4)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text)",
            cursor: "pointer",
            fontSize: "13px"
          }}>Hủy</button>
          <button type="submit" style={{
            padding: "var(--space-2) var(--space-4)",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 600
          }} disabled={saving}>{saving ? "Đang lưu..." : project ? "Lưu thay đổi" : "Tạo dự án"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function AccountsWorkbench({
  accounts,
  opportunities,
  projects,
  principal
}: {
  accounts: AccountsResponse;
  opportunities: ResourceListResponse<OpportunitySummary>;
  projects: ResourceListResponse<ProjectSummary>;
  principal: string;
}) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStage, setFilterStage] = useState("all");
  const [filterHealth, setFilterHealth] = useState("all");
  const [activeTab, setActiveTab] = useState<"overview" | "contacts" | "opportunities" | "projects">("overview");

  // Local state persistence variables
  const [localAccounts, setLocalAccounts] = useState<any[]>([]);
  const [localOpportunities, setLocalOpportunities] = useState<any[]>([]);
  const [localProjects, setLocalProjects] = useState<any[]>([]);
  const [allContacts, setAllContacts] = useState<any[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [resourcePeople, setResourcePeople] = useState<CapacitySummaryItem[]>([]);
  const [accountPicMembers, setAccountPicMembers] = useState<AdminAccessMemberSummary[]>([]);

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: "success" | "danger" | "info" } | null>(null);
  const triggerToast = (message: string, type: "success" | "danger" | "info" = "success") => {
    setToast({ message, type });
  };
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Modals state
  const [showCreateAccountModal, setShowCreateAccountModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const resourceUrl = new URL("/api/capacity/summary", window.location.origin);
    resourceUrl.searchParams.set("principal", principal);

    async function loadPicSources() {
      const [resourcesResult, membersResult] = await Promise.all([
        fetch(resourceUrl.toString()).then(response => {
          if (!response.ok) throw new Error("Failed to load resource people");
          return response.json() as Promise<CapacitySummaryResponse>;
        }),
        loadAccountPicMembers()
      ]);

      if (!cancelled) {
        setResourcePeople(resourcesResult.data ?? []);
        setAccountPicMembers(membersResult);
      }
    }

    loadPicSources()
      .catch(error => {
        console.error(error);
        if (!cancelled) {
          setResourcePeople([]);
          setAccountPicMembers([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [principal]);

  // Sync from BFF. Account mutations are persisted through /api/accounts.
  useEffect(() => {
    setLocalAccounts(accounts.data);
  }, [accounts.data]);

  useEffect(() => {
    setLocalOpportunities(opportunities.data);
  }, [opportunities.data]);

  useEffect(() => {
    setLocalProjects(projects.data);
  }, [projects.data]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedAccountId) {
      setAllContacts([]);
      return () => {
        cancelled = true;
      };
    }
    setContactsLoading(true);
    fetch(`/api/accounts/${encodeURIComponent(selectedAccountId)}/contacts?principal=${encodeURIComponent(principal)}`, {
      cache: "no-store"
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load contacts");
        return res.json();
      })
      .then((resJson) => {
        if (!cancelled) {
          setAllContacts(resJson?.data || []);
        }
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setAllContacts([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setContactsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [principal, selectedAccountId]);

  const selectedAccount = localAccounts.find(a => a.id === selectedAccountId);

  // Health status counters
  const greenCount = localAccounts.filter(a => a.health === "green").length;
  const amberCount = localAccounts.filter(a => a.health === "amber").length;
  const redCount = localAccounts.filter(a => a.health === "red").length;

  // Stages listing for filtering options
  const uniqueStages = Array.from(new Set(localAccounts.map(a => a.stage).filter(Boolean)));
  const stageOptions = [
    { value: "all", label: "Tất cả giai đoạn", icon: "order" },
    ...uniqueStages.map(s => {
      let icon = "settings";
      if (s === "implementation") icon = "settings";
      else if (s === "proposal") icon = "star";
      else if (s === "prospect") icon = "search";
      else if (s === "qualified") icon = "check";
      else if (s === "active") icon = "check";
      else if (s === "at_risk" || s === "churned") icon = "alert";
      return { value: s, label: formatAccountStage(s), icon };
    })
  ];

  const healthOptions = [
    { value: "all", label: "Tất cả sức khỏe", icon: "star", iconTone: "neutral" },
    { value: "green", label: "Ổn định", icon: "checkmark", iconTone: "success" },
    { value: "amber", label: "Cần chú ý", icon: "clock", iconTone: "warning" },
    { value: "red", label: "Rủi ro cao", icon: "alert-circle", iconTone: "critical" }
  ];

  // Filtered Accounts
  const filteredAccounts = localAccounts.filter(account => {
    const matchesSearch = 
      account.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      account.code.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStage = filterStage === "all" || account.stage === filterStage;
    const matchesHealth = filterHealth === "all" || account.health === filterHealth;
    return matchesSearch && matchesStage && matchesHealth;
  });

  // Calculate annual base total for filtered accounts
  const isAnnualRestricted = localAccounts.length > 0 && localAccounts.some(a => a.annualValue === undefined);
  const totalAnnualValue = filteredAccounts.reduce((sum, a) => sum + (a.annualValue ?? 0), 0);

  // Filter opportunities & projects local
  const linkedOpportunities = localOpportunities.filter(opp => opp.accountId === selectedAccountId);
  const linkedProjects = localProjects.filter(proj => proj.accountId === selectedAccountId);
  const activeContacts = allContacts.filter(c => c.accountId === selectedAccountId);

  // audit change logs helper
  const addAccountLog = (accountId: string, actionDescription: string) => {
    const key = `lark_crm_account_logs_${accountId}`;
    const saved = localStorage.getItem(key);
    let logs = [];
    if (saved) {
      try {
        logs = JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    const newLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      description: actionDescription
    };
    logs.unshift(newLog);
    localStorage.setItem(key, JSON.stringify(logs));
  };

  useEffect(() => {
    if (selectedAccountId) {
      setActiveTab("overview");
    }
  }, [selectedAccountId]);

  if (selectedAccount) {
    return (
      <>
        <AccountDetailPage
          account={selectedAccount}
          opportunities={linkedOpportunities}
          projects={linkedProjects}
          principal={principal}
          contacts={activeContacts}
          contactsLoading={contactsLoading}
          resources={resourcePeople}
          members={accountPicMembers}
          onBack={() => setSelectedAccountId(null)}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onUpdateAccount={(updatedAcc) => {
            void (async () => {
              try {
                const response = await fetch(`/api/accounts/${updatedAcc.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name: updatedAcc.name,
                    stage: updatedAcc.stage,
                    ownerTeamId: getOwnerTeamIdFromLabel(updatedAcc.ownerTeam) || undefined,
                    picUserId: updatedAcc.picUserId || null,
                    annualValue: updatedAcc.annualValue ?? 0,
                    commercialNote: updatedAcc.commercialNote || null
                  })
                });
                if (!response.ok) {
                  throw new Error(await readApiError(response));
                }
                const savedAccount = await response.json();
                const newAccounts = localAccounts.map(a => a.id === savedAccount.id ? savedAccount : a);
                setLocalAccounts(newAccounts);
                triggerToast(`Đã cập nhật khách hàng ${savedAccount.name}.`, "success");
                addAccountLog(savedAccount.id, `Cập nhật thông tin khách hàng ${savedAccount.name}, giai đoạn ${formatAccountStage(savedAccount.stage)}, sức khỏe ${formatAccountHealth(savedAccount.health)}.`);
              } catch (err) {
                triggerToast(err instanceof Error ? err.message : "Không thể cập nhật khách hàng.", "danger");
              }
            })();
          }}
          onDeleteAccount={(accId) => {
            const accountToDelete = localAccounts.find(a => a.id === accId);
            const newAccounts = localAccounts.filter(a => a.id !== accId);
            setLocalAccounts(newAccounts);
            localStorage.setItem("lark_crm_custom_accounts_list", JSON.stringify(newAccounts));
            setSelectedAccountId(null);
            triggerToast(`Đã xóa khách hàng ${accountToDelete?.name || accId}.`, "danger");
          }}
          onAddContact={async (newContact) => {
            const response = await fetch(`/api/accounts/${encodeURIComponent(selectedAccount.id)}/contacts`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(newContact)
            });
            if (!response.ok) {
              throw new Error(await readApiError(response));
            }
            const savedContact = await response.json();
            setAllContacts((current) => [...current.filter(contact => contact.id !== savedContact.id), savedContact]);
            triggerToast(`Đã thêm liên hệ ${savedContact.name}.`, "success");
            addAccountLog(selectedAccount.id, `Added contact: ${savedContact.name} (${savedContact.role ?? "no role"})`);
          }}
          onUpdateContact={async (updatedContact) => {
            const response = await fetch(`/api/accounts/${encodeURIComponent(selectedAccount.id)}/contacts/${encodeURIComponent(updatedContact.id)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(updatedContact)
            });
            if (!response.ok) {
              throw new Error(await readApiError(response));
            }
            const savedContact = await response.json();
            setAllContacts((current) => current.map(contact => contact.id === savedContact.id ? savedContact : contact));
            triggerToast(`Đã cập nhật liên hệ ${savedContact.name}.`, "success");
            addAccountLog(selectedAccount.id, `Updated contact details for ${savedContact.name}`);
          }}
          onDeleteContact={(contactId) => {
            const contactToDelete = allContacts.find(c => c.id === contactId);
            void (async () => {
              try {
                const response = await fetch(`/api/accounts/${encodeURIComponent(selectedAccount.id)}/contacts/${encodeURIComponent(contactId)}`, {
                  method: "DELETE"
                });
                if (!response.ok) {
                  throw new Error(await readApiError(response));
                }
                setAllContacts((current) => current.filter(contact => contact.id !== contactId));
                triggerToast(`Đã xóa liên hệ ${contactToDelete?.name || contactId}.`, "danger");
                addAccountLog(selectedAccount.id, `Đã xóa liên hệ: ${contactToDelete?.name || contactId}`);
              } catch (err) {
                triggerToast(err instanceof Error ? err.message : "Không thể xóa liên hệ.", "danger");
              }
            })();
          }}
          onAddOpportunity={async (newOpp) => {
            const response = await fetch("/api/opportunities", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                accountId: selectedAccount.id,
                title: newOpp.title,
                amount: newOpp.amount,
                stage: newOpp.stage,
                probability: newOpp.probability
              })
            });
            if (!response.ok) {
              throw new Error(await readApiError(response));
            }
            const savedOpportunity = await response.json();
            setLocalOpportunities((current) => [...current.filter(opp => opp.id !== savedOpportunity.id), savedOpportunity]);
            triggerToast(`Đã tạo cơ hội ${savedOpportunity.title}.`, "success");
            addAccountLog(selectedAccount.id, `Created opportunity: ${savedOpportunity.title} (Amount: ${formatDecimalVnd(savedOpportunity.amount ?? 0)})`);
          }}
          onUpdateOpportunity={async (updatedOpp) => {
            const response = await fetch(`/api/opportunities/${encodeURIComponent(updatedOpp.id)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: updatedOpp.title,
                amount: updatedOpp.amount,
                stage: updatedOpp.stage,
                probability: updatedOpp.probability
              })
            });
            if (!response.ok) {
              throw new Error(await readApiError(response));
            }
            const savedOpportunity = await response.json();
            setLocalOpportunities((current) => current.map(opp => opp.id === savedOpportunity.id ? savedOpportunity : opp));
            triggerToast(`Đã cập nhật cơ hội ${savedOpportunity.title}.`, "success");
            addAccountLog(selectedAccount.id, `Updated opportunity details for ${savedOpportunity.title}`);
          }}
          onDeleteOpportunity={(oppId) => {
            const oppToDelete = localOpportunities.find(o => o.id === oppId);
            triggerToast(`Chưa hỗ trợ xóa cơ hội bằng API: ${oppToDelete?.title || oppId}.`, "danger");
          }}
          onAddProject={async (newProj) => {
            try {
              const response = await fetch("/api/projects", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  accountId: selectedAccount.id,
                  code: newProj.code,
                  name: newProj.name,
                  marginPercent: newProj.marginPercent,
                  status: newProj.status,
                  createStageTemplate: true
                })
              });
              if (!response.ok) {
                throw new Error(await readApiError(response));
              }
              const createdProject = await response.json();
              setLocalProjects((current) => [...current.filter(project => project.id !== createdProject.id), createdProject]);
              triggerToast(`Đã tạo dự án ${createdProject.name}.`, "success");
              addAccountLog(selectedAccount.id, `Created project: ${createdProject.name} (Code: ${createdProject.code})`);
            } catch (err) {
              triggerToast(err instanceof Error ? err.message : "Không thể tạo dự án.", "danger");
              throw err;
            }
          }}
          onUpdateProject={async (updatedProj) => {
            try {
              const response = await fetch(`/api/projects/${encodeURIComponent(updatedProj.id)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  accountId: selectedAccount.id,
                  code: updatedProj.code,
                  name: updatedProj.name,
                  marginPercent: updatedProj.marginPercent,
                  status: updatedProj.status
                })
              });
              if (!response.ok) {
                throw new Error(await readApiError(response));
              }
              const savedProject = await response.json();
              setLocalProjects((current) => current.map(project => project.id === savedProject.id ? savedProject : project));
              triggerToast(`Đã cập nhật dự án ${savedProject.name}.`, "success");
              addAccountLog(selectedAccount.id, `Updated project details for ${savedProject.name}`);
            } catch (err) {
              triggerToast(err instanceof Error ? err.message : "Không thể cập nhật dự án.", "danger");
              throw err;
            }
          }}
          onDeleteProject={(projId) => {
            void (async () => {
              const projToDelete = localProjects.find(p => p.id === projId);
              try {
                const response = await fetch(`/api/projects/${encodeURIComponent(projId)}`, { method: "DELETE" });
                if (!response.ok) {
                  throw new Error(await readApiError(response));
                }
                setLocalProjects((current) => current.filter(project => project.id !== projId));
                triggerToast(`Đã xóa dự án ${projToDelete?.name || projId}.`, "danger");
                addAccountLog(selectedAccount.id, `Đã xóa dự án: ${projToDelete?.name || projId}`);
              } catch (err) {
                triggerToast(err instanceof Error ? err.message : "Không thể xóa dự án.", "danger");
              }
            })();
          }}
          addAccountLog={addAccountLog}
        />

        {/* Floating Toast overlay */}
        {toast && (
          <div style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            zIndex: 9999,
            padding: "var(--space-3) var(--space-4)",
            borderRadius: "var(--radius-md)",
            background: toast.type === "success" 
              ? "rgba(0, 128, 96, 0.9)" 
              : toast.type === "danger" 
                ? "rgba(224, 0, 0, 0.9)" 
                : "rgba(92, 106, 196, 0.9)",
            color: "#fff",
            boxShadow: "var(--shadow-panel)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            fontSize: "13.5px",
            fontWeight: 500,
            animation: "shopify-section-enter 250ms ease-out"
          }}>
            <ToastIcon type={toast.type} />
            <span>{toast.message}</span>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="accounts-workbench">
      
      {/* KPI Counters Strip */}
      <div className="kpi-metric-grid accounts-kpi-grid" aria-label="Tổng quan khách hàng">
        {/* Card 1: Total Accounts */}
        <div className="kpi-metric-card" style={{ "--kpi-border": "var(--accent)" } as React.CSSProperties}>
          <span className="kpi-label">Khách hàng đang quản lý</span>
          <div className="kpi-value" style={{ fontSize: "28px", fontWeight: 700, color: "var(--text)" }}>
            {filteredAccounts.length}
          </div>
          <div className="kpi-detail">
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              Trong {localAccounts.length} khách hàng có quyền xem
            </span>
          </div>
        </div>

        {/* Card 2: Annual Base ACV */}
        <div className="kpi-metric-card" style={{ "--kpi-border": "var(--brand-blue)" } as React.CSSProperties}>
          <span className="kpi-label">Giá trị hợp đồng năm</span>
          <div className="kpi-value" style={{ fontSize: "28px", fontWeight: 700, color: "var(--text)" }}>
            {isAnnualRestricted ? "Bị giới hạn" : <MoneyAmount value={totalAnnualValue} />}
          </div>
          <div className="kpi-detail">
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              Tổng theo bộ lọc hiện tại
            </span>
          </div>
        </div>

        {/* Card 3: Health Distributions */}
        <div className="kpi-metric-card" style={{ "--kpi-border": "var(--success)" } as React.CSSProperties}>
          <span className="kpi-label">Sức khỏe khách hàng</span>
          <div className="accounts-health-row">
            <div className="accounts-health-stat">
              <span className="font-mono" style={{ fontSize: "20px", fontWeight: 700, color: "var(--success)" }}>{greenCount}</span>
              <span style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "none" }}>Ổn định</span>
            </div>
            <div className="accounts-health-stat">
              <span className="font-mono" style={{ fontSize: "20px", fontWeight: 700, color: "var(--warning)" }}>{amberCount}</span>
              <span style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "none" }}>Cần chú ý</span>
            </div>
            <div className="accounts-health-stat">
              <span className="font-mono" style={{ fontSize: "20px", fontWeight: 700, color: "var(--danger)" }}>{redCount}</span>
              <span style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "none" }}>Rủi ro cao</span>
            </div>
          </div>
          <div className="kpi-detail" style={{ marginTop: "auto" }}>
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Phân bổ trạng thái hiện tại</span>
          </div>
        </div>
      </div>

      {/* Main Workspace Layout */}
      <div className="accounts-list-layout">
        
        {/* Interactive Account List */}
        <div className="shopify-stack">
          <ShopifySection heading="Danh sách khách hàng">
            
            {/* Search and Filters deck */}
            <div className="shopify-filter-panel accounts-filter-panel">
              <div className="accounts-toolbar">
              {/* Search box input */}
              <div className="accounts-search-field">
                <label className="accounts-field-label">
                  Tìm khách hàng
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    placeholder="Tìm theo tên hoặc mã..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 14px 10px 36px",
                      borderRadius: "8px",
                      border: "1px solid var(--border)",
                      background: "var(--panel-strong)",
                      fontSize: "13px",
                      color: "var(--text)",
                      outline: "none",
                      transition: "border-color 0.2s"
                    }}
                  />
                  <ShopifyIcon
                    name="search"
                    size={14}
                    className="shopify-search-field-icon"
                  />
                </div>
              </div>

              {/* Custom stage filter */}
              <CustomDropdown
                label="Giai đoạn"
                value={filterStage}
                options={stageOptions}
                onChange={setFilterStage}
              />

              {/* Custom health filter */}
              <CustomDropdown
                label="Sức khỏe"
                value={filterHealth}
                options={healthOptions}
                onChange={setFilterHealth}
              />

              {/* "+ Create Account" Button */}
              <div className="accounts-toolbar-action">
                <button
                  className="pipeline-command-button primary accounts-create-button"
                  onClick={() => setShowCreateAccountModal(true)}
                  type="button"
                >
                  <ShopifyIcon name="plus" size={14} />
                  Tạo khách hàng
                </button>
              </div>
              </div>
            </div>

            {/* Master Table Grid */}
            {filteredAccounts.length ? (
              <ShopifyDataTable
                ariaLabel="Danh sách khách hàng"
                columns={[
                  { key: "account", header: "Khách hàng", mobilePriority: "title", width: "32%" },
                  { key: "stage", header: "Giai đoạn", width: "17%" },
                  { key: "owner", header: "PIC", width: "17%" },
                  { key: "health", header: "Sức khỏe", mobilePriority: "hidden", width: "17%" },
                  { key: "value", header: "Giá trị năm", width: "17%" }
                ]}
                rows={filteredAccounts.map((account) => {
                  const isSelected = account.id === selectedAccountId;
                  const picName = getAccountPicName(account);
                  return {
                    key: account.id,
                    onClick: () => setSelectedAccountId(account.id),
                    selected: isSelected,
                    mobileTitle: account.name,
                    mobileSubtitle: picName,
                    mobileMeta: (
                      <s-badge tone={account.health === "green" ? "success" : account.health === "amber" ? "warning" : "critical"}>
                        {formatAccountHealth(account.health)}
                      </s-badge>
                    ),
                    cells: [
                      (
                        <div className="shopify-data-table-title">
                          <span
                            style={{
                              color: isSelected ? "var(--accent)" : "var(--text)",
                              fontWeight: isSelected ? 600 : 500
                            }}
                          >
                            {account.name}
                          </span>
                          <span>{picName}</span>
                        </div>
                      ),
                      <span style={{ fontWeight: 400 }}>{formatAccountStage(account.stage)}</span>,
                      <span>{picName}</span>,
                      (
                        <s-badge tone={account.health === "green" ? "success" : account.health === "amber" ? "warning" : "critical"}>
                          {formatAccountHealth(account.health)}
                        </s-badge>
                      ),
                      (
                        <span className="font-mono" style={{ fontWeight: 500 }}>
                          {account.annualValue ? <MoneyAmount value={account.annualValue} /> : "Bị giới hạn"}
                        </span>
                      )
                    ]
                  };
                })}
              />
            ) : (
              <PolarisFallbackText>Không có khách hàng phù hợp với bộ lọc hiện tại.</PolarisFallbackText>
            )}
          </ShopifySection>
        </div>
      </div>

      {/* Create Account Modal Dialog */}
      <CreateAccountModal
        isOpen={showCreateAccountModal}
        onClose={() => setShowCreateAccountModal(false)}
        resources={resourcePeople}
        members={accountPicMembers}
        onSave={async (newAcc) => {
          const response = await fetch("/api/accounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(newAcc)
          });
          if (!response.ok) {
            throw new Error(await readApiError(response));
          }
          const createdAccount = await response.json();
          const newAccounts = [...localAccounts.filter(account => account.id !== createdAccount.id), createdAccount];
          setLocalAccounts(newAccounts);
          setShowCreateAccountModal(false);
          triggerToast(`Đã tạo khách hàng ${createdAccount.name}.`, "success");
        }}
      />

      {/* Floating Toast overlay */}
      {toast && (
        <div style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          zIndex: 9999,
          padding: "var(--space-3) var(--space-4)",
          borderRadius: "var(--radius-md)",
          background: toast.type === "success" 
            ? "rgba(0, 128, 96, 0.9)" 
            : toast.type === "danger" 
              ? "rgba(224, 0, 0, 0.9)" 
              : "rgba(92, 106, 196, 0.9)",
          color: "#fff",
          boxShadow: "var(--shadow-panel)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          fontSize: "13.5px",
          fontWeight: 500,
          animation: "shopify-section-enter 250ms ease-out"
        }}>
          <ToastIcon type={toast.type} />
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

// Full-width Account 360 Detail Page Component
function AccountDetailPage({
  account,
  opportunities,
  projects,
  principal,
  contacts,
  contactsLoading,
  resources,
  members,
  onBack,
  activeTab,
  setActiveTab,
  onUpdateAccount,
  onDeleteAccount,
  onAddContact,
  onUpdateContact,
  onDeleteContact,
  onAddOpportunity,
  onUpdateOpportunity,
  onDeleteOpportunity,
  onAddProject,
  onUpdateProject,
  onDeleteProject,
  addAccountLog
}: {
  account: any;
  opportunities: any[];
  projects: any[];
  principal: string;
  contacts: any[];
  contactsLoading: boolean;
  resources: CapacitySummaryItem[];
  members: AdminAccessMemberSummary[];
  onBack: () => void;
  activeTab: "overview" | "contacts" | "opportunities" | "projects";
  setActiveTab: (tab: any) => void;
  onUpdateAccount: (updatedAcc: any) => void;
  onDeleteAccount: (accId: string) => void;
  onAddContact: (newContact: any) => Promise<void>;
  onUpdateContact: (updatedContact: any) => Promise<void>;
  onDeleteContact: (contactId: string) => void;
  onAddOpportunity: (newOpp: any) => Promise<void>;
  onUpdateOpportunity: (updatedOpp: any) => Promise<void>;
  onDeleteOpportunity: (oppId: string) => void;
  onAddProject: (newProj: any) => Promise<void>;
  onUpdateProject: (updatedProj: any) => Promise<void>;
  onDeleteProject: (projId: string) => void;
  addAccountLog: (accountId: string, actionDescription: string) => void;
}) {
  const [reviews, setReviews] = useState<any[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null);
  const [isEditingAccount, setIsEditingAccount] = useState(false);
  const [accountConfirm, setAccountConfirm] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    tone?: "default" | "danger";
    onConfirm: () => void;
  } | null>(null);
  const [editName, setEditName] = useState(account.name || "");
  const [editCode, setEditCode] = useState(account.code || "");
  const [editPicUserId, setEditPicUserId] = useState(account.picUserId || "");
  const [editStage, setEditStage] = useState(account.stage || "prospect");
  const [editHealth, setEditHealth] = useState(account.health || "green");
  const [editAnnualValue, setEditAnnualValue] = useState(
    account.annualValue !== undefined ? formatVndInputValue(account.annualValue) : ""
  );
  const [editCommercialNote, setEditCommercialNote] = useState(account.commercialNote || "");
  const picOptions = getAccountPicOptions(resources, members);
  const editPicName = picOptions.find(option => option.value === editPicUserId)?.label ?? getAccountPicName(account);
  const currentPicName = isEditingAccount ? editPicName : getAccountPicName(account);

  // Filters state
  const [filterInfluence, setFilterInfluence] = useState("all");
  const [filterOppStage, setFilterOppStage] = useState("all");
  const [filterOppForecast, setFilterOppForecast] = useState("all");
  const [filterProjStatus, setFilterProjStatus] = useState("all");

  // Modals visibility state
  const [contactModal, setContactModal] = useState<{ mode: "create" | "edit"; data?: any } | null>(null);
  const [opportunityModal, setOpportunityModal] = useState<{ mode: "create" | "edit"; data?: any } | null>(null);
  const [projectModal, setProjectModal] = useState<{ mode: "create" | "edit"; data?: any } | null>(null);

  // Local state for Change Log updates
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    const key = `lark_crm_account_logs_${account.id}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        setLogs(JSON.parse(saved));
      } catch (e) {
        console.error(e);
      }
    } else {
      const defaultLogs = [
        {
          id: `log-seed-1`,
          timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
          description: "Khách hàng được khởi tạo từ dữ liệu vận hành."
        }
      ];
      localStorage.setItem(key, JSON.stringify(defaultLogs));
      setLogs(defaultLogs);
    }
  }, [account.id]);

  const logAction = (actionDescription: string) => {
    addAccountLog(account.id, actionDescription);
    const key = `lark_crm_account_logs_${account.id}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        setLogs(JSON.parse(saved));
      } catch (e) {
        console.error(e);
      }
    }
  };

  // Form fields states
  const [formMonth, setFormMonth] = useState("2026-06");
  const [formDataSource, setFormDataSource] = useState("Đồng bộ Lark");
  const [formConfidence, setFormConfidence] = useState("high");
  const [formMetricsAvailable, setFormMetricsAvailable] = useState(true);
  const [formUnavailabilityReason, setFormUnavailabilityReason] = useState("Chờ khách hàng cấp quyền dữ liệu");
  
  const [formLicensedUsers, setFormLicensedUsers] = useState("50");
  const [formActiveUsersMau, setFormActiveUsersMau] = useState("40");
  const [formWeeklyActivityWeeks, setFormWeeklyActivityWeeks] = useState("4");
  const [formDocsUsage, setFormDocsUsage] = useState("100");
  const [formBaseUsage, setFormBaseUsage] = useState("50");
  const [formTaskUsage, setFormTaskUsage] = useState("20");
  const [formWorkflowUsage, setFormWorkflowUsage] = useState("15");
  const [formTicketCount, setFormTicketCount] = useState("0");
  const [formSlaBreaches, setFormSlaBreaches] = useState("0");
  const [formCsat, setFormCsat] = useState("5");
  const [formTrainingAttendance, setFormTrainingAttendance] = useState("5");
  
  const [formHealth, setFormHealth] = useState("green");
  const [formInterpretation, setFormInterpretation] = useState("");
  const [formExpansionSignal, setFormExpansionSignal] = useState("no");
  const [formNextAction, setFormNextAction] = useState("");
  const [formNextReviewDate, setFormNextReviewDate] = useState("2026-07-15");
  const [formOwner, setFormOwner] = useState(principal === "founder" ? "Kha Nguyen" : "Đội chăm sóc khách hàng");
  
  const [formEscalationOwner, setFormEscalationOwner] = useState("Founder");
  const [formEscalationNote, setFormEscalationNote] = useState("");

  useEffect(() => {
    setIsEditingAccount(false);
    setEditName(account.name || "");
    setEditCode(account.code || "");
    setEditPicUserId(account.picUserId || "");
    setEditStage(account.stage || "prospect");
    setEditHealth(account.health || "green");
    setEditAnnualValue(account.annualValue !== undefined ? formatVndInputValue(account.annualValue) : "");
    setEditCommercialNote(account.commercialNote || "");
  }, [account.id, account.name, account.code, account.picUserId, account.stage, account.health, account.annualValue, account.commercialNote]);

  const beginAccountEdit = () => {
    setEditName(account.name || "");
    setEditCode(account.code || "");
    setEditPicUserId(account.picUserId || "");
    setEditStage(account.stage || "prospect");
    setEditHealth(account.health || "green");
    setEditAnnualValue(account.annualValue !== undefined ? formatVndInputValue(account.annualValue) : "");
    setEditCommercialNote(account.commercialNote || "");
    setIsEditingAccount(true);
  };

  const saveAccountEdit = () => {
    if (!editName.trim() || !editCode.trim()) {
      alert("Cần nhập tên khách hàng và tên viết tắt.");
      return;
    }
    const updatedAccount = {
      ...account,
      name: editName.trim(),
      code: editCode.trim(),
      picUserId: editPicUserId || null,
      picName: editPicUserId ? editPicName : undefined,
      stage: editStage,
      health: editHealth,
      annualValue: parseVndInputValue(editAnnualValue),
      commercialNote: editCommercialNote.trim()
    };
    onUpdateAccount(updatedAccount);
    setIsEditingAccount(false);
    logAction(`Cập nhật hồ sơ khách hàng ${updatedAccount.name}.`);
  };

  const isAnnualRestricted = account.annualValue === undefined;
  const isCommercialRestricted = account.commercialNote === undefined;

  // Dropdown options
  const formMonthOptions = [
    { value: "2026-05", label: "Tháng 05/2026", icon: "clock" as any },
    { value: "2026-06", label: "Tháng 06/2026", icon: "clock" as any },
    { value: "2026-07", label: "Tháng 07/2026", icon: "clock" as any },
    { value: "2026-08", label: "Tháng 08/2026", icon: "clock" as any }
  ];

  const dataSourceOptions = [
    { value: "Đồng bộ Lark", label: "Đồng bộ Lark", icon: "checkmark" as any },
    { value: "File xuất từ Lark", label: "File xuất từ Lark", icon: "checkmark" as any },
    { value: "Nhập thủ công", label: "Nhập thủ công", icon: "checkmark" as any },
    { value: "Khách hàng tự báo cáo", label: "Khách hàng tự báo cáo", icon: "checkmark" as any }
  ];

  const confidenceOptions = [
    { value: "high", label: "Độ tin cậy cao", icon: "checkmark" as any, iconTone: "success" },
    { value: "medium", label: "Độ tin cậy vừa", icon: "clock" as any, iconTone: "warning" },
    { value: "low", label: "Độ tin cậy thấp", icon: "alert-circle" as any, iconTone: "critical" }
  ];

  const unavailabilityReasonOptions = [
    { value: "Chờ khách hàng cấp quyền dữ liệu", label: "Chờ quyền dữ liệu", icon: "info" as any },
    { value: "Chưa bật đồng bộ Base trong pilot", label: "Chưa bật đồng bộ Base", icon: "info" as any },
    { value: "Khách hàng onboarding chậm", label: "Onboarding chậm", icon: "info" as any },
    { value: "Chưa thể xuất file vì ràng buộc bảo mật", label: "Vướng bảo mật", icon: "info" as any }
  ];

  const csatOptions = [
    { value: "5", label: "5/5 (Rất hài lòng)", icon: "star" as any, iconTone: "warning" },
    { value: "4", label: "4/5 (Hài lòng)", icon: "star" as any, iconTone: "warning" },
    { value: "3", label: "3/5 (Trung lập)", icon: "star" as any, iconTone: "neutral" },
    { value: "2", label: "2/5 (Chưa tốt)", icon: "star" as any, iconTone: "critical" },
    { value: "1", label: "1/5 (Rất cần xử lý)", icon: "star" as any, iconTone: "critical" }
  ];

  const formHealthOptions = [
    { value: "green", label: "Ổn định", icon: "checkmark" as any, iconTone: "success" },
    { value: "amber", label: "Cần chú ý", icon: "clock" as any, iconTone: "warning" },
    { value: "red", label: "Rủi ro cao", icon: "alert-circle" as any, iconTone: "critical" }
  ];

  const expansionSignalOptions = [
    { value: "no", label: "Chưa có tín hiệu", icon: "alert-circle" as any, iconTone: "neutral" },
    { value: "yes", label: "Có, mức sử dụng cao", icon: "checkmark" as any, iconTone: "success" }
  ];

  const roles = [
    { value: "Founder", label: "Founder/GM", icon: "person" as any },
    { value: "Delivery Lead", label: "Lead triển khai", icon: "person" as any },
    { value: "Sales Lead", label: "Lead bán hàng", icon: "person" as any },
    { value: "Finance Admin", label: "Phụ trách tài chính", icon: "person" as any }
  ];

  useEffect(() => {
    let cancelled = false;
    setReviewsLoading(true);
    setReviewError("");
    fetch(`/api/accounts/${encodeURIComponent(account.id)}/usage-reviews?principal=${encodeURIComponent(principal)}`, {
      cache: "no-store"
    })
      .then((response) => {
        if (!response.ok) throw new Error("Không thể tải review sử dụng.");
        return response.json();
      })
      .then((payload) => {
        if (!cancelled) {
          setReviews(payload?.data ?? []);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setReviewError(error instanceof Error ? error.message : "Không thể tải review sử dụng.");
          setReviews([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setReviewsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [account.id, principal]);

  const resetForm = () => {
    setFormMonth("2026-06");
    setFormDataSource("Đồng bộ Lark");
    setFormConfidence("high");
    setFormMetricsAvailable(true);
    setFormUnavailabilityReason("Chờ khách hàng cấp quyền dữ liệu");
    setFormLicensedUsers("50");
    setFormActiveUsersMau("40");
    setFormWeeklyActivityWeeks("4");
    setFormDocsUsage("100");
    setFormBaseUsage("50");
    setFormTaskUsage("20");
    setFormWorkflowUsage("15");
    setFormTicketCount("0");
    setFormSlaBreaches("0");
    setFormCsat("5");
    setFormTrainingAttendance("5");
    setFormHealth("green");
    setFormInterpretation("");
    setFormExpansionSignal("no");
    setFormNextAction("");
    setFormNextReviewDate("2026-07-15");
    setFormOwner(principal === "founder" ? "Kha Nguyen" : "Đội chăm sóc khách hàng");
    setFormEscalationOwner("Founder");
    setFormEscalationNote("");
  };

  const handleSaveReview = async () => {
    if (!formMonth) {
      alert("Vui lòng chọn tháng review.");
      return;
    }
    if (!formOwner) {
      alert("Vui lòng nhập người phụ trách chăm sóc khách hàng.");
      return;
    }
    if (!formNextAction) {
      alert("Vui lòng nhập hành động đề xuất.");
      return;
    }
    
    if (!formMetricsAvailable && !formUnavailabilityReason) {
      alert("Vui lòng chọn lý do chưa có số liệu.");
      return;
    }
    
    if ((formHealth === "amber" || formHealth === "red") && (!formEscalationOwner || !formEscalationNote)) {
      alert("Khách hàng cần chú ý hoặc rủi ro cao phải có người xử lý và ghi chú theo dõi.");
      return;
    }
    
    const licensed = Number(formLicensedUsers) || 0;
    const mau = Number(formActiveUsersMau) || 0;
    const computedAdoption = licensed > 0 ? Number(((mau / licensed) * 100).toFixed(2)) : 0;

    const newReview = {
      month: formMonth,
      dataSource: formDataSource,
      confidence: formConfidence,
      metricsAvailable: formMetricsAvailable,
      unavailabilityReason: formMetricsAvailable ? undefined : formUnavailabilityReason,
      
      licensedUsers: formMetricsAvailable ? licensed : undefined,
      activeUsersMau: formMetricsAvailable ? mau : undefined,
      adoptionRate: formMetricsAvailable ? computedAdoption : undefined,
      weeklyActivityWeeks: formMetricsAvailable ? (Number(formWeeklyActivityWeeks) || 0) : undefined,
      docsUsage: formMetricsAvailable ? (Number(formDocsUsage) || 0) : undefined,
      baseUsage: formMetricsAvailable ? (Number(formBaseUsage) || 0) : undefined,
      taskUsage: formMetricsAvailable ? (Number(formTaskUsage) || 0) : undefined,
      workflowUsage: formMetricsAvailable ? (Number(formWorkflowUsage) || 0) : undefined,
      ticketCount: formMetricsAvailable ? (Number(formTicketCount) || 0) : undefined,
      slaBreaches: formMetricsAvailable ? (Number(formSlaBreaches) || 0) : undefined,
      csat: formMetricsAvailable ? (formCsat ? Number(formCsat) : undefined) : undefined,
      trainingAttendance: formMetricsAvailable ? (Number(formTrainingAttendance) || 0) : undefined,
      
      healthScore: formHealth,
      interpretation: formInterpretation,
      expansionSignal: formExpansionSignal,
      nextAction: formNextAction,
      nextReviewDate: formNextReviewDate,
      owner: formOwner,
      
      escalationOwner: (formHealth === "amber" || formHealth === "red") ? formEscalationOwner : undefined,
      escalationNote: (formHealth === "amber" || formHealth === "red") ? formEscalationNote : undefined
    };

    setSavingReview(true);
    setReviewError("");
    try {
      const response = await fetch(`/api/accounts/${encodeURIComponent(account.id)}/usage-reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newReview)
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const savedReview = await response.json() as AccountUsageReviewSummary;
      setReviews((current) => [savedReview, ...current.filter((review) => review.id !== savedReview.id)]);
      setShowRecordForm(false);
      logAction(`Recorded monthly usage review for ${formMonth} with Health Score: ${formHealth}`);
      resetForm();
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "Không thể lưu review sử dụng.");
    } finally {
      setSavingReview(false);
    }
  };

  // Calculate live adoption rate % for form preview
  const liveLicensed = Number(formLicensedUsers) || 0;
  const liveMau = Number(formActiveUsersMau) || 0;
  const liveAdoptionRate = liveLicensed > 0 ? ((liveMau / liveLicensed) * 100).toFixed(1) : "0.0";

  // Scoped lists based on active filters
  const filteredContacts = contacts.filter(
    c => filterInfluence === "all" || c.influence === filterInfluence
  );

  const filteredOpportunities = opportunities.filter(opp => {
    const matchesStage = filterOppStage === "all" 
      ? true 
      : filterOppStage === "open" 
        ? ["discovery", "proposal", "negotiation", "implementation"].includes(opp.stage)
        : opp.stage === filterOppStage;
    const matchesForecast = filterOppForecast === "all" || opp.forecastCategory === filterOppForecast;
    return matchesStage && matchesForecast;
  });

  const filteredProjects = projects.filter(
    p => filterProjStatus === "all" || p.status === filterProjStatus
  );

  return (
    <div className="account-detail-workbench">
      
      {/* Back navigation & Header bar */}
      <div className="account-detail-hero">
        <button 
          onClick={onBack}
          className="account-detail-back"
        >
          <ShopifyIcon name="arrow-left" size={14} />
          <span>Quay lại danh sách</span>
        </button>
        
        <div className="account-detail-hero-grid">
          <div className="account-detail-hero-main">
            <div className="account-detail-avatar" aria-hidden="true">
              {getAccountInitials(isEditingAccount ? editName : account.name)}
            </div>
            <div className="account-detail-identity">
              <div className="account-detail-title-row">
                <h1>{isEditingAccount ? editName || "Khách hàng chưa đặt tên" : account.name}</h1>
                <span className="account-detail-chip info">Giai đoạn: {formatAccountStage(isEditingAccount ? editStage : account.stage)}</span>
                <span className={`account-detail-chip health-${isEditingAccount ? editHealth : account.health || "green"}`}>
                  <span className="account-detail-status-dot" aria-hidden="true"></span>
                  Sức khỏe: {formatAccountHealth(isEditingAccount ? editHealth : account.health)}
                </span>
              </div>
              <p>Quản lý hồ sơ, doanh thu, liên hệ, cơ hội và dự án triển khai trong một góc nhìn.</p>
              <div className="account-detail-chip-row">
                <span className="account-detail-pill">
                  <ShopifyIcon name="users" size={13} />
                  PIC: <strong>{currentPicName}</strong>
                </span>
                <span className="account-detail-pill">
                  <ShopifyIcon name="spark" size={13} />
                  {contacts.length} liên hệ
                </span>
                <span className="account-detail-pill">
                  <ShopifyIcon name="briefcase" size={13} />
                  {opportunities.length} cơ hội
                </span>
                <span className="account-detail-pill">
                  <ShopifyIcon name="briefcase" size={13} />
                  {projects.length} dự án
                </span>
              </div>
            </div>
          </div>

          <div className="account-detail-actions">
            {isEditingAccount ? (
              <>
                <button
                  onClick={() => {
                    setAccountConfirm({
                      title: "Hủy chỉnh sửa?",
                      description: "Các thay đổi chưa lưu sẽ được bỏ qua và hồ sơ quay về dữ liệu hiện tại.",
                      confirmLabel: "Hủy sửa",
                      tone: "danger",
                      onConfirm: () => setIsEditingAccount(false)
                    });
                  }}
                  className="account-detail-action secondary"
                >
                  <ShopifyIcon name="x" size={14} />
                  Hủy sửa
                </button>
                <button
                  onClick={() => {
                    setAccountConfirm({
                      title: "Lưu thay đổi khách hàng?",
                      description: "Thông tin hồ sơ, giá trị thương mại và ghi chú vận hành sẽ được cập nhật trên màn hình khách hàng.",
                      confirmLabel: "Lưu thay đổi",
                      onConfirm: saveAccountEdit
                    });
                  }}
                  className="account-detail-action primary"
                >
                  <ShopifyIcon name="check" size={14} />
                  Lưu thay đổi
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setAccountConfirm({
                    title: "Bắt đầu sửa khách hàng?",
                    description: "Màn hình sẽ chuyển sang chế độ sửa inline để bạn cập nhật thông tin chính ngay trong hồ sơ.",
                    confirmLabel: "Bắt đầu sửa",
                    onConfirm: beginAccountEdit
                  });
                }}
                className="account-detail-action secondary"
              >
                <ShopifyIcon name="edit" size={14} />
                Sửa khách hàng
              </button>
            )}

            {/* Delete Button */}
            <button
              onClick={() => {
                setAccountConfirm({
                  title: "Xóa khách hàng?",
                  description: `Khách hàng ${account.name} sẽ bị xóa khỏi danh sách đang xem cùng dữ liệu liên quan trên màn hình này.`,
                  confirmLabel: "Xóa khách hàng",
                  tone: "danger",
                  onConfirm: () => onDeleteAccount(account.id)
                });
              }}
              className="account-detail-action danger"
            >
              <ShopifyIcon name="x" size={14} />
              Xóa khách hàng
            </button>
          </div>
        </div>

        <div className="account-detail-metric-grid" aria-label="Chỉ số khách hàng">
          <div className="account-detail-metric-card">
            <span>Giá trị hợp đồng năm</span>
            <strong>
              {isEditingAccount
                ? editAnnualValue || "0"
                : isAnnualRestricted
                  ? "Đang ẩn"
                  : account.annualValue
                    ? <MoneyAmount value={account.annualValue} />
                    : "0 đ"}
            </strong>
            <small>{isAnnualRestricted && !isEditingAccount ? "Chưa có quyền hoặc chưa nhập giá trị" : "Theo quyền xem hiện tại"}</small>
          </div>
          <div className="account-detail-metric-card">
            <span>Sức khỏe khách hàng</span>
            <strong>{formatAccountHealth(isEditingAccount ? editHealth : account.health)}</strong>
            <small>{(isEditingAccount ? editHealth : account.health) === "green" ? "Đang ổn định" : (isEditingAccount ? editHealth : account.health) === "amber" ? "Cần chăm sóc sát hơn" : "Cần xử lý sớm"}</small>
          </div>
          <div className="account-detail-metric-card">
            <span>Giai đoạn hiện tại</span>
            <strong>{formatAccountStage(isEditingAccount ? editStage : account.stage)}</strong>
            <small>PIC {currentPicName}</small>
          </div>
          <div className="account-detail-metric-card">
            <span>Tín hiệu liên quan</span>
            <strong>{contacts.length + opportunities.length + projects.length}</strong>
            <small>Liên hệ, cơ hội và dự án</small>
          </div>
        </div>
      </div>
 
      {/* Main Two-Column Layout */}
      <div className="account-detail-layout">
        
        {/* Left Column: Key Parameters */}
        <div className="account-detail-stack">
          
          {/* Card 1: Account Info */}
          <div className="account-detail-card">
            <span className="account-detail-card-title">
              <ShopifyIcon name="info" size={14} />
              Hồ sơ vận hành
            </span>
            {isEditingAccount ? (
              <div className="account-inline-form">
                <label className="account-inline-field">
                  <span>Tên khách hàng</span>
                  <input className="account-inline-input" value={editName} onChange={event => setEditName(event.target.value)} />
                </label>
                <label className="account-inline-field">
                  <span>Tên viết tắt</span>
                  <input className="account-inline-input" value={editCode} onChange={event => setEditCode(event.target.value)} />
                </label>
                <div className="account-inline-field wide">
                  <CustomDropdown
                    label="PIC"
                    value={editPicUserId}
                    options={picOptions}
                    onChange={setEditPicUserId}
                    searchable
                    searchPlaceholder="Tìm tên, email hoặc vai trò..."
                  />
                </div>
                <CustomDropdown
                  label="Giai đoạn"
                  value={editStage}
                  options={accountStageOptions}
                  onChange={setEditStage}
                />
                <CustomDropdown
                  label="Sức khỏe"
                  value={editHealth}
                  options={[
                    { value: "green", label: "Ổn định", icon: "check", iconTone: "success" },
                    { value: "amber", label: "Cần chú ý", icon: "clock", iconTone: "warning" },
                    { value: "red", label: "Rủi ro cao", icon: "alert", iconTone: "critical" }
                  ]}
                  onChange={setEditHealth}
                />
              </div>
            ) : (
              <div className="account-detail-field-grid">
                <div className="account-detail-field">
                  <span>PIC</span>
                  <strong>{currentPicName}</strong>
                </div>
                <div className="account-detail-field">
                  <span>Sức khỏe</span>
                  <strong>
                    <span className={`account-detail-label-chip ${account.health === "red" ? "danger" : account.health === "amber" ? "warning" : "success"}`}>
                      {formatAccountHealth(account.health)}
                    </span>
                  </strong>
                </div>
                <div className="account-detail-field wide">
                  <span>Giai đoạn</span>
                  <strong>{formatAccountStage(account.stage)}</strong>
                </div>
              </div>
            )}
          </div>
  
          {/* Card 2: Financial Metrics */}
          <div className="account-detail-card">
            <span className="account-detail-card-title">
              <ShopifyIcon name="cash" size={14} />
              Giá trị thương mại
            </span>
            {isEditingAccount ? (
              <label className="account-inline-field">
                <span>Giá trị hợp đồng năm</span>
                <div className="account-inline-money">
                  <input
                    className="account-inline-input"
                    value={editAnnualValue}
                    onChange={event => setEditAnnualValue(formatVndInputValue(event.target.value))}
                    inputMode="numeric"
                  />
                  <span>đ</span>
                </div>
              </label>
            ) : (
              <div className="account-detail-finance">
                <span>Giá trị hợp đồng năm</span>
                <strong>
                  {isAnnualRestricted ? (
                    <span className="account-detail-restricted">
                      <ShopifyIcon name="shield" size={14} />
                      Đang ẩn
                    </span>
                  ) : account.annualValue ? <MoneyAmount value={account.annualValue} /> : "0 đ"}
                </strong>
                <small>
                  {isAnnualRestricted ? "Chưa có dữ liệu thương mại để hiển thị." : "Hiển thị theo quyền xem hiện tại."}
                </small>
              </div>
            )}
          </div>
  
          {/* Card 3: Commercial Profile */}
          <div className="account-detail-card">
            <span className="account-detail-card-title">
              <ShopifyIcon name="briefcase" size={14} />
              Ghi chú thương mại
            </span>
            {isEditingAccount ? (
              <label className="account-inline-field">
                <span>Ghi chú</span>
                <textarea
                  className="account-inline-textarea"
                  value={editCommercialNote}
                  onChange={event => setEditCommercialNote(event.target.value)}
                  placeholder="Chiến lược, mục tiêu pilot, người quyết định..."
                />
              </label>
            ) : (
              <div className="account-detail-note">
                <p>
                  {isCommercialRestricted ? (
                    <span className="account-detail-restricted">
                      <ShopifyIcon name="shield" size={12} />
                      Chưa có ghi chú
                    </span>
                  ) : account.commercialNote || "Chưa có ghi chú"}
                </p>
              </div>
            )}
          </div>
  
        </div>
  
        {/* Right Column: Dynamic Tabs and Decks */}
        <div className="account-detail-stack">
          
          {/* Tab Header Deck */}
          <div className="account-detail-tab-card">
            <div className="account-detail-tabs" role="tablist" aria-label="Thông tin chi tiết khách hàng">
              <TabHeader
                active={activeTab === "overview"}
                onClick={() => setActiveTab("overview")}
                label="Tổng quan"
                icon={(
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                )}
              />
              <TabHeader
                active={activeTab === "contacts"}
                onClick={() => setActiveTab("contacts")}
                label={`Liên hệ (${contactsLoading ? "..." : contacts.length})`}
                icon={(
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                  </svg>
                )}
              />
              <TabHeader
                active={activeTab === "opportunities"}
                onClick={() => setActiveTab("opportunities")}
                label={`Cơ hội (${opportunities.length})`}
                icon={(
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="20" x2="18" y2="10"></line>
                    <line x1="12" y1="20" x2="12" y2="4"></line>
                    <line x1="6" y1="20" x2="6" y2="14"></line>
                  </svg>
                )}
              />
              <TabHeader
                active={activeTab === "projects"}
                onClick={() => setActiveTab("projects")}
                label={`Dự án (${projects.length})`}
                icon={(
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  </svg>
                )}
              />
            </div>
 
            {/* Tab Deck Content Panel */}
            <div className="account-detail-tab-content">
              
              {/* Tab 1: Overview Summary & CS Reviews */}
              {activeTab === "overview" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <h3 style={{ fontSize: "15px", fontWeight: 600, color: "var(--text)", margin: 0 }}>Góc nhìn khách hàng 360</h3>
                      <span style={{ fontSize: "11px", color: "var(--text-subtle)" }}>Tình hình vận hành và chăm sóc khách hàng</span>
                    </div>
                    
                    {!showRecordForm && (
                      <button 
                        onClick={() => { setShowRecordForm(true); resetForm(); }}
                        style={{
                          background: "var(--accent)",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "var(--radius-sm)",
                          padding: "var(--space-2) var(--space-4)",
                          fontSize: "12px",
                          fontWeight: 600,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--space-1)",
                          transition: "background 0.2s"
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-hover)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--accent)")}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <line x1="12" y1="5" x2="12" y2="19"></line>
                          <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        Ghi nhận review tháng
                      </button>
                    )}
                  </div>
                  
                  {/* Status Box */}
                  <div style={{
                    padding: "var(--space-4)",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                    background: "var(--panel-strong)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-2)"
                  }}>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>Tóm tắt vận hành</span>
                    <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0, lineHeight: "1.5", fontWeight: 400 }}>
                      Khách hàng đang ở giai đoạn <strong style={{ color: "var(--text)", fontWeight: 600 }}>{formatAccountStage(account.stage)}</strong>, PIC là <strong style={{ fontWeight: 600 }}>{getAccountPicName(account)}</strong>. Hiện có <strong style={{ fontWeight: 600 }}>{contacts.length}</strong> liên hệ, <strong style={{ fontWeight: 600 }}>{opportunities.length}</strong> cơ hội bán hàng và <strong style={{ fontWeight: 600 }}>{projects.length}</strong> dự án triển khai.
                    </p>
                  </div>

                  {/* FORM: Record Monthly Review */}
                  {showRecordForm && (
                    <div style={{
                      padding: "var(--space-4)",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--accent-soft-strong)",
                      background: "var(--panel-strong)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-4)",
                      animation: "shopify-section-enter 200ms ease-out"
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-2)" }}>
                        <h4 style={{ fontSize: "14px", fontWeight: 700, color: "var(--accent)", margin: 0 }}>
                          Review sử dụng Lark theo tháng
                        </h4>
                      </div>
                      {reviewError ? <div className="accounts-form-error">{reviewError}</div> : null}

                      {/* Period & Source Selectors */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-3)", zIndex: 1001 }}>
                        <CustomDropdown
                          label="Tháng"
                          value={formMonth}
                          options={formMonthOptions}
                          onChange={setFormMonth}
                        />
                        <CustomDropdown
                          label="Nguồn số liệu"
                          value={formDataSource}
                          options={dataSourceOptions}
                          onChange={setFormDataSource}
                        />
                        <CustomDropdown
                          label="Độ tin cậy"
                          value={formConfidence}
                          options={confidenceOptions}
                          onChange={setFormConfidence}
                        />
                      </div>

                      {/* Availability Checkbox Toggle */}
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                        <input 
                          type="checkbox" 
                          id="form-metrics-available" 
                          checked={formMetricsAvailable} 
                          onChange={(e) => setFormMetricsAvailable(e.target.checked)}
                          style={{ cursor: "pointer" }}
                        />
                        <label htmlFor="form-metrics-available" style={{ fontSize: "13px", fontWeight: 400, color: "var(--text)", cursor: "pointer" }}>
                          Có số liệu sử dụng Lark cho kỳ này
                        </label>
                      </div>

                      {/* Unavailability Reason Form */}
                      {!formMetricsAvailable && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", padding: "var(--space-3)", border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)", zIndex: 1001 }}>
                          <CustomDropdown
                            label="Lý do chưa có số liệu"
                            value={formUnavailabilityReason}
                            options={unavailabilityReasonOptions}
                            onChange={setFormUnavailabilityReason}
                          />
                        </div>
                      )}

                      {/* Metrics Input Fields Grid */}
                      {formMetricsAvailable && (
                        <div style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr 1fr 1fr",
                          gap: "var(--space-3)",
                          padding: "var(--space-4)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          background: "var(--panel)"
                        }}>
                          <div style={{ gridColumn: "span 4", fontSize: "11px", fontWeight: 400, color: "var(--text-muted)", textTransform: "none", borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-1)", letterSpacing: "0.05em" }}>
                            Bộ chỉ số sử dụng cần ghi nhận
                          </div>
                          
                          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                            <label style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 400, textTransform: "none", letterSpacing: "0.05em" }}>Người dùng được cấp</label>
                            <input 
                              type="number" 
                              value={formLicensedUsers} 
                              onChange={(e) => setFormLicensedUsers(e.target.value)} 
                              style={{ padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel-strong)", color: "var(--text)", fontSize: "13px", outline: "none" }}
                            />
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                            <label style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 400, textTransform: "none", letterSpacing: "0.05em" }}>Người dùng hoạt động</label>
                            <input 
                              type="number" 
                              value={formActiveUsersMau} 
                              onChange={(e) => setFormActiveUsersMau(e.target.value)} 
                              style={{ padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel-strong)", color: "var(--text)", fontSize: "13px", outline: "none" }}
                            />
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                            <label style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 400, textTransform: "none", letterSpacing: "0.05em" }}>Tỷ lệ sử dụng</label>
                            <input 
                              type="text" 
                              value={`${liveAdoptionRate}%`} 
                              disabled 
                              style={{ padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel-muted)", color: "var(--text-muted)", fontWeight: 600, cursor: "not-allowed", fontSize: "13px" }}
                            />
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                            <label style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 400, textTransform: "none", letterSpacing: "0.05em" }}>Tuần có hoạt động</label>
                            <input 
                              type="number" 
                              value={formWeeklyActivityWeeks} 
                              onChange={(e) => setFormWeeklyActivityWeeks(e.target.value)} 
                              style={{ padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel-strong)", color: "var(--text)", fontSize: "13px", outline: "none" }}
                            />
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                            <label style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 400, textTransform: "none", letterSpacing: "0.05em" }}>Tài liệu tạo mới</label>
                            <input 
                              type="number" 
                              value={formDocsUsage} 
                              onChange={(e) => setFormDocsUsage(e.target.value)} 
                              style={{ padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel-strong)", color: "var(--text)", fontSize: "13px", outline: "none" }}
                            />
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                            <label style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 400, textTransform: "none", letterSpacing: "0.05em" }}>Base tạo mới</label>
                            <input 
                              type="number" 
                              value={formBaseUsage} 
                              onChange={(e) => setFormBaseUsage(e.target.value)} 
                              style={{ padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel-strong)", color: "var(--text)", fontSize: "13px", outline: "none" }}
                            />
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                            <label style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 400, textTransform: "none", letterSpacing: "0.05em" }}>Công việc tạo mới</label>
                            <input 
                              type="number" 
                              value={formTaskUsage} 
                              onChange={(e) => setFormTaskUsage(e.target.value)} 
                              style={{ padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel-strong)", color: "var(--text)", fontSize: "13px", outline: "none" }}
                            />
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                            <label style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 400, textTransform: "none", letterSpacing: "0.05em" }}>Lượt chạy phê duyệt</label>
                            <input 
                              type="number" 
                              value={formWorkflowUsage} 
                              onChange={(e) => setFormWorkflowUsage(e.target.value)} 
                              style={{ padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel-strong)", color: "var(--text)", fontSize: "13px", outline: "none" }}
                            />
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                            <label style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 400, textTransform: "none", letterSpacing: "0.05em" }}>Ticket hỗ trợ</label>
                            <input 
                              type="number" 
                              value={formTicketCount} 
                              onChange={(e) => setFormTicketCount(e.target.value)} 
                              style={{ padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel-strong)", color: "var(--text)", fontSize: "13px", outline: "none" }}
                            />
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                            <label style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 400, textTransform: "none", letterSpacing: "0.05em" }}>Lần trễ cam kết</label>
                            <input 
                              type="number" 
                              value={formSlaBreaches} 
                              onChange={(e) => setFormSlaBreaches(e.target.value)} 
                              style={{ padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel-strong)", color: "var(--text)", fontSize: "13px", outline: "none" }}
                            />
                          </div>
                          
                          <CustomDropdown
                            label="Điểm hài lòng"
                            value={formCsat}
                            options={csatOptions}
                            onChange={setFormCsat}
                          />

                          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                            <label style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 400, textTransform: "none", letterSpacing: "0.05em" }}>Người tham gia đào tạo</label>
                            <input 
                              type="number" 
                              value={formTrainingAttendance} 
                              onChange={(e) => setFormTrainingAttendance(e.target.value)} 
                              style={{ padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel-strong)", color: "var(--text)", fontSize: "13px", outline: "none" }}
                            />
                          </div>
                        </div>
                      )}

                      {/* CS Qualitative inputs */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", zIndex: 1001 }}>
                        <CustomDropdown
                          label="Đánh giá sức khỏe"
                          value={formHealth}
                          options={formHealthOptions}
                          onChange={setFormHealth}
                        />
                        <CustomDropdown
                          label="Tín hiệu mở rộng"
                          value={formExpansionSignal}
                          options={expansionSignalOptions}
                          onChange={setFormExpansionSignal}
                        />
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                        <label style={{ fontSize: "11px", fontWeight: 400, color: "var(--text-muted)", textTransform: "none", letterSpacing: "0.05em" }}>
                          Nhận định & ghi chú chăm sóc khách hàng
                        </label>
                        <textarea 
                          rows={2}
                          value={formInterpretation}
                          onChange={(e) => setFormInterpretation(e.target.value)}
                          placeholder="Tóm tắt diễn giải số liệu và ghi chú từ khách hàng..."
                          style={{ padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: "13px", outline: "none" }}
                        />
                      </div>

                      {/* Escalation required warning card */}
                      {(formHealth === "amber" || formHealth === "red") && (
                        <div style={{
                          padding: "var(--space-3) var(--space-4)",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid #ffc453",
                          background: "#fff9eb",
                          display: "flex",
                          flexDirection: "column",
                          gap: "var(--space-2)"
                        }}>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: "#a05e00", display: "flex", alignItems: "center", gap: "6px" }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                              <line x1="12" y1="9" x2="12" y2="13"></line>
                              <line x1="12" y1="17" x2="12.01" y2="17"></line>
                            </svg>
                            Cần người phụ trách xử lý
                          </span>
                          <p style={{ fontSize: "12px", color: "#6b4300", margin: 0, lineHeight: "1.4" }}>
                            Khi khách hàng cần chú ý hoặc rủi ro cao, cần gán người xử lý và ghi rõ hoạt động theo dõi.
                          </p>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "var(--space-2)", marginTop: "4px", alignItems: "end", zIndex: 1001 }}>
                            <CustomDropdown
                              label="Người xử lý"
                              value={formEscalationOwner}
                              options={roles}
                              onChange={setFormEscalationOwner}
                            />
                            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                              <label style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 400, textTransform: "none", letterSpacing: "0.05em" }}>Ghi chú theo dõi</label>
                              <input
                                type="text"
                                value={formEscalationNote}
                                onChange={(e) => setFormEscalationNote(e.target.value)}
                                placeholder="Mô tả việc cần làm ngay để gỡ rủi ro..."
                                style={{ padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "white", color: "var(--text)", fontSize: "13px", outline: "none" }}
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-3)" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                          <label style={{ fontSize: "11px", fontWeight: 400, color: "var(--text-muted)", textTransform: "none", letterSpacing: "0.05em" }}>Hành động đề xuất</label>
                          <input 
                            type="text"
                            value={formNextAction}
                            onChange={(e) => setFormNextAction(e.target.value)}
                            placeholder="VD: Đặt lịch hướng dẫn Lark Docs nâng cao"
                            style={{ padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: "13px", outline: "none" }}
                          />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                          <label style={{ fontSize: "11px", fontWeight: 400, color: "var(--text-muted)", textTransform: "none", letterSpacing: "0.05em" }}>Ngày review tiếp theo</label>
                          <input 
                            type="date"
                            value={formNextReviewDate}
                            onChange={(e) => setFormNextReviewDate(e.target.value)}
                            style={{ padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: "13px", outline: "none" }}
                          />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                          <label style={{ fontSize: "11px", fontWeight: 400, color: "var(--text-muted)", textTransform: "none", letterSpacing: "0.05em" }}>Phụ trách chăm sóc</label>
                          <input 
                            type="text"
                            value={formOwner}
                            onChange={(e) => setFormOwner(e.target.value)}
                            style={{ padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: "13px", outline: "none" }}
                          />
                        </div>
                      </div>

                      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-2)", borderTop: "1px solid var(--border)", paddingTop: "var(--space-3)" }}>
                        <button 
                          onClick={() => setShowRecordForm(false)}
                          style={{
                            background: "var(--panel-strong)",
                            border: "1px solid var(--border)",
                            color: "var(--text)",
                            borderRadius: "var(--radius-sm)",
                            padding: "var(--space-2) var(--space-4)",
                            fontSize: "13px",
                            cursor: "pointer"
                          }}
                        >
                          Hủy
                        </button>
                        <button 
                          onClick={handleSaveReview}
                          disabled={savingReview}
                          style={{
                            background: savingReview ? "var(--text-muted)" : "var(--accent)",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: "var(--radius-sm)",
                            padding: "var(--space-2) var(--space-5)",
                            fontSize: "13px",
                            fontWeight: 600,
                            cursor: savingReview ? "progress" : "pointer"
                          }}
                        >
                          {savingReview ? "Đang lưu..." : "Lưu review"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* TIMELINE / LIST OF REVIEWS */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)", textTransform: "none", borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-2)" }}>
                      Lịch sử review tháng
                    </div>

                    {reviewsLoading ? (
                      <div style={{ display: "flex", justifyItems: "center", alignItems: "center", justifyContent: "center", padding: "var(--space-6) 0", border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)" }}>
                        <PolarisFallbackText>Đang tải review sử dụng Lark...</PolarisFallbackText>
                      </div>
                    ) : reviewError ? (
                      <div style={{ display: "flex", justifyItems: "center", alignItems: "center", justifyContent: "center", padding: "var(--space-6) 0", border: "1px dashed var(--danger)", borderRadius: "var(--radius-sm)" }}>
                        <PolarisFallbackText>{reviewError}</PolarisFallbackText>
                      </div>
                    ) : reviews.length ? (
                      reviews.map((rev: any) => {
                        const isExpanded = expandedReviewId === rev.id;
                        const isRevAmberRed = rev.healthScore === "amber" || rev.healthScore === "red";
                        
                        return (
                          <div 
                            key={rev.id}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "var(--space-2)",
                              border: "1px solid var(--border)",
                              borderLeft: `4px solid ${
                                rev.healthScore === "green" ? "var(--success)" : rev.healthScore === "amber" ? "var(--warning)" : "var(--danger)"
                              }`,
                              borderRadius: "var(--radius-sm)",
                              background: "var(--panel)",
                              padding: "var(--space-4)",
                              boxShadow: "var(--shadow-soft)",
                              transition: "all 0.2s ease"
                            }}
                          >
                            {/* Review Header card */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "var(--space-2)" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                                <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text)" }}>
                                  {formatReviewMonth(rev.month)}
                                </span>
                                <s-badge tone={rev.healthScore === "green" ? "success" : rev.healthScore === "amber" ? "warning" : "critical"}>
                                  Sức khỏe: {formatAccountHealth(rev.healthScore)}
                                </s-badge>
                                {rev.expansionSignal === "yes" && <s-badge tone="info">Có tín hiệu mở rộng</s-badge>}
                              </div>
                              <div style={{ fontSize: "12px", color: "var(--text-subtle)" }}>
                                Phụ trách chăm sóc: <strong style={{ fontWeight: 600 }}>{rev.owner}</strong>
                              </div>
                            </div>

                            {/* Qualitative assessment text */}
                            <div style={{ margin: "4px 0" }}>
                              <span style={{ fontSize: "11px", color: "var(--text-subtle)", textTransform: "none", fontWeight: 400 }}>
                                Nhận định
                              </span>
                              <p style={{ fontSize: "13px", color: "var(--text)", margin: "2px 0 0 0", lineHeight: "1.4" }}>
                                {rev.interpretation || "Chưa có nhận định."}
                              </p>
                            </div>

                            {/* Key action & reviews target */}
                            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--space-3)", background: "var(--panel-strong)", padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
                              <div>
                                <span style={{ fontSize: "10.5px", color: "var(--text-muted)", textTransform: "none", fontWeight: 400 }}>
                                  Hành động đề xuất
                                </span>
                                <strong style={{ fontSize: "12.5px", color: "var(--text)", fontWeight: 600 }}>{rev.nextAction}</strong>
                              </div>
                              <div>
                                <span style={{ fontSize: "10.5px", color: "var(--text-muted)", textTransform: "none", fontWeight: 400 }}>
                                  Review tiếp theo
                                </span>
                                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{formatShortDate(rev.nextReviewDate)}</span>
                              </div>
                            </div>

                            {/* Escalation alert log row */}
                            {isRevAmberRed && rev.escalationOwner && (
                              <div style={{
                                padding: "var(--space-2) var(--space-3)",
                                borderRadius: "var(--radius-sm)",
                                background: rev.healthScore === "red" ? "var(--danger-soft)" : "var(--warning-soft)",
                                border: `1px solid ${rev.healthScore === "red" ? "#ffd3cb" : "#ffe4b3"}`,
                                fontSize: "12px",
                                display: "flex",
                                flexDirection: "column",
                                gap: "var(--space-1)"
                              }}>
                                <span style={{ fontWeight: 600, color: rev.healthScore === "red" ? "var(--danger)" : "#b27300", display: "flex", alignItems: "center", gap: "4px" }}>
                                  Cần xử lý bởi {rev.escalationOwner}
                                </span>
                                <p style={{ margin: 0, color: "var(--text)", fontSize: "12.5px" }}>
                                  {rev.escalationNote}
                                </p>
                              </div>
                            )}

                            {/* Toggle metric display */}
                            <button
                              onClick={() => setExpandedReviewId(isExpanded ? null : rev.id)}
                              style={{
                                background: "none",
                                border: "none",
                                color: "var(--accent)",
                                fontSize: "12px",
                                fontWeight: 500,
                                cursor: "pointer",
                                alignSelf: "flex-start",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                                padding: 0,
                                outline: "none"
                              }}
                            >
                              <span>{isExpanded ? "Ẩn chỉ số sử dụng" : "Xem chỉ số sử dụng"}</span>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                                <polyline points="6 9 12 15 18 9"></polyline>
                              </svg>
                            </button>

                            {/* Metric Grid Display inside Expanded area */}
                            {isExpanded && (
                              <div style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "var(--space-2)",
                                borderTop: "1px solid var(--border)",
                                paddingTop: "var(--space-3)",
                                marginTop: "var(--space-1)",
                                animation: "shopify-section-enter 150ms ease-out"
                              }}>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--text-subtle)", borderBottom: "1px dashed var(--border)", paddingBottom: "var(--space-2)" }}>
                                  <span>Nguồn số liệu: <strong style={{ fontWeight: 600 }}>{rev.dataSource}</strong></span>
                                  <span>Độ tin cậy: <strong style={{ fontWeight: 600 }}>{formatConfidence(rev.confidence)}</strong></span>
                                </div>

                                {rev.metricsAvailable ? (
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "var(--space-2)" }}>
                                    <div style={{ background: "var(--panel-strong)", padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", textAlign: "center" }}>
                                      <span style={{ fontSize: "10px", color: "var(--text-muted)", display: "block" }}>Tỷ lệ sử dụng</span>
                                      <strong style={{ fontSize: "13.5px", color: "var(--text)", fontWeight: 600 }}>{rev.adoptionRate}%</strong>
                                      <span style={{ fontSize: "9px", color: "var(--text-subtle)", display: "block", marginTop: "var(--space-1)" }}>
                                        {rev.activeUsersMau}/{rev.licensedUsers} người hoạt động
                                      </span>
                                    </div>
                                    
                                    <div style={{ background: "var(--panel-strong)", padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", textAlign: "center" }}>
                                      <span style={{ fontSize: "10px", color: "var(--text-muted)", display: "block" }}>Tuần có hoạt động</span>
                                      <strong style={{ fontSize: "13.5px", color: "var(--text)", fontWeight: 600 }}>{rev.weeklyActivityWeeks} tuần</strong>
                                      <span style={{ fontSize: "9px", color: "var(--text-subtle)", display: "block", marginTop: "var(--space-1)" }}>trong tháng</span>
                                    </div>

                                    <div style={{ background: "var(--panel-strong)", padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", textAlign: "center" }}>
                                      <span style={{ fontSize: "10px", color: "var(--text-muted)", display: "block" }}>Tài liệu Lark</span>
                                      <strong style={{ fontSize: "13.5px", color: "var(--text)", fontWeight: 600 }}>{rev.docsUsage}</strong>
                                      <span style={{ fontSize: "9px", color: "var(--text-subtle)", display: "block", marginTop: "var(--space-1)" }}>mục tạo mới</span>
                                    </div>

                                    <div style={{ background: "var(--panel-strong)", padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", textAlign: "center" }}>
                                      <span style={{ fontSize: "10px", color: "var(--text-muted)", display: "block" }}>Lark Base</span>
                                      <strong style={{ fontSize: "13.5px", color: "var(--text)", fontWeight: 600 }}>{rev.baseUsage}</strong>
                                      <span style={{ fontSize: "9px", color: "var(--text-subtle)", display: "block", marginTop: "var(--space-1)" }}>mục tạo mới</span>
                                    </div>

                                    <div style={{ background: "var(--panel-strong)", padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", textAlign: "center" }}>
                                      <span style={{ fontSize: "10px", color: "var(--text-muted)", display: "block" }}>Công việc Lark</span>
                                      <strong style={{ fontSize: "13.5px", color: "var(--text)", fontWeight: 600 }}>{rev.taskUsage}</strong>
                                      <span style={{ fontSize: "9px", color: "var(--text-subtle)", display: "block", marginTop: "var(--space-1)" }}>mục tạo mới</span>
                                    </div>

                                    <div style={{ background: "var(--panel-strong)", padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", textAlign: "center" }}>
                                      <span style={{ fontSize: "10px", color: "var(--text-muted)", display: "block" }}>Phê duyệt Lark</span>
                                      <strong style={{ fontSize: "13.5px", color: "var(--text)", fontWeight: 600 }}>{rev.workflowUsage}</strong>
                                      <span style={{ fontSize: "9px", color: "var(--text-subtle)", display: "block", marginTop: "var(--space-1)" }}>lượt chạy</span>
                                    </div>

                                    <div style={{ background: "var(--panel-strong)", padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", textAlign: "center" }}>
                                      <span style={{ fontSize: "10px", color: "var(--text-muted)", display: "block" }}>Ticket / cam kết</span>
                                      <strong style={{ fontSize: "13.5px", color: "var(--text)", fontWeight: 600 }}>{rev.ticketCount} / {rev.slaBreaches}</strong>
                                      <span style={{ fontSize: "9px", color: "var(--text-subtle)", display: "block", marginTop: "var(--space-1)" }}>ticket / lần trễ</span>
                                    </div>

                                    <div style={{ background: "var(--panel-strong)", padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", textAlign: "center" }}>
                                      <span style={{ fontSize: "10px", color: "var(--text-muted)", display: "block" }}>Hài lòng / đào tạo</span>
                                      <strong style={{ fontSize: "13.5px", color: "var(--text)", fontWeight: 600 }}>
                                        {rev.csat ? `${rev.csat}/5` : "Chưa có"} / {rev.trainingAttendance}
                                      </strong>
                                      <span style={{ fontSize: "9px", color: "var(--text-subtle)", display: "block", marginTop: "var(--space-1)" }}>điểm / người học</span>
                                    </div>
                                  </div>
                                ) : (
                                  <div style={{
                                    padding: "var(--space-3)",
                                    borderRadius: "var(--radius-sm)",
                                    border: "1px dashed var(--border)",
                                    background: "var(--panel-strong)",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "var(--space-2)",
                                    color: "var(--text-muted)"
                                  }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                      <circle cx="12" cy="12" r="10"></circle>
                                      <line x1="12" y1="8" x2="12" y2="12"></line>
                                      <line x1="12" y1="16" x2="12.01" y2="16"></line>
                                    </svg>
                                    <span style={{ fontSize: "12.5px" }}>
                                      Chưa có số liệu sử dụng Lark. Lý do: <strong style={{ fontWeight: 600 }}>{rev.unavailabilityReason}</strong>
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}

                          </div>
                        );
                      })
                    ) : (
                      <div style={{ display: "flex", justifyItems: "center", alignItems: "center", justifyContent: "center", padding: "var(--space-6) 0", border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)" }}>
                        <PolarisFallbackText>Chưa có review sử dụng Lark cho khách hàng này.</PolarisFallbackText>
                      </div>
                    )}
                  </div>

                  {/* Account Change Log Section */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)", textTransform: "none", borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-2)" }}>
                      Lịch sử cập nhật khách hàng
                    </div>
                    <div style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-2)",
                      maxHeight: "300px",
                      overflowY: "auto",
                      paddingRight: "4px"
                    }}>
                      {logs.length ? (
                        logs.map((l: any) => (
                          <div key={l.id} style={{
                            display: "flex",
                            gap: "12px",
                            alignItems: "flex-start",
                            padding: "var(--space-2) var(--space-3)",
                            background: "var(--panel-strong)",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid var(--border)",
                            fontSize: "12.5px"
                          }}>
                            <div style={{
                              fontSize: "11px",
                              color: "var(--text-muted)",
                              fontFamily: "var(--font-sans)",
                              whiteSpace: "nowrap",
                              marginTop: "1.5px"
                            }}>
                              {new Date(l.timestamp).toLocaleDateString("vi-VN")} {new Date(l.timestamp).toLocaleTimeString("vi-VN", { hour: '2-digit', minute: '2-digit' })}
                            </div>
                            <div style={{ color: "var(--text)", lineHeight: "1.4" }}>
                              {l.description}
                            </div>
                          </div>
                        ))
                      ) : (
                        <span style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic" }}>
                          Chưa có cập nhật nào.
                        </span>
                      )}
                    </div>
                  </div>

                </div>
              )}


              {/* Tab 2: Contacts list */}
              {activeTab === "contacts" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  
                  {/* Controls Filter and Add Button bar */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "12px", borderBottom: "1px solid var(--border)", paddingBottom: "12px" }}>
                    <div style={{ display: "flex", gap: "12px", flex: 1, minWidth: "200px" }}>
                      <CustomDropdown
                        label="Vai trò liên hệ"
                        value={filterInfluence}
                        options={[
                          { value: "all", label: "Tất cả vai trò", icon: "person" },
                          { value: "economic_buyer", label: "Người quyết định", icon: "checkmark", iconTone: "success" },
                          { value: "champion", label: "Người ủng hộ", icon: "star", iconTone: "success" },
                          { value: "detractor", label: "Đang rủi ro", icon: "alert-circle", iconTone: "critical" },
                          { value: "neutral", label: "Liên hệ chính", icon: "person", iconTone: "neutral" }
                        ]}
                        onChange={setFilterInfluence}
                      />
                    </div>
                    
                    <button
                      onClick={() => setContactModal({ mode: "create" })}
                      style={{
                        background: "var(--accent)",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                        padding: "var(--space-2) var(--space-4)",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-1)",
                        height: "36px",
                        outline: "none"
                      }}
                    >
                      + Thêm liên hệ
                    </button>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: 0 }}>Liên hệ của khách hàng</h3>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{filteredContacts.length} liên hệ phù hợp</span>
                  </div>

                  {contactsLoading ? (
                    <div style={{ display: "flex", justifyItems: "center", alignItems: "center", justifyContent: "center", padding: "var(--space-6) 0" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)" }}>
                        <span style={{ width: "24px", height: "24px", border: "3px solid var(--border)", borderTop: "3px solid var(--accent)", borderRadius: "50%", animation: "route-state-load 1s linear infinite" as any }}></span>
                        <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>Đang tải liên hệ...</span>
                      </div>
                    </div>
                  ) : filteredContacts.length ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                      {filteredContacts.map(contact => (
                        <div 
                          key={contact.id} 
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: "var(--space-3)",
                            background: "var(--panel-strong)",
                            border: "1px solid var(--border)",
                            borderRadius: "var(--radius-sm)",
                            padding: "var(--space-3)",
                            boxShadow: "var(--shadow-soft)",
                            transition: "all 0.2s ease"
                          }}
                        >
                          <div style={{
                            width: "36px",
                            height: "36px",
                            borderRadius: "50%",
                            background: "var(--accent-soft)",
                            color: "var(--accent)",
                            fontWeight: 600,
                            fontSize: "14px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center"
                          }}>
                            {contact.name.charAt(0)}
                          </div>
                          
                          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                            <span style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--text)" }}>{contact.name}</span>
                            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                              {contact.role || "Chưa có vai trò"}
                            </span>
                            
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginTop: "var(--space-2)" }}>
                              {contact.email && (
                                <a href={`mailto:${contact.email}`} style={{ fontSize: "12px", color: "var(--accent)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}>
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                                    <polyline points="22,6 12,13 2,6"></polyline>
                                  </svg>
                                  {contact.email}
                                </a>
                              )}
                              {contact.phone && (
                                <span style={{ fontSize: "12px", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}>
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                                  </svg>
                                  {contact.phone}
                                </span>
                              )}
                            </div>

                            {/* CRUD Inline buttons */}
                            <div style={{ display: "flex", gap: "8px", marginTop: "var(--space-2)" }}>
                              <button 
                                onClick={() => setContactModal({ mode: "edit", data: contact })}
                                style={{ background: "none", border: "none", color: "var(--accent)", fontSize: "11px", cursor: "pointer", padding: 0, outline: "none" }}
                              >
                                Sửa
                              </button>
                              <span style={{ color: "var(--border)", fontSize: "11px" }}>|</span>
                              <button 
                                onClick={() => {
                                  setAccountConfirm({
                                    title: "Xóa liên hệ?",
                                    description: `Liên hệ ${contact.name} sẽ bị xóa khỏi hồ sơ khách hàng này.`,
                                    confirmLabel: "Xóa liên hệ",
                                    tone: "danger",
                                    onConfirm: () => onDeleteContact(contact.id)
                                  });
                                }}
                                style={{ background: "none", border: "none", color: "var(--danger)", fontSize: "11px", cursor: "pointer", padding: 0, outline: "none" }}
                              >
                                Xóa
                              </button>
                            </div>
                          </div>
                          
                          <span className={`account-detail-label-chip ${getContactInfluenceTone(contact.influence)}`}>
                            {formatContactInfluence(contact.influence)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyItems: "center", alignItems: "center", justifyContent: "center", padding: "var(--space-6) 0", border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)" }}>
                      <PolarisFallbackText>Chưa có liên hệ phù hợp với bộ lọc.</PolarisFallbackText>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 3: Opportunities list */}
              {activeTab === "opportunities" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  
                  {/* Controls bar */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "12px", borderBottom: "1px solid var(--border)", paddingBottom: "12px" }}>
                    <div style={{ display: "flex", gap: "12px", flex: 1, minWidth: "300px" }}>
                      <CustomDropdown
                        label="Giai đoạn"
                        value={filterOppStage}
                        options={[
                          { value: "all", label: "Tất cả giai đoạn", icon: "order" },
                          { value: "open", label: "Đang mở", icon: "clock" },
                          { value: "discovery", label: "Khảo sát", icon: "search" },
                          { value: "proposal", label: "Đề xuất", icon: "star" },
                          { value: "negotiation", label: "Đàm phán", icon: "share" },
                          { value: "implementation", label: "Triển khai", icon: "settings" },
                          { value: "won", label: "Đã thắng", icon: "checkmark", iconTone: "success" },
                          { value: "lost", label: "Đã mất", icon: "alert-circle", iconTone: "critical" }
                        ]}
                        onChange={setFilterOppStage}
                      />
                      <CustomDropdown
                        label="Dự báo"
                        value={filterOppForecast}
                        options={[
                          { value: "all", label: "Tất cả dự báo", icon: "star" },
                          { value: "pipeline", label: "Đang theo dõi", icon: "clock" },
                          { value: "best_case", label: "Có tiềm năng", icon: "clock" },
                          { value: "commit", label: "Cam kết", icon: "checkmark", iconTone: "success" }
                        ]}
                        onChange={setFilterOppForecast}
                      />
                    </div>
                    
                    <button
                      onClick={() => setOpportunityModal({ mode: "create" })}
                      style={{
                        background: "var(--accent)",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                        padding: "var(--space-2) var(--space-4)",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-1)",
                        height: "36px",
                        outline: "none"
                      }}
                    >
                      + Thêm cơ hội
                    </button>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: 0 }}>Cơ hội bán hàng liên quan</h3>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{filteredOpportunities.length} cơ hội phù hợp</span>
                  </div>
                  
                  {filteredOpportunities.length ? (
                    <div style={{ display: "grid", gap: "var(--space-2)" }}>
                      {filteredOpportunities.map(opp => (
                        <div 
                          key={opp.id} 
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            background: "var(--panel-strong)",
                            border: "1px solid var(--border)",
                            borderRadius: "var(--radius-sm)",
                            padding: "var(--space-3)",
                            boxShadow: "var(--shadow-soft)",
                            transition: "all 0.2s ease"
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                            <ShopifyIcon name="spark" size={14} />
                            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                              <span style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--text)" }}>{opp.title}</span>
                              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                                Dự báo: {formatForecastCategory(opp.forecastCategory)} · Xác suất: {opp.probability}%
                              </span>

                              {/* CRUD Inline actions */}
                              <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                                <button 
                                  onClick={() => setOpportunityModal({ mode: "edit", data: opp })}
                                  style={{ background: "none", border: "none", color: "var(--accent)", fontSize: "11px", cursor: "pointer", padding: 0, outline: "none" }}
                                >
                                  Sửa
                                </button>
                                <span style={{ color: "var(--border)", fontSize: "11px" }}>|</span>
                                <button 
                                  onClick={() => {
                                    setAccountConfirm({
                                      title: "Xóa cơ hội?",
                                      description: `Cơ hội ${opp.title} sẽ bị xóa khỏi hồ sơ khách hàng này.`,
                                      confirmLabel: "Xóa cơ hội",
                                      tone: "danger",
                                      onConfirm: () => onDeleteOpportunity(opp.id)
                                    });
                                  }}
                                  style={{ background: "none", border: "none", color: "var(--danger)", fontSize: "11px", cursor: "pointer", padding: 0, outline: "none" }}
                                >
                                  Xóa
                                </button>
                              </div>
                            </div>
                          </div>
                          
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "var(--space-1)" }}>
                            <span className="font-mono" style={{ fontSize: "13.5px", fontWeight: 600 }}>
                              {opp.amount ? <MoneyAmount value={opp.amount} /> : "Đang ẩn"}
                            </span>
                            <div style={{ display: "flex", gap: "var(--space-1)" }}>
                              <s-badge tone={opp.stage === "won" ? "success" : opp.stage === "lost" ? "critical" : "warning"}>
                                {formatOpportunityStage(opp.stage)}
                              </s-badge>
                              {opp.stale && <s-badge tone="critical">Cần rà soát</s-badge>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyItems: "center", alignItems: "center", justifyContent: "center", padding: "var(--space-6) 0", border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)" }}>
                      <PolarisFallbackText>Không có cơ hội phù hợp với bộ lọc.</PolarisFallbackText>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 4: Projects list */}
              {activeTab === "projects" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  
                  {/* Controls bar */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "12px", borderBottom: "1px solid var(--border)", paddingBottom: "12px" }}>
                    <div style={{ display: "flex", gap: "12px", flex: 1, minWidth: "200px" }}>
                      <CustomDropdown
                        label="Trạng thái"
                        value={filterProjStatus}
                        options={[
                          { value: "all", label: "Tất cả trạng thái", icon: "order" },
                          { value: "planning", label: "Đang lên kế hoạch", icon: "clock" },
                          { value: "active", label: "Đang chạy", icon: "star", iconTone: "info" },
                          { value: "completed", label: "Hoàn tất", icon: "checkmark", iconTone: "success" }
                        ]}
                        onChange={setFilterProjStatus}
                      />
                    </div>
                    
                    <button
                      onClick={() => setProjectModal({ mode: "create" })}
                      style={{
                        background: "var(--accent)",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                        padding: "var(--space-2) var(--space-4)",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-1)",
                        height: "36px",
                        outline: "none"
                      }}
                    >
                      + Thêm dự án
                    </button>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: 0 }}>Dự án triển khai liên quan</h3>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{filteredProjects.length} dự án phù hợp</span>
                  </div>

                  {filteredProjects.length ? (
                    <div style={{ display: "grid", gap: "var(--space-2)" }}>
                      {filteredProjects.map(proj => (
                        <div 
                          key={proj.id} 
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            background: "var(--panel-strong)",
                            border: "1px solid var(--border)",
                            borderRadius: "var(--radius-sm)",
                            padding: "var(--space-3)",
                            boxShadow: "var(--shadow-soft)",
                            transition: "all 0.2s ease"
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                            <ShopifyIcon name="briefcase" size={14} />
                            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                              <span style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--text)" }}>{proj.name}</span>
                              {/* CRUD Inline actions */}
                              <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                                <button 
                                  onClick={() => setProjectModal({ mode: "edit", data: proj })}
                                  style={{ background: "none", border: "none", color: "var(--accent)", fontSize: "11px", cursor: "pointer", padding: 0, outline: "none" }}
                                >
                                  Sửa
                                </button>
                                <span style={{ color: "var(--border)", fontSize: "11px" }}>|</span>
                                <button 
                                  onClick={() => {
                                    setAccountConfirm({
                                      title: "Xóa dự án?",
                                      description: `Dự án ${proj.name} sẽ bị xóa khỏi hồ sơ khách hàng này.`,
                                      confirmLabel: "Xóa dự án",
                                      tone: "danger",
                                      onConfirm: () => onDeleteProject(proj.id)
                                    });
                                  }}
                                  style={{ background: "none", border: "none", color: "var(--danger)", fontSize: "11px", cursor: "pointer", padding: 0, outline: "none" }}
                                >
                                  Xóa
                                </button>
                              </div>
                            </div>
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "var(--space-1)" }}>
                            {proj.marginPercent !== undefined ? (
                              <span style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--text)" }}>
                                Biên lợi nhuận: {formatDecimalNumber(proj.marginPercent)}%
                              </span>
                            ) : (
                              <span className="account-detail-label-chip neutral">
                                Biên lợi nhuận đang ẩn
                              </span>
                            )}
                            <span className={`account-detail-label-chip ${getProjectStatusTone(proj.status)}`}>
                              {formatProjectStatus(proj.status)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyItems: "center", alignItems: "center", justifyContent: "center", padding: "var(--space-6) 0", border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)" }}>
                      <PolarisFallbackText>Chưa có dự án phù hợp với bộ lọc.</PolarisFallbackText>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>

        </div>

      </div>

      {accountConfirm && (
        <ModalLayer onClose={() => setAccountConfirm(null)}>
        <div className="account-confirm-backdrop" role="presentation" onMouseDown={() => setAccountConfirm(null)}>
          <div
            className="account-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-confirm-title"
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="account-confirm-icon" aria-hidden="true">
              <ShopifyIcon name={accountConfirm.tone === "danger" ? "alert" : "info"} size={18} />
            </div>
            <div className="account-confirm-body">
              <h3 id="account-confirm-title">{accountConfirm.title}</h3>
              <p>{accountConfirm.description}</p>
            </div>
            <div className="account-confirm-actions">
              <button className="account-detail-action secondary" onClick={() => setAccountConfirm(null)}>
                Hủy
              </button>
              <button
                className={`account-detail-action ${accountConfirm.tone === "danger" ? "danger" : "primary"}`}
                onClick={() => {
                  accountConfirm.onConfirm();
                  setAccountConfirm(null);
                }}
              >
                {accountConfirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
        </ModalLayer>
      )}

      {/* Contact Form Modal Dialog */}
      <ContactFormModal
        isOpen={contactModal !== null}
        onClose={() => setContactModal(null)}
        contact={contactModal?.mode === "edit" ? contactModal.data : null}
        onSave={async (contactData) => {
          if (contactModal?.mode === "create") {
            await onAddContact(contactData);
          } else {
            await onUpdateContact(contactData);
          }
          setContactModal(null);
        }}
      />

      {/* Opportunity Form Modal Dialog */}
      <OpportunityFormModal
        isOpen={opportunityModal !== null}
        onClose={() => setOpportunityModal(null)}
        opportunity={opportunityModal?.mode === "edit" ? opportunityModal.data : null}
        onSave={async (oppData) => {
          if (opportunityModal?.mode === "create") {
            await onAddOpportunity(oppData);
          } else {
            await onUpdateOpportunity(oppData);
          }
          setOpportunityModal(null);
        }}
      />

      {/* Project Form Modal Dialog */}
      <ProjectFormModal
        isOpen={projectModal !== null}
        onClose={() => setProjectModal(null)}
        project={projectModal?.mode === "edit" ? projectModal.data : null}
        onSave={async (projData) => {
          if (projectModal?.mode === "create") {
            await onAddProject(projData);
          } else {
            await onUpdateProject(projData);
          }
          setProjectModal(null);
        }}
      />

    </div>
  );
}

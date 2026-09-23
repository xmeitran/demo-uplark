"use client";
import { MoneyAmount } from "@/components/money-amount";
import { useDialogAccessibility } from "@/hooks/use-dialog-accessibility";



import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Building2,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Wallet,
  Download,
  LayoutGrid,
  List,
  Mail,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2
} from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/constructor-x/app-shell";
import { CustomDropdown } from "@/components/constructor-x/custom-controls";
import { ModalLayer } from "@/components/modal-layer";
import type { AccountSummary, AccountsResponse } from "@b2b-crm/contracts";
import { downloadCsv } from "@/lib/csv-export";

type SortKey = "name" | "stage" | "tier" | "mrr" | "status" | "health";
type SortDir = "asc" | "desc";
type ViewMode = "list" | "grid";
type ClientStatus = "Active" | "At Risk" | "Churned" | "Prospect";
type ClientTier = "Enterprise" | "Growth" | "Starter";

type ClientRow = {
  id: string;
  code: string;
  name: string;
  stage: string;
  tier: ClientTier;
  status: ClientStatus;
  mrr: number;
  totalRevenue: number;
  health: number;
  owner: string;
  ownerEmail?: string;
  avatarColor: string;
  initials: string;
  lastActivity: string;
};

const TIER_CFG = {
  Enterprise: { color: "#2563eb", bg: "#eff6ff" },
  Growth: { color: "#7c3aed", bg: "#f5f3ff" },
  Starter: { color: "#16a34a", bg: "#f0fdf4" }
};

const STATUS_CFG = {
  Active: { color: "#16a34a", bg: "#dcfce7", dot: true },
  "At Risk": { color: "#d97706", bg: "#fef3c7", dot: true },
  Churned: { color: "#dc2626", bg: "#fee2e2", dot: false },
  Prospect: { color: "#0891b2", bg: "#e0f2fe", dot: false }
};

const STAGE_OPTIONS = [
  { value: "new", label: "New" },
  { value: "prospect", label: "Prospect" },
  { value: "active", label: "Active" },
  { value: "customer", label: "Customer" },
  { value: "churn_risk", label: "Churn Risk" },
  { value: "churned", label: "Churned" }
];

function healthColor(score: number) {
  if (score >= 80) return "#16a34a";
  if (score >= 50) return "#d97706";
  return "#dc2626";
}


function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="h-3.5 w-3.5 opacity-30" />;
  return dir === "asc" ? <ChevronUp className="h-3.5 w-3.5 text-primary" /> : <ChevronDown className="h-3.5 w-3.5 text-primary" />;
}

function initialsFor(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "AC";
}

function colorFor(value: string) {
  const palette = ["#2563eb", "#7c3aed", "#d97706", "#dc2626", "#059669", "#475569", "#db2777"];
  const hash = Array.from(value || "account").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

function mapStatus(stage: string): ClientStatus {
  const normalized = stage.toLowerCase();
  if (["churned", "lost"].includes(normalized)) return "Churned";
  if (["churn_risk", "at_risk", "red", "blocked"].includes(normalized)) return "At Risk";
  if (["active", "customer", "won"].includes(normalized)) return "Active";
  return "Prospect";
}

function mapTier(annualValue = 0): ClientTier {
  if (annualValue >= 500000) return "Enterprise";
  if (annualValue >= 120000) return "Growth";
  return "Starter";
}

function mapHealth(health: AccountSummary["health"]) {
  if (health === "red") return 35;
  if (health === "amber") return 65;
  return 88;
}

function mapAccountToClient(account: AccountSummary): ClientRow {
  const annualValue = account.annualValue ?? 0;
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    stage: account.stage,
    tier: mapTier(annualValue),
    status: mapStatus(account.stage),
    mrr: Math.round(annualValue / 12),
    totalRevenue: annualValue,
    health: mapHealth(account.health),
    owner: account.picName ?? "Unassigned",
    ownerEmail: account.picEmail,
    avatarColor: account.picAvatarUrl ? "#2563eb" : colorFor(account.name),
    initials: initialsFor(account.name),
    lastActivity: "Synced from accounts API"
  };
}

async function loadAccounts(signal?: AbortSignal) {
  const response = await fetch("/api/accounts?limit=100", {
    cache: "no-store",
    credentials: "same-origin",
    signal
  });

  if (response.status === 401) {
    window.location.assign(`/login?returnTo=${encodeURIComponent("/clients")}`);
    return [];
  }

  if (!response.ok) {
    throw new Error(`Could not load accounts: ${response.status}`);
  }

  const payload = (await response.json()) as AccountsResponse;
  return payload.data.map(mapAccountToClient);
}

async function readClientError(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    if (typeof payload?.message === "string") return payload.message;
    if (Array.isArray(payload?.message)) return payload.message.join(", ");
    if (typeof payload?.error === "string") return payload.error;
  } catch {
    // Upstream/proxy errors may not have JSON bodies.
  }
  return `${fallback}: ${response.status}`;
}

function ClientCard({ client, onEdit, onDelete }: { client: ClientRow; onEdit: (client: ClientRow) => void; onDelete: (client: ClientRow) => void }) {
  const tierCfg = TIER_CFG[client.tier];
  const statusCfg = STATUS_CFG[client.status];
  const hColor = healthColor(client.health);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ y: -3 }}
      className="flex cursor-pointer flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <Link href={`/clients/${client.id}`} className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm" style={{ backgroundColor: client.avatarColor }}>
            {client.initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-foreground transition-colors hover:text-primary">{client.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">{client.code}</p>
          </div>
        </Link>
        <span className="rounded-lg px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: tierCfg.bg, color: tierCfg.color }}>
          {client.tier}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">MRR</p>
          <p className="font-mono text-sm font-bold tabular-nums text-foreground"><MoneyAmount value={client.mrr} /></p>
        </div>
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">Health</p>
          <div className="flex items-center gap-1.5">
            <p className="font-mono text-sm font-bold tabular-nums" style={{ color: hColor }}>{client.health}</p>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${client.health}%`, backgroundColor: hColor }} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: statusCfg.bg, color: statusCfg.color }}>
          {statusCfg.dot && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusCfg.color }} />}
          {client.status}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => onEdit(client)} className="rounded-lg bg-muted p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary" title="Edit client">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onDelete(client)} className="rounded-lg bg-muted p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600" title="Delete client">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <Link href={`/clients/${client.id}`} className="rounded-lg bg-muted p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary" title="Open client">
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

export default function ClientsPage() {
  const [clientsList, setClientsList] = useState<ClientRow[]>([]);
  const [view, setView] = useState<ViewMode>("list");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("mrr");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientRow | null>(null);
  const [deleteClient, setDeleteClient] = useState<ClientRow | null>(null);
  const createDialogRef = useDialogAccessibility(isCreateOpen, () => { setIsCreateOpen(false); setEditingClient(null); });
  const deleteDialogRef = useDialogAccessibility(Boolean(deleteClient), () => setDeleteClient(null));
  const [companyName, setCompanyName] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [stage, setStage] = useState("new");
  const [annualValue, setAnnualValue] = useState("");
  const [commercialNote, setCommercialNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadAccounts(controller.signal)
      .then((accounts) => {
        if (controller.signal.aborted) return;
        setClientsList(accounts);
        setError(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Could not load accounts");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("desc");
  };

  const filtered = useMemo(() => {
    const normalizedQuery = query.toLowerCase().trim();
    return clientsList
      .filter((client) => {
        if (normalizedQuery && !`${client.name} ${client.code} ${client.owner}`.toLowerCase().includes(normalizedQuery)) return false;
        if (statusFilter !== "all" && client.status !== statusFilter) return false;
        if (tierFilter !== "all" && client.tier !== tierFilter) return false;
        return true;
      })
      .sort((a, b) => {
        const left = a[sortKey];
        const right = b[sortKey];
        if (typeof left === "number" && typeof right === "number") {
          return sortDir === "asc" ? left - right : right - left;
        }
        return sortDir === "asc"
          ? String(left).localeCompare(String(right))
          : String(right).localeCompare(String(left));
      });
  }, [clientsList, query, sortDir, sortKey, statusFilter, tierFilter]);

  const totalMRR = clientsList.filter((client) => client.status === "Active").reduce((sum, client) => sum + client.mrr, 0);
  const atRisk = clientsList.filter((client) => client.status === "At Risk").length;
  const avgHealth = clientsList.length > 0 ? Math.round(clientsList.reduce((sum, client) => sum + client.health, 0) / clientsList.length) : 0;

  const filterStatusOptions = [
    { value: "all", label: "All Status" },
    { value: "Active", label: "Active", color: "#16a34a" },
    { value: "At Risk", label: "At Risk", color: "#d97706" },
    { value: "Prospect", label: "Prospect", color: "#0891b2" },
    { value: "Churned", label: "Churned", color: "#dc2626" }
  ];

  const filterTierOptions = [
    { value: "all", label: "All Tiers" },
    { value: "Enterprise", label: "Enterprise" },
    { value: "Growth", label: "Growth" },
    { value: "Starter", label: "Starter" }
  ];

  const columns: { key: SortKey; label: string; width?: string }[] = [
    { key: "name", label: "Company" },
    { key: "stage", label: "Stage" },
    { key: "tier", label: "Tier", width: "w-28" },
    { key: "mrr", label: "MRR", width: "w-24" },
    { key: "health", label: "Health", width: "w-32" },
    { key: "status", label: "Status", width: "w-28" }
  ];

  const resetClientForm = () => {
    setCompanyName("");
    setAccountCode("");
    setStage("new");
    setAnnualValue("");
    setCommercialNote("");
  };

  const openCreateClient = () => {
    setEditingClient(null);
    resetClientForm();
    setError(null);
    setIsCreateOpen(true);
  };

  const openEditClient = (client: ClientRow) => {
    setEditingClient(client);
    setCompanyName(client.name);
    setAccountCode(client.code);
    setStage(client.stage);
    setAnnualValue(String(client.totalRevenue || 0));
    setCommercialNote("");
    setError(null);
    setIsCreateOpen(true);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = companyName.trim();
    const code = accountCode.trim() || initialsFor(name);
    if (!name || !code) return;

    setSaving(true);
    try {
      const response = await fetch(editingClient ? `/api/accounts/${encodeURIComponent(editingClient.id)}` : "/api/accounts", {
        method: editingClient ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          name,
          stage,
          annualValue: Number(annualValue) || 0,
          commercialNote: commercialNote.trim() || undefined
        })
      });

      if (response.status === 401) {
        window.location.assign(`/login?returnTo=${encodeURIComponent("/clients")}`);
        return;
      }
      if (!response.ok) {
        throw new Error(await readClientError(response, editingClient ? "Could not update account" : "Could not create account"));
      }

      const account = (await response.json()) as AccountSummary;
      const nextClient = mapAccountToClient(account);
      setClientsList((current) => editingClient ? current.map((client) => client.id === nextClient.id ? nextClient : client) : [nextClient, ...current]);
      setIsCreateOpen(false);
      setEditingClient(null);
      resetClientForm();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : editingClient ? "Could not update account" : "Could not create account");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClient = async () => {
    if (!deleteClient) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/accounts/${encodeURIComponent(deleteClient.id)}`, {
        method: "DELETE",
        credentials: "same-origin"
      });

      if (response.status === 401) {
        window.location.assign(`/login?returnTo=${encodeURIComponent("/clients")}`);
        return;
      }
      if (!response.ok) {
        throw new Error(await readClientError(response, "Could not delete account"));
      }

      setClientsList((current) => current.filter((client) => client.id !== deleteClient.id));
      setDeleteClient(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete account");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AppShell activeRoute="/clients" title="Clients">
        <main className="flex-1 overflow-auto p-4 sm:p-6">
          <div className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h1 className="text-xl font-bold text-foreground">Client Accounts</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">{clientsList.length} accounts · {clientsList.filter((client) => client.status === "Active").length} active</p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              <button onClick={() => downloadCsv("uplark-clients-filtered.csv", ["Name", "Code", "Stage", "Tier", "Status", "MRR", "Owner"], filtered.map((client) => [client.name, client.code, client.stage, client.tier, client.status, client.mrr, client.owner]))} title="Export the currently loaded and filtered clients" aria-label={`Export ${filtered.length} filtered clients as CSV`} className="flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted">
                <Download className="h-4 w-4" /> Export filtered CSV
              </button>
              <button
                onClick={openCreateClient}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm"
              >
                <Plus className="h-4 w-4" /> Add Client
              </button>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            {[
              { label: "Total MRR", value: <MoneyAmount value={totalMRR} />, icon: Wallet, color: "#2563eb", trend: "From accounts annual value" },
              { label: "Total Clients", value: clientsList.length, icon: Building2, color: "#7c3aed", trend: "Accounts API" },
              { label: "At Risk", value: atRisk, icon: Star, color: "#d97706", trend: `${atRisk} need attention` },
              { label: "Avg Health", value: `${avgHealth}%`, icon: Star, color: "#16a34a", trend: "Derived from account health" }
            ].map((stat) => (
              <motion.div key={stat.label} whileHover={{ y: -2 }} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{stat.label}</p>
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: `${stat.color}15` }}>
                    <stat.icon className="h-3.5 w-3.5" style={{ color: stat.color }} />
                  </div>
                </div>
                <p className="font-mono text-2xl font-bold tabular-nums text-foreground">{stat.value}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{stat.trend}</p>
              </motion.div>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex flex-col items-stretch gap-3 border-b border-border px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-4 xl:flex-nowrap">
              <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-input bg-background px-3.5 py-2">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by name, code, owner..."
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                />
              </div>

              <CustomDropdown options={filterStatusOptions} value={statusFilter} onChange={setStatusFilter} className="w-full shrink-0 sm:w-40" />
              <CustomDropdown options={filterTierOptions} value={tierFilter} onChange={setTierFilter} className="w-full shrink-0 sm:w-40" />

              <div className="flex items-center self-end rounded-xl bg-muted p-0.5 sm:ml-auto sm:self-auto">
                <button type="button" aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")} className={`min-h-11 min-w-11 rounded-lg p-2 transition-all ${view === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
                  <List className="h-4 w-4" />
                </button>
                <button type="button" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")} className={`min-h-11 min-w-11 rounded-lg p-2 transition-all ${view === "grid" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
                  <LayoutGrid className="h-4 w-4" />
                </button>
              </div>
            </div>

            {error && <div className="border-b border-border bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

            {loading ? (
              <div className="py-16 text-center text-sm text-muted-foreground">Loading accounts...</div>
            ) : view === "grid" ? (
              <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-3">
                <AnimatePresence mode="popLayout">
                  {filtered.map((client) => (
                    <ClientCard key={client.id} client={client} onEdit={openEditClient} onDelete={setDeleteClient} />
                  ))}
                </AnimatePresence>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {columns.map((column) => (
                        <th key={column.key} className={`px-4 py-3 text-left ${column.width ?? ""}`}>
                          <button onClick={() => handleSort(column.key)} className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground">
                            {column.label} <SortIcon active={sortKey === column.key} dir={sortDir} />
                          </button>
                        </th>
                      ))}
                      <th className="w-40 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Owner</th>
                      <th className="w-32 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Source</th>
                      <th className="w-24 px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence mode="popLayout">
                      {filtered.map((client, index) => {
                        const tierCfg = TIER_CFG[client.tier];
                        const statusCfg = STATUS_CFG[client.status];
                        const hColor = healthColor(client.health);
                        return (
                          <motion.tr
                            key={client.id}
                            layout
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ delay: index * 0.015 }}
                            className="group cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/30"
                          >
                            <td className="px-4 py-3.5">
                              <Link href={`/clients/${client.id}`} className="flex items-center gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white shadow-sm" style={{ backgroundColor: client.avatarColor }}>
                                  {client.initials}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary">{client.name}</p>
                                  <p className="truncate text-[11px] text-muted-foreground">{client.code}</p>
                                </div>
                              </Link>
                            </td>
                            <td className="px-4 py-3.5 text-sm text-foreground">{client.stage}</td>
                            <td className="px-4 py-3.5">
                              <span className="rounded-lg px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: tierCfg.bg, color: tierCfg.color }}>{client.tier}</span>
                            </td>
                            <td className="px-4 py-3.5">
                              <span className="font-mono text-sm font-bold tabular-nums text-foreground"><MoneyAmount value={client.mrr} /></span>
                            </td>
                            <td className="px-4 py-3.5">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold tabular-nums" style={{ color: hColor }}>{client.health}</span>
                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                                  <div className="h-full rounded-full" style={{ width: `${client.health}%`, backgroundColor: hColor }} />
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3.5">
                              <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: statusCfg.bg, color: statusCfg.color }}>
                                {statusCfg.dot && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusCfg.color }} />}
                                {client.status}
                              </span>
                            </td>
                            <td className="px-4 py-3.5">
                              <p className="text-xs text-muted-foreground">{client.owner}</p>
                              {client.ownerEmail && <p className="text-[10px] text-muted-foreground/70">{client.ownerEmail}</p>}
                            </td>
                            <td className="px-4 py-3.5">
                              <p className="text-xs text-muted-foreground">{client.lastActivity}</p>
                            </td>
                            <td className="px-4 py-3.5">
                              <div className="flex items-center gap-1">
                                <Link aria-label={`Open ${client.name}`} href={`/clients/${client.id}`} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary">
                                  <ArrowRight className="h-4 w-4" />
                                </Link>
                                {client.ownerEmail ? <a aria-label={`Email ${client.owner}`} href={`mailto:${client.ownerEmail}`} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"><Mail className="h-4 w-4" /></a> : null}
                                <button onClick={() => openEditClient(client)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary" title="Edit client">
                                  <Pencil className="h-4 w-4" />
                                </button>
                                <button onClick={() => setDeleteClient(client)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600" title="Delete client">
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </AnimatePresence>
                  </tbody>
                </table>

                {filtered.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Building2 className="mb-3 h-10 w-10 text-muted-foreground/30" />
                    <p className="text-sm font-medium text-foreground">No clients found</p>
                    <p className="mt-1 text-xs text-muted-foreground">Accounts API returned no matching records.</p>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-3">
              <p className="text-xs text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{filtered.length}</span> of <span className="font-semibold text-foreground">{clientsList.length}</span> clients
              </p>
            </div>
          </div>
        </main>

        <footer className="flex h-11 shrink-0 items-center justify-between border-t border-border bg-card px-5">
          <span className="text-[11px] text-muted-foreground">UpLark Partner CRM</span>
          <span className="text-[11px] text-muted-foreground">Legal pages are not published yet.</span>
        </footer>
      <AnimatePresence>
        {isCreateOpen && (
          <ModalLayer onClose={() => {
            setIsCreateOpen(false);
            setEditingClient(null);
          }}>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              aria-label={editingClient ? "Edit Client Account" : "Create Client Account"}
              aria-modal="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setIsCreateOpen(false);
                setEditingClient(null);
              }}
              aria-hidden="true"
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", duration: 0.4 }}
              ref={createDialogRef} role="dialog" aria-modal="true" aria-label={editingClient ? "Edit Client Account" : "Create Client Account"} tabIndex={-1}
              className="relative z-10 flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-border bg-muted/20 px-6 py-5">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                    <Building2 className="h-5 w-5 text-primary" /> {editingClient ? "Edit Client Account" : "Create Client Account"}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {editingClient ? "Changes are saved through the persisted Accounts API." : "This creates a persisted sales account through the Accounts API."}
                  </p>
                </div>
                <button type="button" onClick={() => {
                  setIsCreateOpen(false);
                  setEditingClient(null);
                }} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  <Plus className="h-4 w-4 rotate-45" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="flex-1 space-y-5 overflow-y-auto p-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="space-y-1.5 sm:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company Name</span>
                    <input
                      type="text"
                      required
                      placeholder="Customer company"
                      value={companyName}
                      onChange={(event) => setCompanyName(event.target.value)}
                      className="w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account Code</span>
                    <input
                      type="text"
                      placeholder="AUTO or customer code"
                      value={accountCode}
                      onChange={(event) => setAccountCode(event.target.value)}
                      className="w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Annual Value (đ)</span>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={annualValue}
                      onChange={(event) => setAnnualValue(event.target.value)}
                      className="w-full rounded-xl border border-input bg-background px-3.5 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </label>

                  <div className="space-y-1.5 sm:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stage</span>
                    <CustomDropdown options={STAGE_OPTIONS} value={stage} onChange={setStage} />
                  </div>

                  <label className="space-y-1.5 sm:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Commercial Note</span>
                    <textarea
                      rows={3}
                      placeholder="Account context, priority, handoff note..."
                      value={commercialNote}
                      onChange={(event) => setCommercialNote(event.target.value)}
                      className="w-full resize-none rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </label>
                </div>

                <div className="flex items-center justify-end gap-2.5 border-t border-border pt-4">
                  <button type="button" onClick={() => {
                    setIsCreateOpen(false);
                    setEditingClient(null);
                  }} className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted">
                    Cancel
                  </button>
                  <button type="submit" disabled={saving} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-md transition-opacity hover:opacity-95 disabled:opacity-50">
                    {saving ? "Saving..." : editingClient ? "Save Client Account" : "Create Client Account"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
          </ModalLayer>
        )}
        {deleteClient && (
          <ModalLayer closeOnEscape={!deleting} onClose={() => setDeleteClient(null)}>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              aria-label="Delete Client Account"
              aria-modal="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeleteClient(null)}
              aria-hidden="true"
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              ref={deleteDialogRef} role="alertdialog" aria-modal="true" aria-label="Delete Client Account" tabIndex={-1}
              className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            >
              <div className="px-6 pb-4 pt-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                  <Trash2 className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-bold text-foreground">Delete Client Account</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Delete "{deleteClient.name}"? This is only allowed when the client has no operational projects, tasks, or sales records.
                </p>
                {error && (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                    {error}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 px-6 pb-6">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => {
                    setDeleteClient(null);
                    setError(null);
                  }}
                  className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleDeleteClient}
                  className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60"
                >
                  {deleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            </motion.div>
          </div>
          </ModalLayer>
        )}
      </AnimatePresence>
    </AppShell>
  );
}

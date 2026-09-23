"use client";
import { MoneyAmount } from "@/components/money-amount";



import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  Wallet,
  ExternalLink,
  FileText,
  Globe,
  Mail,
  MapPin,
  Phone,
  Star,
  TrendingUp,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/constructor-x/app-shell";
import type { AccountSummary, ContactSummary, ProjectSummary, ResourceListResponse } from "@b2b-crm/contracts";

const TABS = ["Overview", "Contacts", "Projects", "Deals", "Activity", "Documents"] as const;
type Tab = (typeof TABS)[number];

type ClientDetailState = {
  account: AccountSummary | null;
  contacts: ContactSummary[];
  projects: ProjectSummary[];
  loading: boolean;
  error: string | null;
};

const COLOR_POOL = ["#2563eb", "#059669", "#7c3aed", "#db2777", "#d97706", "#dc2626", "#64748b", "#0891b2"];

function colorForId(value: string) {
  const hash = Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return COLOR_POOL[hash % COLOR_POOL.length];
}

function initialsFor(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "AC";
  return parts.slice(0, 2).map(part => part[0]?.toUpperCase() ?? "").join("") || "AC";
}


function formatDate(value?: string) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function healthMeta(health?: AccountSummary["health"]) {
  if (health === "red") return { label: "At risk", color: "#dc2626", bg: "#fee2e2", score: 35 };
  if (health === "amber") return { label: "Watch", color: "#d97706", bg: "#fef3c7", score: 65 };
  return { label: "Healthy", color: "#16a34a", bg: "#dcfce7", score: 88 };
}

function stageLabel(stage?: string) {
  return (stage || "new").replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

function EmptyState({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

function ContactCard({ contact, accent }: { contact: ContactSummary; accent: string }) {
  const initials = initialsFor(contact.name);
  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-card p-5 shadow-sm"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl text-xs font-black text-white" style={{ backgroundColor: accent }}>
            {initials}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold text-foreground">{contact.name}</p>
              {contact.influence === "primary" && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
            </div>
            <p className="text-xs text-muted-foreground">{contact.role || "Role not set"}</p>
          </div>
        </div>
      </div>
      <div className="space-y-1.5 text-xs text-muted-foreground">
        {contact.email && <p className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" />{contact.email}</p>}
        {contact.phone && <p className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" />{contact.phone}</p>}
        <p className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5" />Created {formatDate(contact.createdAt)}</p>
      </div>
    </motion.article>
  );
}

function ProjectRow({ project, accent }: { project: ProjectSummary; accent: string }) {
  const progress = Math.max(0, Math.min(100, Math.round(project.progressPercent ?? 0)));
  return (
    <Link
      href={`/projects/${encodeURIComponent(project.id)}`}
      className="block rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:border-foreground/20 hover:shadow-md"
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">{project.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{project.code} · {stageLabel(project.status)}</p>
        </div>
        <span className="rounded-lg bg-muted px-2 py-1 text-[10px] font-bold text-muted-foreground">
          {project.taskCount ?? 0} tasks
        </span>
      </div>
      <div className="mb-2 flex items-center justify-between text-[10px] font-semibold text-muted-foreground">
        <span>Progress</span>
        <span className="font-mono" style={{ color: accent }}>{progress}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${progress}%`, backgroundColor: accent }} />
      </div>
    </Link>
  );
}

export default function ClientDetailPage() {
  const params = useParams<{ clientId: string }>();
  const clientId = params?.clientId ?? "";
  const [tab, setTab] = useState<Tab>("Overview");
  const [state, setState] = useState<ClientDetailState>({
    account: null,
    contacts: [],
    projects: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    async function loadClient() {
      try {
        setState(prev => ({ ...prev, loading: true, error: null }));
        const [accountRes, contactsRes, projectsRes] = await Promise.all([
          fetch(`/api/accounts/${encodeURIComponent(clientId)}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal }),
          fetch(`/api/accounts/${encodeURIComponent(clientId)}/contacts?limit=100`, { cache: "no-store", credentials: "same-origin", signal: controller.signal }),
          fetch(`/api/projects?accountId=${encodeURIComponent(clientId)}&limit=100`, { cache: "no-store", credentials: "same-origin", signal: controller.signal }),
        ]);

        if ([accountRes, contactsRes, projectsRes].some(response => response.status === 401)) {
          window.location.assign(`/login?returnTo=${encodeURIComponent(`/clients/${clientId}`)}`);
          return;
        }

        if (accountRes.status === 404) {
          setState({ account: null, contacts: [], projects: [], loading: false, error: "Client not found" });
          return;
        }

        if (!accountRes.ok) throw new Error(`Account API failed: ${accountRes.status}`);
        if (!contactsRes.ok) throw new Error(`Contacts API failed: ${contactsRes.status}`);
        if (!projectsRes.ok) throw new Error(`Projects API failed: ${projectsRes.status}`);

        const account = (await accountRes.json()) as AccountSummary;
        const contacts = (await contactsRes.json()) as ResourceListResponse<ContactSummary>;
        const projects = (await projectsRes.json()) as ResourceListResponse<ProjectSummary>;

        setState({
          account,
          contacts: contacts.data,
          projects: projects.data,
          loading: false,
          error: null,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          account: null,
          contacts: [],
          projects: [],
          loading: false,
          error: error instanceof Error ? error.message : "Could not load client",
        });
      }
    }

    if (clientId) {
      loadClient();
    }

    return () => controller.abort();
  }, [clientId]);

  const account = state.account;
  const accent = useMemo(() => colorForId(account?.id || clientId || "client"), [account?.id, clientId]);
  const health = healthMeta(account?.health);
  const totalTasks = state.projects.reduce((sum, project) => sum + (project.taskCount ?? 0), 0);
  const completedTasks = state.projects.reduce((sum, project) => sum + (project.completedTaskCount ?? 0), 0);
  const activeProjects = state.projects.filter(project => !["completed", "done", "cancelled"].includes(project.status.toLowerCase())).length;

  if (state.loading || state.error || !account) {
    return (
      <AppShell activeRoute="/clients" title="Client Detail">
          <main className="flex flex-1 items-center justify-center p-4 sm:p-8">
            <div className="max-w-xl text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
                {state.loading ? <Building2 className="h-7 w-7" /> : <AlertCircle className="h-7 w-7" />}
              </div>
              <h1 className="text-2xl font-black text-foreground">{state.loading ? "Loading client..." : state.error || "Client not found"}</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {state.loading ? "Resolving the account workspace from production CRM data." : "This client does not exist in the production CRM workspace."}
              </p>
              {!state.loading && (
                <Link href="/clients" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background">
                  <ArrowLeft className="h-4 w-4" /> Back to clients
                </Link>
              )}
            </div>
          </main>
      </AppShell>
    );
  }

  return (
    <AppShell activeRoute="/clients" title="Client Detail">
        <main className="flex-1 overflow-auto">
          <div className="px-4 pt-4 sm:px-6">
            <Link href="/clients" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Clients
            </Link>
          </div>

          <section className="mx-4 mt-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:mx-6 sm:p-6">
            <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl text-2xl font-black text-white shadow-sm" style={{ backgroundColor: accent }}>
                  {initialsFor(account.name)}
                </div>
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-2xl font-black tracking-tight text-foreground">{account.name}</h1>
                    <span className="rounded-lg px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: health.bg, color: health.color }}>
                      {health.label}
                    </span>
                    <span className="rounded-lg bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                      {stageLabel(account.stage)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />{account.code}</span>
                    <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />PIC: {account.picName || "Unassigned"}</span>
                    {account.picEmail && <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{account.picEmail}</span>}
                    <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{account.ownerTeam}</span>
                  </div>
                  {account.commercialNote && <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{account.commercialNote}</p>}
                </div>
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:shrink-0 md:justify-end">
                {account.picEmail && (
                  <a href={`mailto:${account.picEmail}`} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted">
                    <Mail className="h-3.5 w-3.5" /> Email PIC
                  </a>
                )}
                <Link href={`/projects?accountId=${encodeURIComponent(account.id)}`} className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm" style={{ backgroundColor: accent }}>
                  <Briefcase className="h-4 w-4" /> View Projects
                </Link>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                { icon: Wallet, label: "Annual Value", value: <MoneyAmount value={(account.annualValue) ?? 0} />, color: "#2563eb" },
                { icon: Briefcase, label: "Projects", value: state.projects.length, color: "#7c3aed" },
                { icon: CheckCircle2, label: "Completed Tasks", value: `${completedTasks}/${totalTasks}`, color: "#16a34a" },
                { icon: TrendingUp, label: "Active Projects", value: activeProjects, color: "#d97706" },
              ].map(item => (
                <div key={item.label} className="rounded-xl border border-border bg-background p-4">
                  <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: `${item.color}15` }}>
                    <item.icon className="h-4 w-4" style={{ color: item.color }} />
                  </div>
                  <p className="text-lg font-black text-foreground">{item.value}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{item.label}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="overflow-x-auto px-4 sm:px-6">
            <div className="mt-6 flex min-w-max border-b border-border">
              {TABS.map(item => (
                <button
                  key={item}
                  onClick={() => setTab(item)}
                  className={`relative px-4 py-3 text-sm font-semibold transition-colors ${tab === item ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {item}
                  {tab === item && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full" style={{ backgroundColor: accent }} />}
                </button>
              ))}
            </div>
          </div>

          <div className="px-4 py-5 sm:px-6">
            {tab === "Overview" && (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                <section className="rounded-xl border border-border bg-card p-5 shadow-sm lg:col-span-2">
                  <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Operational Health</h2>
                  <div className="space-y-4">
                    {[
                      { label: "Account health", score: health.score, color: health.color },
                      { label: "Project delivery", score: state.projects.length ? Math.round(state.projects.reduce((sum, project) => sum + (project.progressPercent ?? 0), 0) / state.projects.length) : 0, color: accent },
                      { label: "Task completion", score: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0, color: "#16a34a" },
                    ].map(item => (
                      <div key={item.label}>
                        <div className="mb-1 flex justify-between text-xs font-semibold">
                          <span className="text-foreground">{item.label}</span>
                          <span className="font-mono" style={{ color: item.color }}>{item.score}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full" style={{ width: `${item.score}%`, backgroundColor: item.color }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                  <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Account Info</h2>
                  <div className="space-y-3 text-xs">
                    {[
                      ["Code", account.code],
                      ["Stage", stageLabel(account.stage)],
                      ["Owner team", account.ownerTeam],
                      ["PIC", account.picName || "Unassigned"],
                      ["PIC email", account.picEmail || "Not set"],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-4">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="text-right font-semibold text-foreground">{value}</span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {tab === "Contacts" && (
              state.contacts.length ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {state.contacts.map(contact => <ContactCard key={contact.id} contact={contact} accent={colorForId(contact.id)} />)}
                </div>
              ) : (
                <EmptyState icon={Users} title="No production contacts yet" description="This account has no synced contacts in the CRM database. Add contacts through the client workspace before operating this tab." />
              )
            )}

            {tab === "Projects" && (
              state.projects.length ? (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {state.projects.map(project => <ProjectRow key={project.id} project={project} accent={colorForId(project.id)} />)}
                </div>
              ) : (
                <EmptyState icon={Briefcase} title="No production projects yet" description="This client has no projects in the current workspace. The page no longer fabricates placeholder project rows." />
              )
            )}

            {tab === "Deals" && (
              <EmptyState icon={Wallet} title="Deals are not populated for this client yet" description="Opportunity/deal detail records are not exposed on this visible client route yet, so this tab is intentionally empty instead of showing demo renewals or fake close dates." />
            )}

            {tab === "Activity" && (
              <EmptyState icon={TrendingUp} title="No client activity timeline yet" description="Activity will appear here after production audit/event records are wired to client accounts. Seed timeline entries were removed from this core route." />
            )}

            {tab === "Documents" && (
              <EmptyState icon={FileText} title="No client documents yet" description="Artifacts for client accounts are not persisted for this page yet. Upload actions are hidden until they write to the production artifact API." />
            )}
          </div>
        </main>

        <footer className="flex h-11 shrink-0 items-center justify-between border-t border-border bg-card px-5">
          <span className="text-[11px] text-muted-foreground">UpLark Partner CRM</span>
          <span className="text-[11px] text-muted-foreground">Legal pages are not published yet.</span>
        </footer>
    </AppShell>
  );
}

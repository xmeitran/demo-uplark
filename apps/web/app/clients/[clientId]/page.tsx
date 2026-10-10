"use client";
import { PersonLink } from "@/components/person-link";
import { MoneyAmount } from "@/components/money-amount";



import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  Briefcase,
  Building2,
  Calendar,
  Mail,
  Phone,
  Star,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/constructor-x/app-shell";
import type { AccountSummary, ContactSummary, ProjectSummary, ResourceListResponse } from "@b2b-crm/contracts";

const TABS = ["Projects", "Contacts"] as const;
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
  const [tab, setTab] = useState<Tab>("Projects");
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
  const taskPercent = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const projectList = state.projects.length ? (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {state.projects.map(project => <ProjectRow key={project.id} project={project} accent={colorForId(project.id)} />)}
    </div>
  ) : (
    <EmptyState icon={Briefcase} title="No production projects yet" description="This client has no projects in the current workspace. The page no longer fabricates placeholder project rows." />
  );

  if (state.loading || state.error || !account) {
    return (
      <AppShell activeRoute="/clients" title="Client Detail">
          <main className="flex flex-1 items-center justify-center p-4 sm:p-8">
            <div className="max-w-xl text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
                {state.loading ? <Building2 className="h-7 w-7" /> : <AlertCircle className="h-7 w-7" />}
              </div>
              <h1 className="!text-xl font-black text-foreground">{state.loading ? "Loading client..." : state.error || "Client not found"}</h1>
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
        <main className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
          <Link href="/clients" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Clients
          </Link>

          <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white shadow-sm" style={{ backgroundColor: accent }}>
                {initialsFor(account.name)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="!text-xl truncate font-bold text-foreground">{account.name}</h1>
                  <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ backgroundColor: health.bg, color: health.color }}>
                    {health.label}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">{account.code} · {account.ownerTeam}</p>
              </div>
            </div>
            {account.picEmail && (
              <a href={`mailto:${account.picEmail}`} className="flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted">
                <Mail className="h-4 w-4" /> Email PIC
              </a>
            )}
          </header>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-5">
              <div className="overflow-x-auto">
                <div className="flex min-w-max border-b border-border">
                  {TABS.map(item => (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={tab === item}
                      onClick={() => setTab(item)}
                      className={`relative px-4 py-3 text-sm font-semibold transition-colors ${tab === item ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {item}
                      {tab === item && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full" style={{ backgroundColor: accent }} />}
                    </button>
                  ))}
                </div>
              </div>

              {tab === "Projects" && projectList}

              {tab === "Contacts" && (
                state.contacts.length ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {state.contacts.map(contact => <ContactCard key={contact.id} contact={contact} accent={colorForId(contact.id)} />)}
                  </div>
                ) : (
                  <EmptyState icon={Users} title="No production contacts yet" description="This account has no synced contacts in the CRM database. Add contacts through the client workspace before operating this tab." />
                )
              )}
            </div>

            <aside className="xl:sticky xl:top-4">
              <section className="rounded-2xl border border-border bg-card shadow-sm">
                <h2 className="border-b border-border px-5 py-4 !text-sm font-bold text-foreground">Account Info</h2>
                <dl className="divide-y divide-border px-5">
                  <InfoRow label="Annual Value"><MoneyAmount value={account.annualValue ?? 0} /></InfoRow>
                  <InfoRow label="Stage">{stageLabel(account.stage)}</InfoRow>
                  <InfoRow label="PIC">
                    {account.picUserId && account.picName ? (
                      <PersonLink userId={account.picUserId} className="transition-colors hover:text-primary">{account.picName}</PersonLink>
                    ) : (account.picName || "Unassigned")}
                  </InfoRow>
                  <InfoRow label="PIC email">{account.picEmail || "Not set"}</InfoRow>
                  <InfoRow label="Owner team">{account.ownerTeam}</InfoRow>
                  <InfoRow label="Projects">{state.projects.length}</InfoRow>
                  <InfoRow label="Tasks done">
                    <span className="flex items-center gap-2">
                      <span className="font-mono tabular-nums">{completedTasks}/{totalTasks}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <span className="block h-full rounded-full bg-emerald-600" style={{ width: `${taskPercent}%` }} />
                      </span>
                    </span>
                  </InfoRow>
                </dl>
                {account.commercialNote && <p className="border-t border-border px-5 py-4 text-xs leading-5 text-muted-foreground">{account.commercialNote}</p>}
              </section>
            </aside>
          </div>
        </main>

        <footer className="flex h-11 shrink-0 items-center justify-between border-t border-border bg-card px-5">
          <span className="text-[11px] text-muted-foreground">UpLark Partner CRM</span>
          <span className="text-[11px] text-muted-foreground">Legal pages are not published yet.</span>
        </footer>
    </AppShell>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 items-center gap-2 py-3">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="col-span-2 truncate text-xs font-bold text-foreground">{children}</dd>
    </div>
  );
}

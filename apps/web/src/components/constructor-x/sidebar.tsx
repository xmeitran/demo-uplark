"use client";

import React, { useState, useEffect, useLayoutEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Briefcase,
  Users,
  Activity,
  Calendar,
  BarChart3,
  ClipboardList,
  CircleDollarSign,
  ContactRound,
  FileText,
  MessageSquare,
  Mail,
  FolderOpen,
  ChevronDown,
  ChevronLeft,
  Settings,
  Moon,
  BookOpen,
  Plus,
  StickyNote,
  Building2,
  MessagesSquare,
  ShieldCheck,
  LogOut,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { APP_NAME, AppBrandLogo } from "@/components/app-brand";
import {
  FRONTEND_STORE_EVENT,
  getPushedProjectsOwnerKey,
  readPushedProjectIds,
} from "@/lib/frontend-data-store";
import { fetchLiveProjectById } from "@/app/projects/live-projects";
import { isLocalNavigationVisibleRoute } from "@/lib/production-route-readiness";
import { useTheme } from "@/lib/theme";

export const PROJECT_TAB_NAV_EVENT = "b2b-crm:project-tab-navigation";

interface Project {
  id: string;
  name: string;
  color: string;
  initials: string;
  taskCount: number;
}

const SIDEBAR_PROJECTS_CACHE_PREFIX = "sidebar_projects_cache";

interface SidebarProps {
  activeRoute?: string;
  onCreateProjectClick?: () => void;
  variant?: "desktop" | "drawer";
}

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/" },
  { icon: Briefcase, label: "Projects", href: "/projects", badge: null },
  { icon: StickyNote, label: "Notes", href: "/notes" },
  { icon: FolderOpen, label: "Files", href: "/files" },
  { icon: MessagesSquare, label: "Chats", href: "/chats", badge: 3 },
  { icon: Mail, label: "Mail", href: "/mail", badge: 1 },
  { icon: Users, label: "Users", href: "/users" },
  { icon: Calendar, label: "Calendar", href: "/calendar", badge: null },
  { icon: BarChart3, label: "Phân tích", href: "/analytics" },
  { icon: ClipboardList, label: "Timesheet", href: "/timesheet" },
  { icon: CircleDollarSign, label: "Project P&L", href: "/pnl" },
  { icon: ContactRound, label: "Hồ sơ nhân sự", href: "/people" },
  { icon: BookOpen, label: "Knowledge Base", href: "/knowledge" },
  { icon: Building2, label: "Clients", href: "/clients" },
  { icon: MessageSquare, label: "Messenger", href: "/messenger" },
];

const NAV_MORE = [
  { icon: Activity, label: "Activity", href: "/activity" },
  { icon: BarChart3, label: "Statistic", href: "/invoices" },
];

const NAV_BOTTOM = [
  { icon: Settings, label: "Settings", href: "/settings" },
  { icon: Moon, label: "Night Mode", href: "#", isToggle: true },
];

const visibleNavItems = NAV_ITEMS.filter((item) => isLocalNavigationVisibleRoute(item.href));
const visibleMoreItems = NAV_MORE.filter((item) => isLocalNavigationVisibleRoute(item.href));
const visibleBottomItems = NAV_BOTTOM.filter((item) => item.isToggle || isLocalNavigationVisibleRoute(item.href));
const PROJECT_SUB = [
  { label: "Dashboard", tab: "Dashboard" },
  { label: "Stages", tab: "Timeline" },
  { label: "Tasks", tab: "Tasks" }
] as const;

type ProjectSubTab = typeof PROJECT_SUB[number]["tab"];

function getProjectIdFromPath(pathname: string | null) {
  const match = pathname?.match(/^\/projects\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function isProjectSubTab(value: string | null): value is ProjectSubTab {
  return PROJECT_SUB.some((item) => item.tab === value);
}

function getSidebarProjectsCacheKey(ownerKey: string) {
  return `${SIDEBAR_PROJECTS_CACHE_PREFIX}:${encodeURIComponent(ownerKey.trim().toLowerCase() || "anonymous")}`;
}

function normalizeSidebarProject(value: unknown): Project | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Project>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (!id || !name) return null;
  return {
    id,
    name,
    color: typeof candidate.color === "string" && candidate.color.trim() ? candidate.color : "#64748b",
    initials: typeof candidate.initials === "string" && candidate.initials.trim() ? candidate.initials : name.substring(0, 2).toUpperCase(),
    taskCount: typeof candidate.taskCount === "number" && Number.isFinite(candidate.taskCount) ? candidate.taskCount : 0
  };
}

function readCachedSidebarProjects(ownerKey: string) {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(getSidebarProjectsCacheKey(ownerKey)) ?? "[]");
    return Array.isArray(parsed) ? parsed.flatMap((item) => {
      const project = normalizeSidebarProject(item);
      return project ? [project] : [];
    }) : [];
  } catch {
    return [];
  }
}

function writeCachedSidebarProjects(ownerKey: string, projects: Project[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getSidebarProjectsCacheKey(ownerKey), JSON.stringify(projects));
}

function sortSidebarProjectsByPinnedIds(projects: Project[], pinnedIds: string[]) {
  const byId = new Map(projects.map((project) => [project.id, project]));
  return pinnedIds.flatMap((projectId) => {
    const project = byId.get(projectId);
    return project ? [project] : [];
  });
}

function haveSamePinnedIds(current: string[], next: string[]) {
  return current.length === next.length && current.every((id, index) => id === next[index]);
}

function haveSameSidebarProjects(current: Project[], next: Project[]) {
  return current.length === next.length && current.every((project, index) => {
    const nextProject = next[index];
    return nextProject !== undefined
      && project.id === nextProject.id
      && project.name === nextProject.name
      && project.color === nextProject.color
      && project.initials === nextProject.initials
      && project.taskCount === nextProject.taskCount;
  });
}

export function Sidebar({ activeRoute = "/", onCreateProjectClick, variant = "desktop" }: SidebarProps) {
  const theme = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeProjectId = getProjectIdFromPath(pathname);
  const { user } = useAuth();
  const isWorkspaceAdmin = Boolean(user?.roleCodes?.some((role) => role === "FOUNDER_GM" || role === "WORKSPACE_ADMIN"));
  const pushedProjectOwnerKey = getPushedProjectsOwnerKey(user);

  const [collapsed, setCollapsed] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [currentProjectTab, setCurrentProjectTab] = useState<ProjectSubTab>("Dashboard");
  const [moreOpen, setMoreOpen] = useState(false);

  const [pushedIds, setPushedIds] = useState<string[]>([]);
  const [localProjects, setLocalProjects] = useState<Project[]>([]);
  const [pushedIdsHydrated, setPushedIdsHydrated] = useState(false);
  const [pinnedProjectsLoading, setPinnedProjectsLoading] = useState(false);

  useEffect(() => {
    if (activeProjectId) {
      setActiveProject(activeProjectId);
      setExpandedProject(activeProjectId);
    }
  }, [activeProjectId]);

  useEffect(() => {
    const queryTab = searchParams.get("tab");
    setCurrentProjectTab(isProjectSubTab(queryTab) ? queryTab : "Dashboard");
  }, [searchParams]);

  useLayoutEffect(() => {
    const loadState = () => {
      if (typeof window === "undefined") return;

      const nextPushedIds = readPushedProjectIds(pushedProjectOwnerKey);
      setPushedIds((currentIds) => haveSamePinnedIds(currentIds, nextPushedIds) ? currentIds : nextPushedIds);
      setLocalProjects((currentProjects) => {
        const cachedProjects = readCachedSidebarProjects(pushedProjectOwnerKey);
        const mergedProjects = new Map([...currentProjects, ...cachedProjects].map((project) => [project.id, project]));
        const nextProjects = sortSidebarProjectsByPinnedIds(Array.from(mergedProjects.values()), nextPushedIds);
        return haveSameSidebarProjects(currentProjects, nextProjects) ? currentProjects : nextProjects;
      });
      setPushedIdsHydrated(true);
    };

    setPushedIdsHydrated(false);
    loadState();
    window.addEventListener("pushed_projects_changed", loadState);
    window.addEventListener(FRONTEND_STORE_EVENT, loadState);
    return () => {
      window.removeEventListener("pushed_projects_changed", loadState);
      window.removeEventListener(FRONTEND_STORE_EVENT, loadState);
    };
  }, [pushedProjectOwnerKey]);

  useEffect(() => {
    if (!pushedIdsHydrated) return;
    const controller = new AbortController();

    async function loadPinnedProjects() {
      if (pushedIds.length === 0) {
        setPinnedProjectsLoading(false);
        setLocalProjects([]);
        return;
      }

      setPinnedProjectsLoading(true);
      try {
        const pinnedProjects = await Promise.all(
          pushedIds.map((projectId) => fetchLiveProjectById(projectId, {
            signal: controller.signal,
            cacheScope: pushedProjectOwnerKey
          }).catch(() => null))
        );
        if (controller.signal.aborted) return;
        const fetchedProjects = pinnedProjects.flatMap((project) => project ? [{
          id: project.id,
          name: project.name,
          color: project.color,
          initials: project.members[0]?.initials || project.name.substring(0, 2).toUpperCase(),
          taskCount: project.tasks.total
        }] : []);
        const cachedProjects = readCachedSidebarProjects(pushedProjectOwnerKey);
        const availableProjects = new Map([...cachedProjects, ...fetchedProjects].map((project) => [project.id, project]));
        const nextProjects = sortSidebarProjectsByPinnedIds(Array.from(availableProjects.values()), pushedIds);
        setLocalProjects((currentProjects) => (
          haveSameSidebarProjects(currentProjects, nextProjects) ? currentProjects : nextProjects
        ));
        writeCachedSidebarProjects(pushedProjectOwnerKey, nextProjects);
      } catch {
        if (!controller.signal.aborted) {
          setLocalProjects((currentProjects) => (
            currentProjects.length > 0
              ? currentProjects
              : sortSidebarProjectsByPinnedIds(readCachedSidebarProjects(pushedProjectOwnerKey), pushedIds)
          ));
        }
      } finally {
        if (!controller.signal.aborted) {
          setPinnedProjectsLoading(false);
        }
      }
    }

    loadPinnedProjects();
    return () => controller.abort();
  }, [pushedIds, pushedIdsHydrated, pushedProjectOwnerKey]);

  const sidebarProjects = sortSidebarProjectsByPinnedIds(localProjects, pushedIds);
  const shouldShowNoProjects = pushedIdsHydrated && pushedIds.length === 0 && !pinnedProjectsLoading;
  const shouldShowPinnedLoading = pushedIdsHydrated && pinnedProjectsLoading && pushedIds.length > 0 && sidebarProjects.length === 0;
  const shouldShowPinnedUnavailable = pushedIdsHydrated && !pinnedProjectsLoading && pushedIds.length > 0 && sidebarProjects.length === 0;
  const isDesktop = variant === "desktop";
  const expandedBlockClass = isDesktop ? "lg:hidden xl:block" : "";
  const expandedFlexClass = isDesktop ? "lg:hidden xl:flex" : "";
  const expandedInlineClass = isDesktop ? "lg:hidden xl:inline" : "";
  const compactRowClass = isDesktop ? "lg:justify-center xl:justify-start" : "";
  const Root = variant === "drawer" ? "div" : "aside";

  const navigateProjectSubTab = (event: React.MouseEvent<HTMLAnchorElement>, projectId: string, tab: ProjectSubTab) => {
    const projectHref = `/projects/${projectId}?tab=${tab}`;
    const isCurrentProject = pathname === `/projects/${projectId}`;

    event.preventDefault();
    event.stopPropagation();

    if (isCurrentProject && currentProjectTab === tab) {
      return;
    }

    setActiveProject(projectId);
    setExpandedProject(projectId);
    setCurrentProjectTab(tab);

    if (typeof window === "undefined") return;

    if (isCurrentProject) {
      window.history.replaceState(window.history.state, "", projectHref);
      window.dispatchEvent(new CustomEvent(PROJECT_TAB_NAV_EVENT, {
        detail: { projectId, tab }
      }));
      return;
    }

    router.push(projectHref, { scroll: false });
  };

  return (
    <Root
      className={`flex h-full flex-col bg-sidebar border-r border-sidebar-border shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${
        variant === "drawer" ? "w-full" : collapsed ? "w-[68px]" : "w-[264px] lg:w-[68px] xl:w-[264px]"
      }`}
      style={{
        backgroundColor: "var(--color-sidebar)",
        borderColor: "var(--color-sidebar-border)",
      }}
    >
      {/* Brand Row */}
      <div className={`flex items-center justify-between px-4 h-[60px] shrink-0 border-b border-border ${isDesktop ? "lg:justify-center xl:justify-between" : "pr-16"}`}>
        <div className="flex items-center gap-2.5 min-w-0 overflow-hidden">
          {!collapsed && isDesktop ? <AppBrandLogo compact className="hidden h-8 w-8 rounded-lg lg:inline-flex xl:hidden" /> : null}
          {collapsed ? (
            <AppBrandLogo compact className="h-8 w-8 rounded-lg" />
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`min-w-0 ${expandedBlockClass}`}
            >
              <AppBrandLogo className="h-[18px] w-auto" />
              <span className="mt-0.5 block truncate text-[10px] font-semibold text-muted-foreground">
                {APP_NAME}
              </span>
            </motion.div>
          )}
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`${variant === "drawer" ? "hidden" : "hidden h-11 w-11 items-center justify-center rounded-lg hover:bg-muted text-muted-foreground transition-colors shrink-0 xl:inline-flex"}`}
          type="button"
        >
          <ChevronLeft
            className={`w-4 h-4 transition-transform duration-300 ${collapsed ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {/* Scrollable Nav */}
      <div className="flex-1 overflow-y-auto py-3 space-y-1 scrollbar-thin">
        {/* Navigate section */}
        {!collapsed && (
          <p className={`px-4 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground ${expandedBlockClass}`}>
            Navigate
          </p>
        )}

        {/* 1. Dashboard link */}
        {visibleNavItems.filter(item => item.label === "Dashboard").map((item) => (
          <Link key={item.href} href={item.href}>
            <div
              className={`flex items-center justify-between mx-2 px-3 py-2 rounded-xl cursor-pointer transition-all ${
                activeRoute === item.href
                  ? "bg-primary/8 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              } ${collapsed ? "justify-center" : compactRowClass} min-h-11`}
            >
              <div className={`flex items-center gap-3 ${collapsed ? "justify-center" : compactRowClass}`}>
                <item.icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span className={`text-[13.5px] ${expandedInlineClass}`}>{item.label}</span>}
              </div>
            </div>
          </Link>
        ))}

        {/* 2. Projects collapsible */}
        <div className="mx-2">
          <div className={`flex min-h-11 items-center rounded-xl transition-all text-muted-foreground hover:bg-muted hover:text-foreground ${collapsed ? "justify-center" : compactRowClass}`}>
            <Link href="/projects" className={`flex min-h-11 items-center gap-3 flex-1 px-3 py-2 ${compactRowClass}`}>
              <Briefcase className="w-4 h-4 shrink-0" />
              {!collapsed && <span className={`text-[13.5px] ${expandedInlineClass}`}>Projects</span>}
            </Link>
            {!collapsed && (
              <button
                onClick={() => setProjectsOpen(!projectsOpen)}
                aria-expanded={projectsOpen}
                aria-label={projectsOpen ? "Collapse projects" : "Expand projects"}
                className={`min-h-11 px-2 py-2 text-muted-foreground hover:text-foreground ${expandedBlockClass}`}
                type="button"
              >
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${projectsOpen ? "" : "-rotate-90"}`}
                />
              </button>
            )}
          </div>

          {/* Project tree */}
          <AnimatePresence>
            {projectsOpen && !collapsed && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className={`overflow-hidden mt-1 pl-3 ${expandedBlockClass}`}
              >
                <div className="space-y-0.5">
                  {sidebarProjects.map((proj) => (
                    <div key={proj.id}>
                      <button
                        onClick={() => {
                          setActiveProject(proj.id);
                          setExpandedProject(expandedProject === proj.id ? null : proj.id);
                        }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all hover:bg-muted/70 ${
                          activeProject === proj.id
                            ? "text-foreground font-medium"
                            : "text-muted-foreground"
                        }`}
                      >
                        {/* Arrow */}
                        <ChevronLeft
                          className={`w-3 h-3 shrink-0 text-muted-foreground/60 rotate-[270deg] transition-transform ${
                            expandedProject === proj.id ? "rotate-[360deg]" : ""
                          }`}
                        />
                        {/* Color avatar */}
                        <span
                          className="w-5 h-5 rounded-md flex items-center justify-center text-white text-[8px] font-bold shrink-0"
                          style={{ backgroundColor: proj.color }}
                        >
                          {proj.initials[0]}
                        </span>
                        <span className="text-[12.5px] truncate flex-1">{proj.name}</span>
                      </button>

                      {/* Sub-nav */}
                      <AnimatePresence>
                        {expandedProject === proj.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="overflow-hidden pl-9 border-l border-border ml-5"
                          >
                            {PROJECT_SUB.map((sub) => {
                              const projectHref = `/projects/${proj.id}?tab=${sub.tab}`;
                              const isCurrentProject = pathname === `/projects/${proj.id}`;
                              const isActive = isCurrentProject && currentProjectTab === sub.tab;
                              return (
                                <Link
                                  key={sub.label}
                                  href={projectHref}
                                  scroll={false}
                                  onClick={(event) => navigateProjectSubTab(event, proj.id, sub.tab)}
                                  aria-current={isActive ? "page" : undefined}
                                  className={`w-full flex items-center justify-between py-1.5 px-2.5 rounded-lg text-left text-[12px] transition-colors hover:bg-muted/60 ${
                                    isActive
                                      ? "text-primary font-semibold bg-primary/5"
                                      : "text-muted-foreground"
                                  }`}
                                >
                                  <span>{sub.label}</span>
                                  {sub.label === "Tasks" && (
                                    <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">
                                      {proj.taskCount}
                                    </span>
                                  )}
                                </Link>
                              );
                            })}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                  {shouldShowPinnedLoading && (
                    <div className="text-[11px] text-muted-foreground/50 px-3 py-2 italic text-center">
                      Loading pinned projects...
                    </div>
                  )}
                  {shouldShowNoProjects && (
                    <div className="text-[11px] text-muted-foreground/50 px-3 py-2 italic text-center">
                      No pinned projects
                    </div>
                  )}
                  {shouldShowPinnedUnavailable && (
                    <div className="text-[11px] text-muted-foreground/50 px-3 py-2 italic text-center">
                      Pinned projects unavailable
                    </div>
                  )}
                </div>

                {/* Add new project */}
                {onCreateProjectClick ? (
                  <button
                    onClick={onCreateProjectClick}
                    className="w-full min-h-11 flex items-center gap-2 px-3 py-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors mt-1"
                    type="button"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span className="text-[12px]">New Project</span>
                  </button>
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 3. Remaining production-ready nav items */}
        {visibleNavItems.filter(item => item.label !== "Dashboard" && item.label !== "Projects").map((item) => (
          <Link key={item.href} href={item.href}>
            <div
              className={`flex items-center justify-between mx-2 px-3 py-2 rounded-xl cursor-pointer transition-all ${
                activeRoute === item.href
                  ? "bg-primary/8 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              } ${collapsed ? "justify-center" : compactRowClass} min-h-11`}
            >
              <div className={`flex items-center gap-3 ${collapsed ? "justify-center" : compactRowClass}`}>
                <item.icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span className={`text-[13.5px] ${expandedInlineClass}`}>{item.label}</span>}
              </div>
              {/* Badge */}
              {!collapsed && "badge" in item && item.badge != null && item.badge > 0 && (
                <span className={`font-mono text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full shrink-0 ${expandedInlineClass}`}>
                  {item.badge}
                </span>
              )}
            </div>
          </Link>
        ))}

        {isWorkspaceAdmin ? (
          <Link href="/admin">
            <div
              className={`flex items-center justify-between mx-2 px-3 py-2 rounded-xl cursor-pointer transition-all ${
                activeRoute === "/admin"
                  ? "bg-primary/8 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              } ${collapsed ? "justify-center" : compactRowClass} min-h-11`}
            >
              <div className={`flex items-center gap-3 ${collapsed ? "justify-center" : compactRowClass}`}>
                <ShieldCheck className="w-4 h-4 shrink-0" />
                {!collapsed && <span className={`text-[13.5px] ${expandedInlineClass}`}>Admin</span>}
              </div>
            </div>
          </Link>
        ) : null}

        {/* 4. More section */}
        {!collapsed && visibleMoreItems.length > 0 && (
          <p className={`px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground ${expandedBlockClass}`}>
            More
          </p>
        )}
        {visibleMoreItems.map((item) => (
          <Link key={item.href} href={item.href}>
            <div
              className={`flex items-center gap-3 mx-2 px-3 py-2 rounded-xl cursor-pointer transition-all text-muted-foreground hover:bg-muted hover:text-foreground ${
                collapsed ? "justify-center" : ""
              } ${compactRowClass} min-h-11`}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {!collapsed && <span className={`text-[13.5px] ${expandedInlineClass}`}>{item.label}</span>}
            </div>
          </Link>
        ))}

      </div>

      {/* Bottom bar */}
      <div className="border-t border-border">
        {/* Settings/Language/Night mode/Learn */}
        <div className="px-2 py-2 space-y-0.5">
        {visibleBottomItems.map((item) => {
            const itemClassName = `w-full min-h-11 flex items-center justify-between px-3 py-2 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-colors ${
              collapsed ? "justify-center" : ""
            } ${compactRowClass}`;
            const content = (
              <>
                <div className="flex items-center gap-3">
                  <item.icon className="w-4 h-4 shrink-0" />
                  {!collapsed && <span className={`text-[13px] ${expandedInlineClass}`}>{item.label}</span>}
                </div>
                {item.isToggle && !collapsed && (
                  <div
                    aria-hidden="true"
                    className={`w-9 h-5 rounded-full transition-colors relative ${expandedFlexClass} ${
                      theme.isDark ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${
                        theme.isDark ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </div>
                )}
              </>
            );

            if (item.isToggle) {
              return (
              <button
                key={item.label}
                aria-label={`Night mode ${theme.isDark ? "on" : "off"}`}
                aria-pressed={theme.isDark}
                className={itemClassName}
                onClick={theme.toggle}
                type="button"
              >
                {content}
              </button>
              );
            }

            return (
              <Link className={itemClassName} href={item.href} key={item.label}>
                {content}
              </Link>
            );
          })}

        </div>

        {/* User card */}
        <div className="px-3 pb-3 pt-1">
          <UserCard collapsed={collapsed} responsiveDesktop={isDesktop} />
        </div>
      </div>
    </Root>
  );
}

// ─── User Card with Logout ────────────────────────────────────────────────────

function UserCard({ collapsed, responsiveDesktop }: { collapsed: boolean; responsiveDesktop: boolean }) {
  const { user, logout } = useAuth();
  const [showLogout, setShowLogout] = useState(false);

  const name         = user?.name         ?? "Guest";
  const email        = user?.email        ?? "";
  const initials     = user?.initials     ?? "G";
  const avatarColor  = user?.avatarColor  ?? "#64748b";
  const avatarUrl    = user?.avatarUrl;

  return (
    <div
      className={`flex items-center gap-2.5 p-2 rounded-xl hover:bg-muted cursor-pointer transition-colors group ${
        collapsed ? "justify-center" : ""
      }`}
      onMouseEnter={() => setShowLogout(true)}
      onMouseLeave={() => setShowLogout(false)}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-xs overflow-hidden"
          style={{ backgroundColor: avatarColor }}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            initials
          )}
        </div>
        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-success border-2 border-card" />
      </div>

      {/* Name + Email */}
      {!collapsed && (
        <div className={`min-w-0 flex-1 ${responsiveDesktop ? "lg:hidden xl:block" : ""}`}>
          <p className="text-xs font-semibold text-foreground truncate">{name}</p>
          <p className="text-[10px] text-muted-foreground truncate">{email}</p>
        </div>
      )}

      {/* Logout button — appears on hover */}
      {!collapsed && (
        <AnimatePresence>
          {showLogout && (
            <motion.button
              key="logout"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: "spring", damping: 20, stiffness: 400 }}
              onClick={(e) => { e.stopPropagation(); logout(); }}
              title="Sign out"
              className={`shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors ${responsiveDesktop ? "lg:hidden xl:inline-flex" : ""}`}
              type="button"
            >
              <LogOut className="w-3.5 h-3.5" />
            </motion.button>
          )}
        </AnimatePresence>
      )}

      {/* Collapsed mode: logout icon always visible */}
      {collapsed && (
        <button
          onClick={(e) => { e.stopPropagation(); logout(); }}
          title="Sign out"
          className="absolute bottom-0 right-0 p-0.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
        >
          <LogOut className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

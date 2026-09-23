"use client";
import { useDialogAccessibility } from "@/hooks/use-dialog-accessibility";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { APP_NAME, AppBrandLogo } from "./app-brand";
import { ModalLayer } from "./modal-layer";
import { getShellRoutes } from "../lib/production-route-readiness";

export type ShopifyIconName =
  | "alert"
  | "arrow-left"
  | "briefcase"
  | "cash"
  | "calendar"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "check"
  | "clock"
  | "database"
  | "edit"
  | "filter"
  | "info"
  | "list"
  | "log-out"
  | "plus"
  | "search"
  | "settings"
  | "shield"
  | "spark"
  | "target"
  | "trend"
  | "users"
  | "handoff"
  | "x";

export function ShopifyIcon({
  className,
  name,
  size = 16
}: Readonly<{ className?: string; name: ShopifyIconName; size?: number }>) {
  const common = {
    "aria-hidden": true,
    className: ["shopify-icon", className].filter(Boolean).join(" "),
    fill: "none",
    height: size,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.9,
    viewBox: "0 0 24 24",
    width: size,
    xmlns: "http://www.w3.org/2000/svg"
  };

  switch (name) {
    case "alert":
      return (
        <svg {...common}>
          <path d="M12 8v5" />
          <path d="M12 17h.01" />
          <path d="M10.3 3.7 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z" />
        </svg>
      );
    case "arrow-left":
      return (
        <svg {...common}>
          <path d="M19 12H5" />
          <path d="m12 19-7-7 7-7" />
        </svg>
      );
    case "briefcase":
      return (
        <svg {...common}>
          <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
          <path d="M4 7h16v12H4z" />
          <path d="M4 12h16" />
        </svg>
      );
    case "cash":
      return (
        <svg {...common}>
          <path d="M4 7h16v10H4z" />
          <path d="M8 12h.01" />
          <path d="M16 12h.01" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <path d="M7 3v3" />
          <path d="M17 3v3" />
          <path d="M4 8h16" />
          <path d="M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...common}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case "chevron-left":
      return (
        <svg {...common}>
          <path d="m15 18-6-6 6-6" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg {...common}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      );
    case "database":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="5" rx="7" ry="3" />
          <path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
          <path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
        </svg>
      );
    case "edit":
      return (
        <svg {...common}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
        </svg>
      );
    case "filter":
      return (
        <svg {...common}>
          <path d="M4 6h16" />
          <path d="M7 12h10" />
          <path d="M10 18h4" />
        </svg>
      );
    case "handoff":
      return (
        <svg {...common}>
          <path d="M7 7h10" />
          <path d="m13 3 4 4-4 4" />
          <path d="M17 17H7" />
          <path d="m11 21-4-4 4-4" />
        </svg>
      );
    case "info":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 11v5" />
          <path d="M12 8h.01" />
        </svg>
      );
    case "list":
      return (
        <svg {...common}>
          <path d="M8 6h12" />
          <path d="M8 12h12" />
          <path d="M8 18h12" />
          <path d="M4 6h.01" />
          <path d="M4 12h.01" />
          <path d="M4 18h.01" />
        </svg>
      );
    case "log-out":
      return (
        <svg {...common}>
          <path d="M10 17H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4" />
          <path d="M14 7l5 5-5 5" />
          <path d="M19 12H9" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2a2 2 0 0 1-4 0V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3a2 2 0 0 1 0-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V3a2 2 0 0 1 4 0v.2a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 20.2 7l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.2a2 2 0 0 1 0 4h-.2a1.7 1.7 0 0 0-1.6 1Z" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" />
          <path d="m9.5 12 1.7 1.7 3.6-4" />
        </svg>
      );
    case "spark":
      return (
        <svg {...common}>
          <path d="M12 3 9.8 8.8 4 11l5.8 2.2L12 19l2.2-5.8L20 11l-5.8-2.2z" />
          <path d="M19 4v3" />
          <path d="M20.5 5.5h-3" />
        </svg>
      );
    case "target":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="4.5" />
          <circle cx="12" cy="12" r="1" />
        </svg>
      );
    case "trend":
      return (
        <svg {...common}>
          <path d="M4 17 9 12l4 4 7-8" />
          <path d="M15 8h5v5" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
          <path d="M16 11a3 3 0 1 0-1-5.8" />
          <path d="M17 14.5a5 5 0 0 1 3.5 5.5" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      );
    default:
      return null;
  }
}

export type ShopifyActiveItem =
  | "accounts"
  | "dashboard"
  | "data"
  | "delivery"
  | "finance"
  | "management"
  | "pipeline"
  | "policy"
  | "portal"
  | "proposals"
  | "project-controls"
  | "resource-mgmt"
  | "support"
  | "tasks";

type ShopifyNavItem = {
  href: string;
  icon: ShopifyIconName;
  id: ShopifyActiveItem;
  label: string;
};

const SHOPIFY_ICONS: Record<ShopifyActiveItem, ShopifyIconName> = {
  accounts: "users", dashboard: "target", data: "database", delivery: "handoff", finance: "cash",
  management: "spark", pipeline: "trend", policy: "shield", portal: "shield", proposals: "briefcase",
  "project-controls": "shield", "resource-mgmt": "users", support: "info", tasks: "list"
};

const navGroups = Array.from(
  getShellRoutes("shopify").reduce((groups, route) => {
    const label = route.navGroup || "Workspace";
    const items = groups.get(label) ?? [];
    const id = route.id as ShopifyActiveItem;
    items.push({ id, icon: SHOPIFY_ICONS[id], label: route.label, href: route.href });
    groups.set(label, items);
    return groups;
  }, new Map<string, ShopifyNavItem[]>())
).map(([label, items]) => ({ label, items }));

const navItems = navGroups.flatMap((group) => group.items);

function getPrincipalInitials(principal: string) {
  const value = principal.trim();
  if (!value) return "U";
  const parts = value.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function PrincipalAvatar({ principal, avatarUrl }: Readonly<{ principal: string; avatarUrl?: string }>) {
  return (
    <span className="shopify-nav-user-avatar" aria-hidden="true">
      {avatarUrl ? <img alt="" referrerPolicy="no-referrer" src={avatarUrl} /> : getPrincipalInitials(principal)}
    </span>
  );
}

export type BadgeTone = "info" | "success" | "warning" | "critical" | "neutral";
export type ShopifyDataTableColumn = {
  align?: "center" | "left" | "right";
  header: ReactNode;
  key: string;
  mobileLabel?: string;
  mobilePriority?: "detail" | "hidden" | "metadata" | "title";
  width?: string;
};

export type ShopifyDataTableRow = {
  cells: ReactNode[];
  key: string;
  mobileActions?: ReactNode;
  mobileMeta?: ReactNode;
  mobileSubtitle?: ReactNode;
  mobileTitle?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
};

export function ShopifyAppShell({
  active,
  children,
  principal,
  principalAvatarUrl
}: Readonly<{ active: ShopifyActiveItem; children: ReactNode; principal: string; principalAvatarUrl?: string }>) {
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [isMobileNavigation, setIsMobileNavigation] = useState(false);
  const navDialogRef = useDialogAccessibility(isNavOpen && isMobileNavigation, () => setIsNavOpen(false));
  useEffect(() => { const media = matchMedia("(max-width: 900px)"); const update = () => { setIsMobileNavigation(media.matches); if (!media.matches) setIsNavOpen(false); }; update(); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isUserSettingsOpen, setIsUserSettingsOpen] = useState(false);
  const settingsDialogRef = useDialogAccessibility(isUserSettingsOpen, () => setIsUserSettingsOpen(false));
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [pendingActive, setPendingActive] = useState<ShopifyActiveItem | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const activeItem = navItems.find((item) => item.id === active);

  useEffect(() => {
    setPendingActive(null);
  }, [pathname]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      navItems.forEach((item) => {
        if (item.href !== pathname) {
          router.prefetch(item.href);
        }
      });
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [pathname, principal, router]);


  useEffect(() => {
    if (!isUserMenuOpen && !isUserSettingsOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (isUserMenuOpen && userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (isUserSettingsOpen) {
          setIsUserSettingsOpen(false);
        } else {
          setIsUserMenuOpen(false);
        }
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isUserMenuOpen, isUserSettingsOpen]);

  async function handleLogout() {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    setLogoutError(null);

    try {
      const response = await fetch("/api/auth/session/logout", {
        method: "POST",
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("Logout request failed");
      }

      const params = new URLSearchParams({
        auth_error: "logged_out",
        returnTo: pathname || "/"
      });
      window.location.assign(`/login?${params.toString()}`);
    } catch {
      setLogoutError("Chưa đăng xuất được. Hãy thử lại.");
      setIsLoggingOut(false);
    }
  }

  return (
    <div className={["shopify-app-frame", isNavOpen ? "nav-open" : ""].join(" ")}>
      <s-app-nav>
        {navItems
          .filter((item) => item.id !== "dashboard")
          .map((item) => (
            <s-link href={item.href} key={item.id}>
              {item.label}
            </s-link>
          ))}
      </s-app-nav>
      <header className="shopify-mobile-topbar">
        <div className="shopify-mobile-brand">
          <AppBrandLogo compact className="shopify-nav-brand-mark" />
          <div>
            <strong>{APP_NAME}</strong>
            <span>{activeItem?.label ?? "Tổng quan"}</span>
          </div>
        </div>
        <button
          aria-controls="crm-mobile-navigation"
          aria-expanded={isNavOpen}
          aria-label={isNavOpen ? "Đóng menu" : "Mở menu"}
          className="shopify-mobile-menu-button"
          onClick={() => setIsNavOpen((current) => !current)}
          type="button"
        >
          {isNavOpen ? <ShopifyIcon name="x" size={18} /> : <ShopifyIcon name="list" size={18} />}
          <span>Menu</span>
        </button>
      </header>
      <button
        aria-label="Đóng menu"
        aria-hidden="true"
        className="shopify-mobile-nav-overlay"
        hidden={!isNavOpen}
        onClick={() => setIsNavOpen(false)}
        tabIndex={-1}
        type="button"
      />
      <aside
        ref={navDialogRef}
        inert={isMobileNavigation && !isNavOpen}
        aria-hidden={isMobileNavigation && !isNavOpen ? true : undefined}
        role={isMobileNavigation && isNavOpen ? "dialog" : undefined}
        aria-modal={isMobileNavigation && isNavOpen ? true : undefined}
        tabIndex={-1}
        aria-label="Khu vực CRM"
        className="shopify-local-nav"
        id="crm-mobile-navigation"
      >
        {isMobileNavigation && <button className="shopify-drawer-close" type="button" aria-label="Đóng menu điều hướng" onClick={() => setIsNavOpen(false)}><ShopifyIcon name="x" size={18}/></button>}
        <div className="shopify-nav-brand">
          <AppBrandLogo compact className="shopify-nav-brand-mark" />
          <div>
            <strong>{APP_NAME}</strong>
            <span>SaaS Workspace</span>
          </div>
        </div>
        <nav className="shopify-nav-links">
          {navGroups.map((group) => (
            <div className="shopify-nav-group" key={group.label}>
              <span className="shopify-nav-group-label">{group.label}</span>
              {group.items.map((item) => (
                <Link
                  aria-current={active === item.id ? "page" : undefined}
                  data-route-pending={pendingActive === item.id ? "true" : undefined}
                  href={item.href}
                  key={item.id}
                  onClick={() => {
                    setIsNavOpen(false);
                    if (item.href !== pathname) {
                      setPendingActive(item.id);
                    }
                  }}
                  onMouseEnter={() => {
                    router.prefetch(item.href);
                  }}
                >
                  <span className="shopify-nav-link-icon">
                    <ShopifyIcon name={item.icon} size={15} />
                  </span>
                  <span className="shopify-nav-link-label">{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="shopify-nav-footer" ref={userMenuRef}>
          <button
            aria-expanded={isUserMenuOpen}
            aria-haspopup="menu"
            className="shopify-nav-user-trigger"
            onClick={() => {
              setLogoutError(null);
              setIsUserMenuOpen((current) => !current);
            }}
            type="button"
          >
            <PrincipalAvatar avatarUrl={principalAvatarUrl} principal={principal} />
            <span className="shopify-nav-user-copy">
              <span>Đang đăng nhập</span>
              <strong>{principal}</strong>
            </span>
            <ShopifyIcon
              className={isUserMenuOpen ? "shopify-nav-user-chevron is-open" : "shopify-nav-user-chevron"}
              name="chevron-down"
              size={15}
            />
          </button>

          {isUserMenuOpen ? (
            <div aria-label="Tài khoản người dùng" className="shopify-nav-user-menu" role="menu">
              <button
                className="shopify-nav-user-menu-item"
                onClick={() => {
                  setIsUserMenuOpen(false);
                  setIsUserSettingsOpen(true);
                }}
                role="menuitem"
                type="button"
              >
                <ShopifyIcon name="settings" size={16} />
                <span>Cài đặt tài khoản</span>
              </button>
              <button
                className="shopify-nav-user-menu-item danger"
                disabled={isLoggingOut}
                onClick={handleLogout}
                role="menuitem"
                type="button"
              >
                <ShopifyIcon name="log-out" size={16} />
                <span>{isLoggingOut ? "Đang đăng xuất..." : "Đăng xuất"}</span>
              </button>
              {logoutError ? <p className="shopify-nav-user-error" role="alert">{logoutError}</p> : null}
            </div>
          ) : null}

          {isUserSettingsOpen ? (
            <ModalLayer onClose={() => setIsUserSettingsOpen(false)}>
            <div
              className="shopify-user-settings-backdrop"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setIsUserSettingsOpen(false);
                }
              }}
            >
              <section
                ref={settingsDialogRef}
                aria-labelledby="shopify-user-settings-title"
                aria-modal="true"
                className="shopify-user-settings-dialog"
                role="dialog"
                tabIndex={-1}
              >
                <div className="shopify-user-settings-header">
                  <div>
                    <span>Cài đặt người dùng</span>
                    <h2 id="shopify-user-settings-title">Phiên làm việc CRM</h2>
                  </div>
                  <button
                    aria-label="Đóng cài đặt người dùng"
                    className="shopify-user-settings-close"
                    onClick={() => setIsUserSettingsOpen(false)}
                    type="button"
                  >
                    <ShopifyIcon name="x" size={17} />
                  </button>
                </div>

                <div className="shopify-user-settings-profile">
                  <PrincipalAvatar avatarUrl={principalAvatarUrl} principal={principal} />
                  <div>
                    <span>Tên hiển thị</span>
                    <strong>{principal}</strong>
                  </div>
                </div>

                <dl className="shopify-user-settings-list">
                  <div>
                    <dt>Trạng thái</dt>
                    <dd>Đang hoạt động</dd>
                  </div>
                  <div>
                    <dt>Phạm vi truy cập</dt>
                    <dd>Theo role & dự án</dd>
                  </div>
                  <div>
                    <dt>Khu vực hiện tại</dt>
                    <dd>{activeItem?.label ?? "Tổng quan"}</dd>
                  </div>
                  <div>
                    <dt>Đường dẫn</dt>
                    <dd>{pathname || "/"}</dd>
                  </div>
                </dl>
              </section>
            </div>
            </ModalLayer>
          ) : null}
        </div>
      </aside>
      <main aria-busy={pendingActive ? "true" : undefined} className="shopify-app-main crm-route-transition" data-route-pending={pendingActive ? "true" : undefined} key={pathname}>
        {children}
      </main>
    </div>
  );
}

export function ShopifyPage({
  children,
  heading,
  inlineSize = "large"
}: Readonly<{ children: ReactNode; heading: string; inlineSize?: "base" | "large" | "small" }>) {
  return (
    <s-page inlineSize={inlineSize}>
      <h1 style={{
        fontSize: "20px",
        fontWeight: 700,
        color: "var(--text)",
        fontFamily: "var(--font-sans)",
        marginTop: 0,
        marginBottom: "12px",
        letterSpacing: "-0.01em",
        lineHeight: "1.4"
      }}>
        {heading}
      </h1>
      {children}
    </s-page>
  );
}

export function ShopifySection({
  children,
  heading
}: Readonly<{ children: ReactNode; heading: string }>) {
  return <s-section heading={heading}>{children}</s-section>;
}

export function ShopifyBanner({
  children,
  heading,
  tone = "info"
}: Readonly<{ children: ReactNode; heading: string; tone?: "info" | "success" | "warning" | "critical" }>) {
  return (
    <s-banner heading={heading} tone={tone}>
      {children}
    </s-banner>
  );
}

export function ShopifyStatusItem({
  detail,
  label,
  tone = "info",
  value
}: Readonly<{ detail?: string; label: string; tone?: BadgeTone; value: string }>) {
  return (
    <div className="shopify-status-item">
      <s-badge tone={tone}>{label}</s-badge>
      <div>
        <strong>{value}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
    </div>
  );
}

export function FieldRow({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="shopify-field-row">{children}</div>;
}

export function PolarisFallbackText({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="shopify-muted">{children}</p>;
}

export function ShopifyDataTable({
  ariaLabel,
  columns,
  minWidth = 720,
  rows
}: Readonly<{
  ariaLabel: string;
  columns: ShopifyDataTableColumn[];
  minWidth?: number | string;
  rows: ShopifyDataTableRow[];
}>) {
  const hasInteractiveRows = rows.some((row) => row.onClick);
  const mobileColumns = columns.filter((column) => column.mobilePriority !== "hidden");
  const [isCompactTable, setIsCompactTable] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const sync = () => setIsCompactTable(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  function getMobileLabel(column: ShopifyDataTableColumn) {
    if (column.mobileLabel) return column.mobileLabel;
    if (typeof column.header === "string") return column.header;
    return column.key;
  }

  return (
    <>
      {!isCompactTable ? <div className="shopify-data-table-shell">
        <table
          aria-label={ariaLabel}
          className={`shopify-data-table${hasInteractiveRows ? " is-interactive" : ""}`}
          style={{ minWidth }}
        >
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} style={column.width ? { width: column.width } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((column) => (
                <th data-align={column.align ?? "left"} key={column.key} scope="col">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                aria-selected={row.selected || undefined}
                className={row.selected ? "selected" : undefined}
                key={row.key}
                onClick={row.onClick}
                onKeyDown={(event) => {
                  if (!row.onClick || (event.key !== "Enter" && event.key !== " ")) return;
                  event.preventDefault();
                  row.onClick();
                }}
                tabIndex={row.onClick ? 0 : undefined}
              >
                {columns.map((column, index) => (
                  <td data-align={column.align ?? "left"} key={column.key}>
                    {row.cells[index] ?? null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div> : null}
      {isCompactTable ? <div aria-label={`${ariaLabel} cards`} className="shopify-mobile-data-list">
        {rows.map((row) => {
          const details = mobileColumns
            .map((column) => ({ column, index: columns.findIndex((item) => item.key === column.key) }))
            .filter(({ column, index }) => {
              if (index < 0) return false;
              if (column.mobilePriority === "title") return false;
              if (!row.mobileTitle && index === 0) return false;
              return Boolean(row.cells[index]);
            });

          return (
            <article
              className={[
                "shopify-mobile-data-card",
                row.selected ? "selected" : "",
                row.onClick ? "is-interactive" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              key={`${row.key}-mobile`}
              onClick={row.onClick}
              onKeyDown={(event) => {
                if (!row.onClick || (event.key !== "Enter" && event.key !== " ")) return;
                event.preventDefault();
                row.onClick();
              }}
              tabIndex={row.onClick ? 0 : undefined}
            >
              <div className="shopify-mobile-data-card-head">
                <div className="shopify-mobile-data-title">{row.mobileTitle ?? row.cells[0]}</div>
                {row.mobileMeta ? <div className="shopify-mobile-data-meta">{row.mobileMeta}</div> : null}
              </div>
              {row.mobileSubtitle ? <div className="shopify-mobile-data-subtitle">{row.mobileSubtitle}</div> : null}
              {details.length > 0 ? (
                <div className="shopify-mobile-data-grid">
                  {details.map(({ column, index }) => (
                    <div className="shopify-mobile-data-field" key={`${row.key}-${column.key}-mobile`}>
                      <span className="shopify-mobile-data-label">{getMobileLabel(column)}</span>
                      <span className="shopify-mobile-data-value">{row.cells[index]}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {row.mobileActions ? <div className="shopify-mobile-data-actions">{row.mobileActions}</div> : null}
            </article>
          );
        })}
      </div> : null}
    </>
  );
}

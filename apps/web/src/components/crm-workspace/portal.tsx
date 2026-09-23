"use client";

import { useState } from "react";
import { ShopifyAppShell, ShopifyDataTable, ShopifyPage, ShopifySection, ShopifyStatusItem, ShopifyBanner } from "../shopify-ui";
import { MoneyAmount } from "@/components/money-amount";

interface PortalDocument {
  id: string;
  title: string;
  type: "BRD" | "SOW" | "Contract" | "Acceptance" | "Training";
  customerVisible: boolean;
  allowedRoles: string[];
}

interface PortalTicket {
  id: string;
  title: string;
  category: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  status: string;
  slaTarget: string;
  creator: string;
}

type PortalRole = "Customer Sponsor" | "Customer Project Member" | "Client Finance" | "Customer Requester";

const portalRoleLabels: Record<PortalRole, string> = {
  "Customer Sponsor": "Người bảo trợ khách hàng",
  "Customer Project Member": "Thành viên dự án",
  "Client Finance": "Tài chính khách hàng",
  "Customer Requester": "Người gửi yêu cầu"
};

const documentTypeLabels: Record<PortalDocument["type"], string> = {
  Acceptance: "Nghiệm thu",
  BRD: "Yêu cầu nghiệp vụ",
  Contract: "Hợp đồng",
  SOW: "Phạm vi công việc",
  Training: "Đào tạo"
};

const ticketStatusLabels: Record<string, string> = {
  Assigned: "Đã phân công",
  "In Progress": "Đang xử lý",
  Resolved: "Đã xử lý",
  Submitted: "Đã gửi"
};

function formatPortalRole(role: string) {
  return portalRoleLabels[role as PortalRole] ?? role.replace("Client Portal Admin", "Quản trị khách hàng");
}

const portalDocs: PortalDocument[] = [];

const initialTickets: PortalTicket[] = [];

export function PortalFunctionPage() {
  const [portalRole, setPortalRole] = useState<PortalRole>("Customer Sponsor");
  const [activeTab, setActiveTab] = useState<"project" | "docs" | "tickets" | "payments" | "usage" | "access">("project");
  const [tickets, setTickets] = useState<PortalTicket[]>(initialTickets);

  // Form submit ticket
  const [ticketTitle, setTicketTitle] = useState("");
  const [ticketCategory, setTicketCategory] = useState("Câu hỏi sử dụng Lark");
  const [ticketPriority, setTicketPriority] = useState<"High" | "Medium" | "Low">("Medium");

  function handleCreateTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!ticketTitle.trim()) return;

    const newTicket: PortalTicket = {
      id: `t-${Date.now()}`,
      title: ticketTitle,
      category: ticketCategory,
      priority: ticketPriority === "High" ? "High" : (ticketPriority === "Low" ? "Low" : "Medium"),
      status: "Submitted",
      slaTarget: ticketPriority === "High" ? "Phản hồi trong 4 giờ" : "Phản hồi trong 1 ngày",
      creator: portalRole === "Customer Sponsor" ? "sponsor@customer.example" : "requester@customer.example"
    };

    setTickets(prev => [...prev, newTicket]);
    setTicketTitle("");
    alert("Gửi yêu cầu thành công! Đội chăm sóc khách hàng sẽ phản hồi đúng khung cam kết.");
  }

  // Helper check tab visibility based on Role matrix
  function isTabVisible(tab: string) {
    if (portalRole === "Customer Requester") {
      return tab === "tickets";
    }
    if (portalRole === "Customer Project Member") {
      return tab === "project" || tab === "docs" || tab === "tickets" || tab === "usage";
    }
    if (portalRole === "Client Finance") {
      return tab === "docs" || tab === "payments" || tab === "tickets";
    }
    return true; // Sponsor has full access
  }

  return (
    <ShopifyAppShell active="portal" principal="customer-portal">
      <ShopifyPage heading="Giao diện khách hàng">
        
        {/* Portal Role Switcher */}
        <div className="portal-role-switcher">
          <strong>Chọn vai trò khách hàng:</strong>
          <div className="portal-role-options">
            {(Object.keys(portalRoleLabels) as PortalRole[]).map(role => (
              <button key={role} type="button" className="portal-role-button" aria-pressed={portalRole === role}
                onClick={() => { setPortalRole(role); setActiveTab(role === "Client Finance" ? "docs" : role === "Customer Requester" ? "tickets" : "project"); }}>
                {portalRoleLabels[role]}
              </button>
            ))}
          </div>
        </div>

        <div className="shopify-status-row" aria-label="Thông tin khách hàng">
          <s-badge tone="neutral">Khách hàng: chưa có dữ liệu thật</s-badge>
          <s-badge tone="info">Đăng nhập đang hoạt động</s-badge>
          <s-badge tone="neutral">Vai trò: {portalRoleLabels[portalRole]}</s-badge>
        </div>

        {/* Local Portal Navigation */}
        <nav aria-label="Các mục cổng khách hàng" className="shopify-nav-links portal-section-tabs" style={{ display: "flex", gap: "8px", margin: "16px 0", borderBottom: "1px solid var(--border)", paddingBottom: "8px" }}>
          {isTabVisible("project") && <a href="#" aria-current={activeTab === "project" ? "page" : undefined} onClick={(e) => { e.preventDefault(); setActiveTab("project"); }}>Tổng quan dự án</a>}
          {isTabVisible("docs") && <a href="#" aria-current={activeTab === "docs" ? "page" : undefined} onClick={(e) => { e.preventDefault(); setActiveTab("docs"); }}>Tài liệu</a>}
          {isTabVisible("tickets") && <a href="#" aria-current={activeTab === "tickets" ? "page" : undefined} onClick={(e) => { e.preventDefault(); setActiveTab("tickets"); }}>Yêu cầu hỗ trợ</a>}
          {isTabVisible("payments") && <a href="#" aria-current={activeTab === "payments" ? "page" : undefined} onClick={(e) => { e.preventDefault(); setActiveTab("payments"); }}>Thanh toán</a>}
          {isTabVisible("usage") && <a href="#" aria-current={activeTab === "usage" ? "page" : undefined} onClick={(e) => { e.preventDefault(); setActiveTab("usage"); }}>Tổng hợp sử dụng</a>}
          {isTabVisible("access") && <a href="#" aria-current={activeTab === "access" ? "page" : undefined} onClick={(e) => { e.preventDefault(); setActiveTab("access"); }}>Quản lý truy cập</a>}
        </nav>

        {/* PROJECT OVERVIEW TAB */}
        {activeTab === "project" && isTabVisible("project") && (
          <div className="shopify-two-column">
            <div className="shopify-stack">
              <ShopifySection heading="Tổng quan dự án & giai đoạn">
                <div className="shopify-stage-list portal-stage-list">
                  <div className="shopify-stage-row">
                    <span>1. Khởi động dự án (Kickoff)</span>
                    <s-badge tone="success">Đã hoàn thành</s-badge>
                  </div>
                  <div className="shopify-stage-row">
                    <span>2. Khảo sát & Blueprint</span>
                    <s-badge tone="success">Đã hoàn thành</s-badge>
                  </div>
                  <div className="shopify-stage-row">
                    <span>3. Xây dựng cấu hình (Build & Customization)</span>
                    <s-badge tone="info">Đang triển khai</s-badge>
                  </div>
                  <div className="shopify-stage-row">
                    <span>4. Chạy thử & Nghiệm thu (UAT & Acceptance)</span>
                    <s-badge tone="neutral">Chưa bắt đầu</s-badge>
                  </div>
                </div>
              </ShopifySection>
            </div>
            <div className="shopify-stack">
              <ShopifySection heading="Việc khách hàng cần xử lý">
                <div className="shopify-resource-list">
                  <article>
                    <div>
                      <strong>Duyệt biên bản họp Blueprint</strong>
                      <span>Hạn hoàn thành: 12/06/2026</span>
                    </div>
                    <s-badge tone="warning">Đang chờ</s-badge>
                  </article>
                  <article>
                    <div>
                      <strong>Cung cấp danh sách email nhân sự tham gia đào tạo</strong>
                      <span>Hạn hoàn thành: 18/06/2026</span>
                    </div>
                    <s-badge tone="neutral">Chưa gán</s-badge>
                  </article>
                </div>
              </ShopifySection>
            </div>
          </div>
        )}

        {/* DOCUMENTS TAB */}
        {activeTab === "docs" && isTabVisible("docs") && (
          <ShopifySection heading="Tài liệu dự án">
            <ShopifyDataTable
              ariaLabel="Tài liệu dự án"
              columns={[
                { key: "title", header: "Tên tài liệu", width: "40%" },
                { key: "category", header: "Nhóm", width: "15%" },
                { key: "visibility", header: "Vai trò được xem", width: "30%" },
                { key: "action", header: "Thao tác", width: "15%" }
              ]}
              rows={portalDocs
                .filter(doc => doc.allowedRoles.includes(portalRole))
                .map(doc => ({
                  key: doc.id,
                  cells: [
                    <strong>{doc.title}</strong>,
                    <s-badge tone="info">{documentTypeLabels[doc.type]}</s-badge>,
                    (
                      <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                        {doc.allowedRoles.map(formatPortalRole).join(", ")}
                      </span>
                    ),
                    <s-button onClick={() => alert(`Đang tải file ${doc.title}...`)}>Tải về</s-button>
                  ]
                }))}
            />
          </ShopifySection>
        )}

        {/* TICKETS TAB */}
        {activeTab === "tickets" && isTabVisible("tickets") && (
          <div className="shopify-two-column">
            <div className="shopify-stack">
              <ShopifySection heading="Gửi yêu cầu hỗ trợ hoặc thay đổi">
                <form onSubmit={handleCreateTicket} className="shopify-form-stack">
                  <div>
                    <label htmlFor="portal-ticket-title" style={{ display: "block", marginBottom: "6px", fontWeight: 650 }}>Mô tả ngắn lỗi / Yêu cầu</label>
                    <input
                      id="portal-ticket-title"
                      type="text"
                      value={ticketTitle}
                      onChange={e => setTicketTitle(e.target.value)}
                      required
                      placeholder="Ví dụ: Không gửi được approval workflow trên di động..."
                      style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)" }}
                    />
                  </div>
                  <div className="shopify-field-row">
                    <div>
                      <label htmlFor="portal-ticket-category" style={{ display: "block", marginBottom: "6px", fontWeight: 650 }}>Phân loại</label>
                      <select
                        id="portal-ticket-category"
                        value={ticketCategory}
                        onChange={e => setTicketCategory(e.target.value)}
                        style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)" }}
                      >
                        <option value="Lỗi truy cập">Lỗi truy cập</option>
                        <option value="Câu hỏi sử dụng Lark">Câu hỏi sử dụng Lark</option>
                        <option value="Báo lỗi hệ thống">Báo lỗi hệ thống</option>
                        <option value="Yêu cầu thay đổi">Yêu cầu thay đổi</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="portal-ticket-priority" style={{ display: "block", marginBottom: "6px", fontWeight: 650 }}>Độ ưu tiên</label>
                      <select
                        id="portal-ticket-priority"
                        value={ticketPriority}
                        onChange={e => setTicketPriority(e.target.value as any)}
                        style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)" }}
                      >
                        <option value="Low">Thấp</option>
                        <option value="Medium">Vừa</option>
                        <option value="High">Cao</option>
                      </select>
                    </div>
                  </div>
                  <div className="shopify-action-row end">
                    <s-button type="submit" variant="primary">Gửi yêu cầu</s-button>
                  </div>
                </form>
              </ShopifySection>
            </div>
            <div className="shopify-stack">
              <ShopifySection heading="Yêu cầu hỗ trợ của tôi">
                <div className="shopify-resource-list">
                  {tickets
                    .filter(t => portalRole === "Customer Sponsor" || portalRole === "Client Finance" || t.creator.includes("requester") || t.creator.includes("member"))
                    .map(t => (
                      <article key={t.id}>
                        <div>
                          <strong>[{t.category}] {t.title}</strong>
                          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Cam kết: {t.slaTarget}</span>
                        </div>
                        <s-badge tone={t.status === "Resolved" ? "success" : "warning"}>{ticketStatusLabels[t.status] ?? t.status}</s-badge>
                      </article>
                    ))}
                </div>
              </ShopifySection>
            </div>
          </div>
        )}

        {/* PAYMENTS TAB */}
        {activeTab === "payments" && isTabVisible("payments") && (
          <ShopifySection heading="Lịch thanh toán đã thống nhất">
            <ShopifyDataTable
              ariaLabel="Lịch thanh toán đã thống nhất"
              columns={[
                { key: "phase", header: "Đợt thanh toán / mốc", width: "32%" },
                { key: "date", header: "Hạn thanh toán", width: "16%" },
                { key: "amount", header: "Số tiền / tỷ lệ", width: "20%" },
                { key: "invoice", header: "Trạng thái hóa đơn", width: "16%" },
                { key: "payment", header: "Trạng thái thanh toán", width: "16%" }
              ]}
              rows={[
                {
                  key: "payment-1",
                  cells: [
                    <strong>Đợt 1: Ký hợp đồng</strong>,
                    "10/05/2026",
                    <span className="font-mono tabular-nums text-right"><MoneyAmount value={36_000_000} /> (30%)</span>,
                    <s-badge tone="success">Đã xuất</s-badge>,
                    <s-badge tone="success">Đã thanh toán</s-badge>
                  ]
                },
                {
                  key: "payment-2",
                  cells: [
                    <strong>Đợt 2: Nghiệm thu Blueprint</strong>,
                    "15/06/2026",
                    <span className="font-mono tabular-nums text-right"><MoneyAmount value={48_000_000} /> (40%)</span>,
                    <s-badge tone="warning">Đang chờ</s-badge>,
                    <s-badge tone="neutral">Chưa thanh toán</s-badge>
                  ]
                }
              ]}
            />
          </ShopifySection>
        )}

        {/* USAGE SUMMARY TAB */}
        {activeTab === "usage" && isTabVisible("usage") && (
          <div className="shopify-two-column">
            <div className="shopify-stack">
          <ShopifySection heading="Tình hình sử dụng Lark tuần 24">
            <div className="shopify-status-grid compact">
                  <ShopifyStatusItem label="Người dùng đang hoạt động" value="28 / 30" tone="success" />
                  <ShopifyStatusItem label="Tin nhắn mỗi ngày" value="245 tin nhắn" />
                  <ShopifyStatusItem label="Bảng Base đang dùng" value="6 bảng" tone="info" />
                  <ShopifyStatusItem label="Hài lòng tháng này" value="4.8 / 5.0" tone="success" />
                </div>
              </ShopifySection>
            </div>
            <div className="shopify-stack">
              <ShopifySection heading="Hành động sử dụng tiếp theo">
                <s-paragraph>
                  Dựa trên nhịp vận hành tháng 5, chúng ta cần hoàn thiện đào tạo luồng phê duyệt nâng cao cho tổ nhân sự vào tuần tiếp theo.
                </s-paragraph>
              </ShopifySection>
            </div>
          </div>
        )}

        {/* ACCESS / ADMIN TAB */}
        {activeTab === "access" && isTabVisible("access") && (
          <ShopifySection heading="Quản lý người dùng portal">
            <s-paragraph>
              Chưa có khách hàng thật được cấp quyền portal trong hệ thống local.
            </s-paragraph>
            <div style={{ marginTop: "12px" }}>
              <ShopifyDataTable
                ariaLabel="Người dùng portal được mời"
                columns={[
                  { key: "email", header: "Email", width: "40%" },
                  { key: "role", header: "Vai trò truy cập", width: "25%" },
                  { key: "status", header: "Trạng thái", width: "15%" },
                  { key: "action", header: "Thao tác", width: "20%" }
                ]}
                rows={[]}
              />
            </div>
          </ShopifySection>
        )}

      </ShopifyPage>
    </ShopifyAppShell>
  );
}

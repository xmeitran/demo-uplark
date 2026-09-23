"use client";

import dynamic from "next/dynamic";
import type { DashboardWorkbenchProps } from "./dashboard-workbench";

const DashboardWorkbench = dynamic(
  () => import("./dashboard-workbench").then((module) => module.DashboardWorkbench),
  {
    ssr: false,
    loading: () => (
      <section className="dashboard-panel" aria-label="Đang chuẩn bị tổng quan">
        <div className="dashboard-panel-header">
          <span className="dashboard-panel-icon" aria-hidden="true" />
          <div>
            <h3>Đang chuẩn bị tổng quan</h3>
            <p>Dữ liệu đã sẵn sàng, biểu đồ đang được tải riêng để chuyển trang nhanh hơn.</p>
          </div>
        </div>
      </section>
    )
  }
);

export function LazyDashboardWorkbench(props: DashboardWorkbenchProps) {
  return <DashboardWorkbench {...props} />;
}

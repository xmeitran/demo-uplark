"use client";

import { LayoutDashboard } from "lucide-react";
import { ModuleUnavailablePage } from "@/components/constructor-x/module-unavailable-page";

export default function ConstructorXPage() {
  return (
    <ModuleUnavailablePage
      activeRoute="/constructor-x"
      title="Legacy dashboard"
      description="This legacy workspace surface is disabled in production. Use the live UpLark Partner CRM dashboard and project workspaces instead."
      icon={LayoutDashboard}
    />
  );
}

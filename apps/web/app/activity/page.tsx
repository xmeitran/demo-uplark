"use client";

import { Activity } from "lucide-react";
import { ModuleUnavailablePage } from "@/components/constructor-x/module-unavailable-page";

export default function ActivityPage() {
  return (
    <ModuleUnavailablePage
      activeRoute="/activity"
      title="Activity"
      description="Activity is disabled for this production workspace until the audit timeline is backed by real operational events."
      icon={Activity}
    />
  );
}

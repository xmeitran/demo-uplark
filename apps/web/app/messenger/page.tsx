"use client";

import { MessageSquare } from "lucide-react";
import { ModuleUnavailablePage } from "@/components/constructor-x/module-unavailable-page";

export default function MessengerPage() {
  return (
    <ModuleUnavailablePage
      activeRoute="/messenger"
      title="Messenger"
      description="Messenger is disabled for this production workspace until real threaded conversations and access policies are connected."
      icon={MessageSquare}
    />
  );
}

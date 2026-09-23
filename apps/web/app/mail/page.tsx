"use client";

import { Mail } from "lucide-react";
import { ModuleUnavailablePage } from "@/components/constructor-x/module-unavailable-page";

export default function MailPage() {
  return (
    <ModuleUnavailablePage
      activeRoute="/mail"
      title="Mail"
      description="Mail is disabled for this production workspace until real mailbox synchronization and consent boundaries are connected."
      icon={Mail}
    />
  );
}

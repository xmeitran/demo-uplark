"use client";

import { BookOpen } from "lucide-react";
import { ModuleUnavailablePage } from "@/components/constructor-x/module-unavailable-page";

export default function KnowledgePage() {
  return (
    <ModuleUnavailablePage
      activeRoute="/knowledge"
      title="Knowledge Base"
      description="Knowledge Base is disabled for this production workspace until articles are backed by real content ownership and review state."
      icon={BookOpen}
    />
  );
}

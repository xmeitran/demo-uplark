"use client";

import { StickyNote } from "lucide-react";
import { ModuleUnavailablePage } from "@/components/constructor-x/module-unavailable-page";

export default function NotesPage() {
  return (
    <ModuleUnavailablePage
      activeRoute="/notes"
      title="Notes"
      description="Notes are disabled for this production workspace until they are backed by workspace-scoped records and permissions."
      icon={StickyNote}
    />
  );
}

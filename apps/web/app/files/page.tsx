"use client";

import { FolderOpen } from "lucide-react";
import { ModuleUnavailablePage } from "@/components/constructor-x/module-unavailable-page";

export default function FilesPage() {
  return (
    <ModuleUnavailablePage
      activeRoute="/files"
      title="Files"
      description="Files are disabled for this production workspace until artifact storage, signed downloads, and malware verdicts are connected."
      icon={FolderOpen}
    />
  );
}

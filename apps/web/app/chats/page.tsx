"use client";

import { MessagesSquare } from "lucide-react";
import { ModuleUnavailablePage } from "@/components/constructor-x/module-unavailable-page";

export default function ChatsPage() {
  return (
    <ModuleUnavailablePage
      activeRoute="/chats"
      title="Chats"
      description="Chats are disabled for this production workspace until conversation sync is connected to real workspace identities."
      icon={MessagesSquare}
    />
  );
}

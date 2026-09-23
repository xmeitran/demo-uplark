"use client";

import { ReceiptText } from "lucide-react";
import { ModuleUnavailablePage } from "@/components/constructor-x/module-unavailable-page";

export default function InvoicesPage() {
  return (
    <ModuleUnavailablePage
      activeRoute="/invoices"
      title="Invoices"
      description="Invoices are disabled for this production workspace until finance records, approval state, and audit history are connected."
      icon={ReceiptText}
    />
  );
}

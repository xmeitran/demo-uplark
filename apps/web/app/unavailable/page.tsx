"use client";

import { ShieldAlert } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { ModuleUnavailablePage } from "@/components/constructor-x/module-unavailable-page";

export default function UnavailablePage() {
  const requestedRoute = useSearchParams().get("route") || "this module";
  return (
    <ModuleUnavailablePage
      activeRoute={requestedRoute}
      title="Module not available"
      description={`${requestedRoute} is not classified as production-ready. It has been kept out of navigation until its data and interaction contracts are verified.`}
      icon={ShieldAlert}
    />
  );
}

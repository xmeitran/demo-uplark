"use client";

import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import type { AgentationProps } from "agentation";

type AgentationComponent = ComponentType<AgentationProps>;

export function AgentationDevTools() {
  const [Agentation, setAgentation] = useState<AgentationComponent | null>(null);
  const isEnabled = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_SHOW_AGENTATION === "1";

  useEffect(() => {
    if (!isEnabled) {
      return;
    }

    let isMounted = true;

    import("agentation").then((mod) => {
      if (isMounted) {
        setAgentation(() => mod.Agentation);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [isEnabled]);

  if (!isEnabled || !Agentation) {
    return null;
  }

  return (
    <Agentation
      className="lcrm-agentation-toolbar"
      endpoint={process.env.NEXT_PUBLIC_AGENTATION_ENDPOINT}
    />
  );
}

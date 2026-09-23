"use client";

import { MotionConfig } from "framer-motion";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user"><ThemeProvider><AuthProvider>{children}</AuthProvider></ThemeProvider></MotionConfig>;
}

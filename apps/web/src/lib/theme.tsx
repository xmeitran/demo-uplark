"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export const THEME_STORAGE_KEY = "uplark-partner-crm-theme:v1";

type ThemeContextValue = {
  isDark: boolean;
  setDark: (dark: boolean) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

function persistTheme(dark: boolean) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, dark ? "dark" : "light");
  } catch {
    // Storage can be unavailable in private/quota-restricted contexts. The
    // active document theme remains usable for the current session.
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const dark = document.documentElement.classList.contains("dark");
    setIsDark(dark);
    applyTheme(dark);
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({
    isDark,
    setDark: (dark) => {
      setIsDark(dark);
      applyTheme(dark);
      persistTheme(dark);
    },
    toggle: () => {
      setIsDark((current) => {
        const next = !current;
        applyTheme(next);
        persistTheme(next);
        return next;
      });
    }
  }), [isDark]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}

// Defaults to light mode when no explicit preference is stored yet, rather
// than falling back to the OS/browser color-scheme preference.
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var k='${THEME_STORAGE_KEY}',v=localStorage.getItem(k),d=v==='dark';document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}})()`;

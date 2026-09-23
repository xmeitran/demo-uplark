"use client";

import { useEffect } from "react";

const SHADOW_FONT_STYLE_ID = "uplark-app-shadow-font";
const SHADOW_FONT_CSS = `
  :host,
  :host *,
  * {
    font-family: var(--font-sans, var(--font-be-vietnam-pro, "Be Vietnam Pro"), "Be Vietnam Pro", sans-serif) !important;
    letter-spacing: 0;
  }
`;

function patchShadowRoot(shadowRoot: ShadowRoot) {
  if (shadowRoot.querySelector(`style[data-runtime="${SHADOW_FONT_STYLE_ID}"]`)) return;

  const style = document.createElement("style");
  style.dataset.runtime = SHADOW_FONT_STYLE_ID;
  style.textContent = SHADOW_FONT_CSS;
  shadowRoot.prepend(style);
}

function patchOpenShadowRoots(root: Document | ShadowRoot = document) {
  const elements = Array.from(root.querySelectorAll<Element>("*"));

  for (const element of elements) {
    const shadowRoot = element.shadowRoot;
    if (!shadowRoot) continue;

    patchShadowRoot(shadowRoot);
    patchOpenShadowRoots(shadowRoot);
  }
}

export function AppShadowFontRuntime() {
  useEffect(() => {
    let frame = 0;

    const schedulePatch = () => {
      if (frame) return;

      frame = window.requestAnimationFrame(() => {
        frame = 0;
        patchOpenShadowRoots();
      });
    };

    schedulePatch();

    const observer = new MutationObserver(schedulePatch);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return null;
}

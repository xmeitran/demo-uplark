import "./globals.css";
import type { Metadata } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import { AgentationDevTools } from "../src/components/agentation-dev-tools";
import { AppShadowFontRuntime } from "../src/components/app-shadow-font-runtime";
import { ShopifyRuntime } from "../src/components/shopify-runtime";
import { ClientProviders } from "../src/components/client-providers";
import { APP_DESCRIPTION, APP_LOGO_URL, APP_NAME } from "../src/components/app-brand";
import { THEME_BOOTSTRAP_SCRIPT } from "../src/lib/theme";

const beVietnamPro = Be_Vietnam_Pro({
  weight: ["400", "500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
  // Load only faces used by visible text instead of preloading every weight/style.
  preload: false,
  subsets: ["latin", "vietnamese"],
  display: "swap",
  variable: "--font-be-vietnam-pro"
});

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  icons: {
    icon: [{ url: APP_LOGO_URL, type: "image/avif" }],
    shortcut: [{ url: APP_LOGO_URL, type: "image/avif" }]
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={beVietnamPro.variable} lang="vi" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <ShopifyRuntime />
      </head>
      <body>
        <ClientProviders>
          {children}
        </ClientProviders>
        <AppShadowFontRuntime />
        <AgentationDevTools />
      </body>
    </html>
  );
}

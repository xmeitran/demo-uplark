/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@b2b-crm/contracts", "@b2b-crm/ui-tokens"],
  async headers() {
    return [
      {
        source: "/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate"
          },
          {
            key: "CDN-Cache-Control",
            value: "no-store"
          },
          {
            key: "Surrogate-Control",
            value: "no-store"
          },
          {
            key: "Alt-Svc",
            value: "clear"
          },
          {
            key: "Pragma",
            value: "no-cache"
          },
          {
            key: "Expires",
            value: "0"
          }
        ]
      }
    ];
  }
};

export default nextConfig;

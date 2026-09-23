export const APP_NAME = "UpLark Partner CRM";
export const APP_DESCRIPTION = "UpLark Partner CRM operations workspace";
export const APP_LOGO_URL =
  "https://cdn.prod.website-files.com/67d77474ac7150f21af5ec99/67e79517a0b57d64bc5f086d_UB1%201.avif";

type AppBrandLogoProps = Readonly<{
  className?: string;
  compact?: boolean;
}>;

export function AppBrandLogo({ className = "", compact = false }: AppBrandLogoProps) {
  if (compact) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex shrink-0 overflow-hidden ${className}`.trim()}
      >
        <img
          alt=""
          className="h-full w-auto max-w-none shrink-0"
          decoding="async"
          height={48}
          src={APP_LOGO_URL}
          width={180}
        />
      </span>
    );
  }

  return (
    <img
      alt={`${APP_NAME} logo`}
      className={`block max-w-full ${className}`.trim()}
      decoding="async"
      height={48}
      src={APP_LOGO_URL}
      width={180}
    />
  );
}

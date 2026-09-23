export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// Keep /dashboard as a real route. The root dashboard is shared so deep links
// and sidebar navigation no longer perform a confusing 307 redirect to `/`.
export { default } from "../page";

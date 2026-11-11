/** Public address of this deployment and of its source. Set VITE_SITE_URL in Vercel once a custom domain is attached. */
export const SITE_URL = ((import.meta.env.VITE_SITE_URL as string | undefined) || "https://www.echoledger.fun").replace(/\/$/, "");
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, "");
export const REPO_URL = "https://github.com/nguyenkhangph/echo-ledger-ryo";

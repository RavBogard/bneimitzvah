import { iconResponse } from "../../lib/offline/icon";

// Safari looks for /apple-touch-icon.png at the root when no link names one (pwa-offline.md, Findings 4): opaque, 180 px.
export const dynamic = "force-static";
export function GET() { return iconResponse(180); }

import { iconResponse } from "../../lib/offline/icon";

// The yad as the favicon for browsers that ask for /favicon.ico; pages also link /icon.svg.
export const dynamic = "force-static";
export function GET() { return iconResponse(48); }

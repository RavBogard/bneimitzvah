import { ICON_SIZES, iconResponse, type IconName } from "../../../lib/offline/icon";

export const dynamic = "force-static";
export const dynamicParams = false;
export function generateStaticParams() { return Object.keys(ICON_SIZES).map(name => ({ name })); }

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const name = (await params).name;
  if (!Object.hasOwn(ICON_SIZES, name)) return new Response(null, { status: 404 });
  return iconResponse(ICON_SIZES[name as IconName]);
}

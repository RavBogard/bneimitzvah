import { redirect } from "next/navigation";

/**
 * The student's home is the shelf now (Readings for everyone E2). An old address that named a view of the reading (?tab=reading, service or
 * lessons) goes to that part of /mine/reading, so a saved link still lands where it did.
 */
const VIEWS: Record<string, string> = { reading: "/mine/reading", service: "/mine/reading#service-parts", lessons: "/mine/reading#lessons" };
export default async function StudentRedirect({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { tab } = await searchParams;
  redirect(typeof tab === "string" && Object.hasOwn(VIEWS, tab) ? VIEWS[tab] : "/mine");
}

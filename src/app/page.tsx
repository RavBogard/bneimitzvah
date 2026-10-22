import type { Metadata } from "next";
import { PortalEntry } from "../components/portal/entry";
import { publicSignInBoundary, type EntryQuery } from "../components/portal/sign-in-boundary";

type Props = { searchParams: Promise<EntryQuery> };
const HOME_DESCRIPTION = "Lein, learn to lein, and study the weekly Torah and haftarah at Central Reform Congregation";
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return { title: "CRC Torah", description: HOME_DESCRIPTION, referrer: publicSignInBoundary(await searchParams, "home").referrer };
}
export default async function Home({ searchParams }: Props) {
  const boundary = publicSignInBoundary(await searchParams, "home");
  return <PortalEntry inlineGoogle={boundary.inlineGoogle} frontDoor />;
}

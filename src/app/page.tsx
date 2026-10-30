import type { Metadata } from "next";
import { resolveIdentity } from "../lib/site/identity";
import { PortalEntry } from "../components/portal/entry";
import { publicSignInBoundary, type EntryQuery } from "../components/portal/sign-in-boundary";

type Props = { searchParams: Promise<EntryQuery> };
const homeDescription = (name: string) => `Lein, learn to lein, and study the weekly Torah and haftarah at ${name}`;
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const identity = resolveIdentity();
  return { title: identity.productName, description: homeDescription(identity.name), referrer: publicSignInBoundary(await searchParams, "home").referrer };
}
export default async function Home({ searchParams }: Props) {
  const boundary = publicSignInBoundary(await searchParams, "home");
  return <PortalEntry inlineGoogle={boundary.inlineGoogle} frontDoor />;
}

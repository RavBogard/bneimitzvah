import { PortalEntry } from "../components/portal/entry";
import { publicSignInBoundary, type EntryQuery } from "../components/portal/sign-in-boundary";

type Props = { searchParams: Promise<EntryQuery> };
export async function generateMetadata({ searchParams }: Props) { return { referrer: publicSignInBoundary(await searchParams, "home").referrer }; }
export default async function Home({ searchParams }: Props) {
  const boundary = publicSignInBoundary(await searchParams, "home");
  return <PortalEntry inlineGoogle={boundary.inlineGoogle} />;
}

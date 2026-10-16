import { PortalEntry } from "../../components/portal/entry";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const query = await searchParams;
  return <PortalEntry authenticationError={query.error === "authentication"} />;
}

import { PortalEntry } from "../../components/portal/entry";
import { signedInTitle } from "../../lib/site/signed-in-title";
import { publicSignInBoundary, type EntryQuery } from "../../components/portal/sign-in-boundary";

type Props = { searchParams: Promise<EntryQuery> };
export async function generateMetadata({ searchParams }: Props) { return { title: signedInTitle("Sign in"), referrer: publicSignInBoundary(await searchParams, "sign-in").referrer }; }
export default async function SignInPage({ searchParams }: Props) {
  const boundary = publicSignInBoundary(await searchParams, "sign-in");
  return <PortalEntry authenticationError={boundary.authenticationError} inlineGoogle={boundary.inlineGoogle} googleIntent={boundary.intent} returnTo={boundary.back} />;
}

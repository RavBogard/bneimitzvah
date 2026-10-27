import { RedirectTo } from "../../../components/portal/shell/redirect-to";
import { MINE_HREF } from "../../../components/portal/shell/role-home";
import type { Metadata } from "next";
import { signedInTitle } from "../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Your children’s readings") };

export default function ParentPage() { return <RedirectTo href={MINE_HREF} />; }

import { RedirectTo } from "../../../components/portal/shell/redirect-to";
import { MINE_HREF } from "../../../components/portal/shell/role-home";
import type { Metadata } from "next";
import { signedInTitle } from "../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Your assigned reading") };

export default function StudentPage() { return <RedirectTo href={MINE_HREF} />; }

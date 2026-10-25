import { RoleChoice } from "../../components/portal/workspace/students";
import type { Metadata } from "next";
import { signedInTitle } from "../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Choose your workspace") };

export default function WorkspacePage() { return <RoleChoice />; }

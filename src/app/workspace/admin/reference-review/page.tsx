import { ReferenceReviewWorkspace } from "../../../../components/portal/workspace/reference-review/workspace";
import type { Metadata } from "next";
import { signedInTitle } from "../../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Recording review") };
export default function ReferenceReviewPage() { return <ReferenceReviewWorkspace />; }

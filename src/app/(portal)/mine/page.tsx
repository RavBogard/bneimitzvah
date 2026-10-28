import type { Metadata } from "next";
import { Shelf } from "../../../components/portal/mine/shelf";
import { signedInTitle } from "../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("My Readings") };

export default function MinePage() { return <Shelf />; }

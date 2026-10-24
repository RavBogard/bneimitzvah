import type { ReactNode } from "react";
import { PageViewBeacon } from "../../components/site/page-view-beacon";

// A public layout: the page-view counter's beacon ("path and day only") is mounted here and in the other public layouts only.
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <>{children}<PageViewBeacon /></>;
}

import type { ReactNode } from "react";
import { ChildPracticeLearn } from "../../components/learn/child-practice";
import { PersonalLearningBoundary } from "../../components/learn/scoped-learning";
import { ChildProgressGate } from "../../components/learn/child-progress-gate";
import { PageViewBeacon } from "../../components/site/page-view-beacon";

// A public layout: the page-view counter's beacon ("path and day only") is mounted here and in the other public layouts only.
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <><ChildPracticeLearn><PersonalLearningBoundary><ChildProgressGate>{children}</ChildProgressGate></PersonalLearningBoundary></ChildPracticeLearn><PageViewBeacon /></>;
}

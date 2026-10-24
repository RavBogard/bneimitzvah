"use client";
import { localDay, reviewSummary } from "../../lib/learn/progress";
import { reviewLine } from "../../lib/learn/review-line";
import { WorkspaceLink } from "../portal/workspace/provider";
import { useProgress } from "./services";

/**
 * The student workspace's way into the course: Learn to lein, and the course's own review line (the same one its home
 * shows, from the same progress, this device's or the account's) when any phrases are due.
 */
export function LearnHeroActions() {
  const { progress, until } = useProgress();
  const review = progress ? reviewSummary(progress, localDay(Date.now()), until) : null;
  return <>
    <WorkspaceLink className="button-hero-secondary" href="/learn">Learn to lein</WorkspaceLink>
    {review && <WorkspaceLink className="button-hero-secondary" href="/learn/review">{reviewLine(review)}</WorkspaceLink>}
  </>;
}

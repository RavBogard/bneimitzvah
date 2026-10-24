"use client";
import { localDay, reviewSummary } from "../../lib/learn/progress";
import { reviewLine } from "../../lib/learn/review-line";
import { WorkspaceLink } from "../portal/workspace/provider";
import { useProgress } from "./services";

/**
 * The course review line on the student hero (the same one the course home shows, from the same progress, this
 * device or the account) when any phrases are due; nothing otherwise. Learn to lein itself is in the app bar,
 * where it takes no height from the first screen of the reading.
 */
export function LearnReviewAction() {
  const { progress, until } = useProgress();
  const review = progress ? reviewSummary(progress, localDay(Date.now()), until) : null;
  return review ? <WorkspaceLink className="button-hero-secondary" href="/learn/review">{reviewLine(review)}</WorkspaceLink> : null;
}

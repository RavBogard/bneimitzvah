import { expect, it } from "vitest";
import { reviewLine } from "../../src/lib/learn/review-line";

it("words the review line the one way the course home and the student workspace both show it", () => {
  expect(reviewLine({ phrases: 1, minutes: 1 })).toBe("Review: 1 phrase, about 1 minute");
  expect(reviewLine({ phrases: 5, minutes: 2 })).toBe("Review: 5 phrases, about 2 minutes");
});

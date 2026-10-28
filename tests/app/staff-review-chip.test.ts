import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { StaffStudentLines } from "../../src/components/portal/workspace/staff/student-lines";

const reading = (kind: "torah" | "haftarah", needsReview: boolean) => ({ id: kind, kind, needsReview, ranges: [], verses: [] });
const render = (readings: ReturnType<typeof reading>[]) => renderToStaticMarkup(createElement(StaffStudentLines, { mode: "tutor", baseline: { student: { id: "s1", firstName: "Noa" }, readings } as never }));

it("says a student's readings need review once, however many do", () => {
  const markup = render([reading("torah", true), reading("haftarah", true)]);
  expect(markup.match(/data-testid="reading-review"/g)).toHaveLength(1);
  expect(markup.match(/roster-chip/g)).toHaveLength(1);
  expect(render([reading("torah", false), reading("haftarah", false)])).toBe("");
});

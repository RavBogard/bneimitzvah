import { expect, test } from "vitest";
import { guideLabelText } from "../../src/components/portal/workspace/study/guide-card";

test("the label says who wrote it and whether the rabbi reviewed it", () => {
  expect(guideLabelText({ origin: "claude", reviewed: false, rabbiName: "the rabbi" })).toBe("Written by Claude for CRC · not yet reviewed by the rabbi");
  expect(guideLabelText({ origin: "rabbi", reviewed: false, rabbiName: "Rabbi Daniel" })).toBe("Written by Rabbi Daniel · draft");
  expect(guideLabelText({ origin: "claude", reviewed: true, rabbiName: "Rabbi Daniel" })).toBe("Reviewed by Rabbi Daniel");
  expect(guideLabelText({ origin: "rabbi", reviewed: true, rabbiName: "Rabbi Daniel" })).toBe("Reviewed by Rabbi Daniel");
});

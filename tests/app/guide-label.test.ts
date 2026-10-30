import { expect, test } from "vitest";
import { guideLabelText } from "../../src/components/portal/workspace/study/guide-card";

test("the label says who wrote it and whether the rabbi reviewed it", () => {
  expect(guideLabelText({ origin: "claude", reviewed: false, rabbiName: "the rabbi" })).toBe("Written by Claude for CRC · not yet reviewed by the rabbi");
  expect(guideLabelText({ origin: "rabbi", reviewed: false, rabbiName: "Rabbi Daniel" })).toBe("Written by Rabbi Daniel · draft");
  expect(guideLabelText({ origin: "claude", reviewed: true, rabbiName: "Rabbi Daniel" })).toBe("Reviewed by Rabbi Daniel");
  expect(guideLabelText({ origin: "rabbi", reviewed: true, rabbiName: "Rabbi Daniel" })).toBe("Reviewed by Rabbi Daniel");
});

test("an imported guide keeps its original author's credit beside the review state, and a guide written here carries none", () => {
  expect(guideLabelText({ origin: "rabbi", reviewed: false, rabbiName: "Rabbi Kipnes", importedFrom: "Rabbi Daniel Bogard" })).toBe("Written by Rabbi Daniel Bogard · draft");
  expect(guideLabelText({ origin: "claude", reviewed: false, rabbiName: "Rabbi Kipnes", importedFrom: "Rabbi Daniel Bogard" })).toBe("Written by Rabbi Daniel Bogard · draft");
  expect(guideLabelText({ origin: "claude", reviewed: true, rabbiName: "Rabbi Kipnes", importedFrom: "Rabbi Daniel Bogard" })).toBe("Reviewed by Rabbi Kipnes · From Rabbi Daniel Bogard");
  expect(guideLabelText({ origin: "claude", reviewed: true, rabbiName: "Rabbi Kipnes" })).not.toContain("From");
});

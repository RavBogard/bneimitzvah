import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ReferenceReviewCredits } from "../../src/components/portal/workspace/reference-review/workspace";
import { studyEditions } from "../../src/components/portal/workspace/study/credits";

test("private review credits the teaching collection and exact MAM edition with safe static source and license links", () => {
  const markup = renderToStaticMarkup(createElement(ReferenceReviewCredits)), edition = studyEditions.mam;
  const fragment = parseFragment(markup), anchors: DefaultTreeAdapterMap["element"][] = [];
  let text = "";
  function visit(node: DefaultTreeAdapterMap["node"]) {
    if (node.nodeName === "#text") text += (node as DefaultTreeAdapterMap["textNode"]).value;
    if ("tagName" in node && node.tagName === "a") anchors.push(node);
    if ("childNodes" in node) node.childNodes.forEach(visit);
  }
  visit(fragment);
  for (const credit of ["Teaching collection shared by Cantor Josh Finkel.", edition.versionTitle, edition.creator, edition.license, edition.changes]) expect(text).toContain(credit);
  expect(text).not.toContain(studyEditions.jps2023.versionTitle); expect(text).not.toContain(studyEditions.jps2023.license);
  expect(text).not.toMatch(/Performed by|Sung by|Recorded by/);
  expect(anchors).toHaveLength(2);
  expect(anchors.map(node => new URL(node.attrs.find(attr => attr.name === "href")!.value).href)).toEqual([edition.sourceUrl, edition.licenseUrl].map(url => new URL(url).href));
  for (const node of anchors) {
    expect(new URL(node.attrs.find(attr => attr.name === "href")!.value).protocol).toBe("https:");
    expect(node.attrs.find(attr => attr.name === "target")?.value).toBe("_blank");
    expect(node.attrs.find(attr => attr.name === "rel")?.value.split(/\s+/).sort()).toEqual(["noopener", "noreferrer"]);
  }
});

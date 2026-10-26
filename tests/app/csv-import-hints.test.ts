import { describe, expect, it } from "vitest";
import { CSV_ADULT_HEADER, CSV_FULL_ADULT_HEADER, CSV_FULL_HEADER, CSV_HEADER } from "../../src/components/portal/workspace/csv-import/api";
import { CSV_EXAMPLE_ROW, CSV_TEMPLATE, csvRecords, dataRowNumbers, draftProblem, rowHints, rowList, sameNameAndDateRows, splitDraft } from "../../src/components/portal/workspace/csv-import/hints";

describe("CSV import explanations", () => {
  it("splits quoted commas and line breaks like the server and refuses broken quoting", () => {
    expect(csvRecords('a,"b, c"\r\n"d\ne",f')).toEqual([["a", "b, c"], ["d\ne", "f"]]);
    expect(csvRecords('a,"b')).toBeNull(); expect(csvRecords('a,"b"c')).toBeNull();
  });

  it("explains a draft that cannot be previewed before anything is sent", () => {
    expect(draftProblem(`${CSV_HEADER}\nSynthetic,Row,2027-01-02,parent@example.test,`)).toBeNull();
    expect(draftProblem(`${CSV_FULL_ADULT_HEADER}\nadult,Synthetic,Row,2027-01-02,,adult@example.test,unknown,,,,,,,,`)).toBeNull();
    // G21: the template carries one example line, and a draft that still holds it is refused before anything is sent.
    expect(CSV_TEMPLATE.split("\r\n")[1]).toBe(CSV_EXAMPLE_ROW);
    expect(csvRecords(CSV_TEMPLATE)![1]).toHaveLength(CSV_FULL_ADULT_HEADER.split(",").length);
    expect(draftProblem(CSV_TEMPLATE)).toMatch(/example line/);
    expect(draftProblem(CSV_TEMPLATE + "adult,Synthetic,Row,2027-01-02,,adult@example.test,unknown,,,,,,,,")).toMatch(/example line/);
    expect(draftProblem("first,last\nSynthetic,Row")).toMatch(/^The first line must be the column names/);
    expect(draftProblem(`﻿${CSV_HEADER}\nSynthetic,Row,2027-01-02,parent@example.test,`)).toMatch(/byte-order mark/);
    expect(draftProblem(`${CSV_HEADER}\n`)).toBe("Add at least one student below the column names.");
    expect(draftProblem(`${CSV_HEADER}\n"Synthetic,Row`)).toMatch(/quoted value/);
  });

  it("names the columns to fix without echoing their values", () => {
    const hints = rowHints([CSV_ADULT_HEADER,
      "child,Synthetic,Fine,2027-01-02,parent@example.test,",
      "teen,Synthetic,Kind,2027-02-30,parent@example.test,",
      "child,,Name,2027-01-02,,",
      "adult,Synthetic,Same,2027-01-02,same@example.test,same@example.test",
      "child,Synthetic,Short",
    ].join("\n"));
    expect(hints.has(2)).toBe(false);
    expect(hints.get(3)).toBe("check the student kind (child or adult) and ceremony date (YYYY-MM-DD, for example 2027-05-08).");
    expect(hints.get(4)).toBe("check the first name and parent email.");
    expect(hints.get(5)).toBe("check the student email, which must be different from the parent emails.");
    expect(hints.get(6)).toMatch(/^this line has 3 columns, but the column names have 6\./);
    expect([...hints.values()].join(" ")).not.toContain("example.test");
  });

  it("checks the full layout's service slot and optional contacts", () => {
    const row = (slot: string, second: string) => `Synthetic,Full,2027-01-02,parent@example.test,,${slot},,,,,,${second},,`;
    const hints = rowHints([CSV_FULL_HEADER, row("morning", ""), row("afternoon", "not-an-email"), row("", ""), row("  ", "")].join("\n"));
    expect(hints.has(2)).toBe(false);
    expect(hints.get(3)).toBe("check the service slot (morning, havdalah or unknown) and second parent email.");
    // A blank slot is allowed: it imports as unknown.
    expect(hints.has(4)).toBe(false);
    expect(hints.has(5)).toBe(false);
  });
});

describe("G21: importing the ready rows and the same-name warning", () => {
  const draft = [CSV_HEADER,
    "Synthetic,Ready,2027-01-02,parent@example.test,",
    "Synthetic,Broken,not-a-date,parent@example.test,",
    "\"Synthetic, Quoted\",Ready,2027-01-03,parent@example.test,",
    "",
    "Synthetic,Short",
  ].join("\r\n");

  it("splits a draft by spreadsheet row into the rows to import and the rows left to fix, re-quoting cells the server reads the same", () => {
    expect(dataRowNumbers(draft)).toEqual([2, 3, 4, 5, 6]);
    const parts = splitDraft(draft, new Set([2, 4]))!;
    expect(parts.readyCount).toBe(2);
    expect(csvRecords(parts.ready)).toEqual([CSV_HEADER.split(","), ["Synthetic", "Ready", "2027-01-02", "parent@example.test", ""], ["Synthetic, Quoted", "Ready", "2027-01-03", "parent@example.test", ""]]);
    // The rows to fix keep the column names; the blank line is dropped.
    expect(csvRecords(parts.rest)).toEqual([CSV_HEADER.split(","), ["Synthetic", "Broken", "not-a-date", "parent@example.test", ""], ["Synthetic", "Short"]]);
    expect(draftProblem(parts.ready)).toBeNull();
    expect(splitDraft(draft, new Set([2, 3, 4, 6]))!.rest).toBe("");
    expect(splitDraft("a,\"b", new Set([2]))).toBeNull();
  });

  it("warns on the same name and ceremony date as the roster or an earlier row, ignoring case and spacing, and skips rows the server reports", () => {
    const rows = [CSV_HEADER,
      "Noa,Synthetic,2027-05-08,a@example.test,",
      "noa , synthetic,2027-05-08,b@example.test,",
      "Ari,Example,2027-06-12,c@example.test,",
      "Ari,Example,2027-06-19,d@example.test,",
      "Dan,Example,2027-07-10,e@example.test,",
    ].join("\n");
    const roster = [{ firstName: "Dan", lastName: "Example", ceremonyDate: "2027-07-10" }];
    expect(sameNameAndDateRows(rows, roster, new Set())).toEqual([3, 6]);
    expect(sameNameAndDateRows(rows, roster, new Set([3]))).toEqual([6]);
    expect(sameNameAndDateRows(rows, [], new Set())).toEqual([3]);
    expect(rowList([3])).toBe("Row 3");
    expect(rowList([3, 6, 9])).toBe("Rows 3, 6 and 9");
  });
});

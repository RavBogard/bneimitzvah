import { describe, expect, it } from "vitest";
import { CSV_ADULT_HEADER, CSV_FULL_HEADER, CSV_HEADER } from "../../src/components/portal/workspace/csv-import/api";
import { CSV_TEMPLATE, csvRecords, draftProblem, rowHints } from "../../src/components/portal/workspace/csv-import/hints";

describe("CSV import explanations", () => {
  it("splits quoted commas and line breaks like the server and refuses broken quoting", () => {
    expect(csvRecords('a,"b, c"\r\n"d\ne",f')).toEqual([["a", "b, c"], ["d\ne", "f"]]);
    expect(csvRecords('a,"b')).toBeNull(); expect(csvRecords('a,"b"c')).toBeNull();
  });

  it("explains a draft that cannot be previewed before anything is sent", () => {
    expect(draftProblem(`${CSV_HEADER}\nSynthetic,Row,2027-01-02,parent@example.test,`)).toBeNull();
    expect(draftProblem(CSV_TEMPLATE + "adult,Synthetic,Row,2027-01-02,,adult@example.test,unknown,,,,,,,,")).toBeNull();
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
    const hints = rowHints([CSV_FULL_HEADER, row("morning", ""), row("", "not-an-email")].join("\n"));
    expect(hints.has(2)).toBe(false);
    expect(hints.get(3)).toBe("check the service slot (morning, havdalah or unknown) and second parent email.");
  });
});

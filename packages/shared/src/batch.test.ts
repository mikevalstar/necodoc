import { describe, expect, it } from "vitest";
import { batchStatus, csvToRows, defaultCsvMapping, parseCsv, toCsv } from "./batch";
import { type FieldSection, fieldSectionsSchema } from "./fields";

const sections: FieldSection[] = fieldSectionsSchema.parse([
  {
    title: "Policy",
    fields: [
      { type: "text", key: "client_name", label: "Client" },
      { type: "number", key: "amount", label: "Amount" },
      { type: "boolean", key: "renewal", label: "Renewal" },
      {
        type: "choice",
        key: "coverages",
        label: "Coverages",
        multiple: true,
        options: [
          { value: "fire", label: "Fire" },
          { value: "flood", label: "Flood" },
        ],
      },
      {
        type: "group",
        key: "items",
        label: "Items",
        fields: [
          { type: "text", key: "name", label: "Name" },
          { type: "number", key: "qty", label: "Qty" },
        ],
      },
    ],
  },
]);

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, embedded newlines, CRLF, a BOM and blank lines", () => {
    const text = '﻿name,note\r\n"Smith, J","said ""hi""\nthen left"\r\n\r\nLee,\n';
    expect(parseCsv(text)).toEqual([
      ["name", "note"],
      ["Smith, J", 'said "hi"\nthen left'],
      ["Lee", ""],
    ]);
  });

  it("round-trips through toCsv", () => {
    const rows = [
      ["a", "b,c"],
      ['say "x"', "line\nbreak"],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe("defaultCsvMapping", () => {
  it("maps columns named like field paths, with group.key meaning the first item", () => {
    expect(
      defaultCsvMapping(
        ["client_name", "items.name", "items.0.qty", "items.3.qty", "items.1.nope", "unknown"],
        sections,
      ),
    ).toEqual({
      client_name: "client_name",
      "items.name": "items.0.name",
      "items.0.qty": "items.0.qty",
      "items.3.qty": "items.3.qty",
    });
  });
});

describe("csvToRows", () => {
  it("coerces cells by field type and fills group items by index", () => {
    const csv = parseCsv(
      [
        "Client,Amt,Renew,Cov,Item 1,Qty 1,Item 2,Qty 2",
        "Ada,12.5,yes,fire; flood,Desk,2,Lamp,1",
        "Bob,lots,no,,,,Chair,4",
      ].join("\n"),
    );
    const mapping = {
      Client: "client_name",
      Amt: "amount",
      Renew: "renewal",
      Cov: "coverages",
      "Item 1": "items.0.name",
      "Qty 1": "items.0.qty",
      "Item 2": "items.1.name",
      "Qty 2": "items.1.qty",
    };
    expect(csvToRows(csv, mapping, sections)).toEqual([
      {
        client_name: "Ada",
        amount: 12.5,
        renewal: true,
        coverages: ["fire", "flood"],
        items: [
          { name: "Desk", qty: 2 },
          { name: "Lamp", qty: 1 },
        ],
      },
      // "lots" stays a string so validation reports it; empty cells are left out.
      { client_name: "Bob", amount: "lots", renewal: false, items: [{ name: "Chair", qty: 4 }] },
    ]);
  });

  it("ignores unmapped columns", () => {
    expect(
      csvToRows(
        [
          ["a", "b"],
          ["1", "2"],
        ],
        { b: "client_name" },
        sections,
      ),
    ).toEqual([{ client_name: "2" }]);
  });
});

describe("batchStatus", () => {
  const counts = { total: 3, done: 1, failed: 1, cancelled: 0 };
  it("is running until every row has finished", () => {
    expect(batchStatus({ ...counts, cancelledAt: null })).toBe("running");
    expect(batchStatus({ ...counts, done: 2, cancelledAt: null })).toBe("completed");
  });
  it("is cancelled once cancelled, whatever is still running", () => {
    expect(batchStatus({ ...counts, cancelledAt: new Date() })).toBe("cancelled");
  });
});

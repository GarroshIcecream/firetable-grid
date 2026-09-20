import { describe, expect, test } from "bun:test";

import {
  buildFlatItemsFromServerGroups,
  EMPTY_GROUP_KEY,
  type GroupValueFn,
} from "../src/layout";

// A custom resolver: the raw value is a 1-5 score, displayed as a word. The
// sortKey must stay the stringified score, because that is what the server
// groups by.
const scoreGroupValue: GroupValueFn = (raw) => {
  if (raw == null || raw === "") {
    return { sortKey: EMPTY_GROUP_KEY, label: EMPTY_GROUP_KEY };
  }
  const score = Number(raw);
  if (Number.isNaN(score)) return { sortKey: String(raw), label: String(raw) };
  return { sortKey: String(score), label: score <= 2 ? "Low" : "High" };
};

const row = (transmission: string | null) => ({ original: { transmission } });

describe("buildFlatItemsFromServerGroups", () => {
  const serverGroups = [
    { value: "TRANSMISSION_AUTOMATIC", count: 5819 },
    { value: "TRANSMISSION_MANUAL", count: 2600 },
    { value: null, count: 103 },
  ];

  test("every server group renders a header even before its rows load", () => {
    const rows = [row("TRANSMISSION_AUTOMATIC"), row("TRANSMISSION_AUTOMATIC")];
    const items = buildFlatItemsFromServerGroups(
      rows,
      "transmission",
      serverGroups,
    );

    const headers = items.filter((i) => i.type === "group-header");
    expect(
      headers.map((h) => (h.type === "group-header" ? h.key : "")),
    ).toEqual([
      "TRANSMISSION_AUTOMATIC",
      "TRANSMISSION_MANUAL",
      EMPTY_GROUP_KEY,
    ]);
    expect(
      headers.map((h) => (h.type === "group-header" ? h.count : 0)),
    ).toEqual([5819, 2600, 103]);
    expect(items.filter((i) => i.type === "row")).toHaveLength(2);
  });

  test("rows slot under their group in server order", () => {
    const rows = [
      row("TRANSMISSION_AUTOMATIC"),
      row("TRANSMISSION_MANUAL"),
      row(null),
    ];
    const items = buildFlatItemsFromServerGroups(
      rows,
      "transmission",
      serverGroups,
    );
    expect(
      items.map((i) =>
        i.type === "group-header" ? `H:${i.key}` : `R:${i.rowIndex}`,
      ),
    ).toEqual([
      "H:TRANSMISSION_AUTOMATIC",
      "R:0",
      "H:TRANSMISSION_MANUAL",
      "R:1",
      `H:${EMPTY_GROUP_KEY}`,
      "R:2",
    ]);
  });

  test("collapsed groups keep their header and drop their rows", () => {
    const rows = [row("TRANSMISSION_AUTOMATIC"), row("TRANSMISSION_MANUAL")];
    const items = buildFlatItemsFromServerGroups(
      rows,
      "transmission",
      serverGroups,
      new Set(["TRANSMISSION_AUTOMATIC"]),
    );
    expect(
      items.map((i) =>
        i.type === "group-header" ? `H:${i.key}` : `R:${i.rowIndex}`,
      ),
    ).toEqual([
      "H:TRANSMISSION_AUTOMATIC",
      "H:TRANSMISSION_MANUAL",
      "R:1",
      `H:${EMPTY_GROUP_KEY}`,
    ]);
  });

  test("rows outside the server list are appended, not dropped", () => {
    const rows = [row("TRANSMISSION_SEMI")];
    const items = buildFlatItemsFromServerGroups(
      rows,
      "transmission",
      serverGroups,
    );
    const last = items.at(-2);
    expect(last).toEqual({
      type: "group-header",
      key: "TRANSMISSION_SEMI",
      label: "TRANSMISSION_SEMI",
      count: 1,
    });
    expect(items.at(-1)).toEqual({ type: "row", rowIndex: 0 });
  });

  test("server catalogue labels do not depend on a loaded row", () => {
    const items = buildFlatItemsFromServerGroups([], "make", [
      { value: "MAKE_ABARTH", label: "Abarth", count: 42 },
    ]);

    expect(items).toEqual([
      {
        type: "group-header",
        key: "MAKE_ABARTH",
        label: "Abarth",
        count: 42,
      },
    ]);
  });

  // A custom resolver reshapes the raw value into its own group key; if that
  // key stops matching what the server groups by, the rows bucket apart from
  // the server groups and every value renders a second header.
  test("a custom resolver must key on the server's group values", () => {
    const ratingRows = [1, 5, 5].map((score) => ({
      original: { score },
    }));
    const items = buildFlatItemsFromServerGroups(
      ratingRows,
      "score",
      [
        { value: "5", count: 390 },
        { value: "1", count: 33 },
      ],
      undefined,
      scoreGroupValue,
    );

    expect(
      items.map((i) =>
        i.type === "group-header" ? `H:${i.key}:${i.count}` : `R:${i.rowIndex}`,
      ),
    ).toEqual(["H:5:390", "R:1", "R:2", "H:1:33", "R:0"]);
  });
});

import { describe, expect, test } from "bun:test";

import { buildFooterAggregateQuery } from "../src";

const columns = [
  { id: "price", type: { aggregatable: true } },
  { id: "margin", type: { aggregatable: true } },
  { id: "make", type: { aggregatable: false } },
] as const;

describe("footer aggregate query", () => {
  test("keeps the aggregate request disabled before a calculation is selected", () => {
    const query = buildFooterAggregateQuery({}, columns, {});

    expect(query).toEqual({ enabled: false, metrics: [] });
  });

  test("requests only the calculation explicitly selected by the user", () => {
    const query = buildFooterAggregateQuery({ margin: "sum" }, columns, {});

    expect(query).toEqual({
      enabled: true,
      metrics: [
        {
          id: "footer:margin",
          kind: "sum",
          field: "margin",
          scope: "visible",
        },
      ],
    });
  });

  test("drops a selection whose column the user has since hidden", () => {
    const query = buildFooterAggregateQuery({ margin: "sum" }, columns, {
      margin: false,
    });

    expect(query).toEqual({ enabled: false, metrics: [] });
  });

  test("never requests a non-aggregatable column", () => {
    const query = buildFooterAggregateQuery(
      { make: "count", price: "avg" },
      columns,
      {},
    );

    expect(query.metrics.map((metric) => metric.field)).toEqual(["price"]);
  });
});

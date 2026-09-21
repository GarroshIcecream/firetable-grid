// The demo renders the package's own <DataGrid>. Column resizing is on because
// the component defaults it on; reordering is behind the toolbar's toggle,
// which is the `reorderable` prop — the opt-in.
//
// The panel on the right prints the engine's state next to the table it made.

import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  type AggregationType,
  all,
  applyView,
  buildCsvString,
  buildExportFilename,
  buildVisibility,
  type CategoryResolver,
  countConditions,
  emptyGridView,
  type FilterCondition,
  type FilterNode,
  type FilterOp,
  type GridView,
  isColumnVisible,
  resolveThresholdColor,
  type SchemaColumn,
  selectExportColumns,
  thresholdClasses,
  where,
} from "../src";
import { buildColumnLayout, buildFlatItems } from "../src/layout";
import { DataGrid } from "../src/react";
import { buildColumns, buildRows, type Item } from "./data";

const ROW_COUNTS = [28, 1_000, 20_000, 100_000] as const;
const ROW_HEIGHT = 36;
const columns = buildColumns();
const byId = new Map(columns.map((c) => [c.id, c]));
const nf = (o?: Intl.NumberFormatOptions) => new Intl.NumberFormat("en-GB", o);
const formatter = {
  number: (v: number, o?: Intl.NumberFormatOptions) => nf(o).format(v),
};

// Two buckets, so the demo can show a reorder drag being refused across a
// boundary as well as accepted within one.
const CATEGORY: Record<string, string> = {
  rowIndex: "identity",
  name: "identity",
  sku: "identity",
  category: "facts",
  supplier: "facts",
  addedOn: "facts",
  warehouse: "facts",
  status: "facts",
  lastCountedOn: "facts",
  price: "metrics",
  daysInStock: "metrics",
  marginTrend: "metrics",
  quality: "metrics",
  unitsOnHand: "metrics",
  reorderPoint: "metrics",
  leadTimeDays: "metrics",
  returnsRate: "metrics",
  weightKg: "metrics",
};
const categoryOf: CategoryResolver = (id) => CATEGORY[id];

function tone(column: SchemaColumn<Item>, value: number): string {
  if (!column.thresholds) return "";
  return thresholdClasses(resolveThresholdColor(value, column.thresholds));
}

function Cell({ column, row }: { column: SchemaColumn<Item>; row: Item }) {
  const raw = (row as unknown as Record<string, unknown>)[column.id];
  switch (column.type.cellRenderer) {
    case "genericBadge":
      return <span className="badge">{String(raw ?? "")}</span>;
    case "currency": {
      const v = Number(raw);
      return (
        <span className={`pill ${tone(column, v)}`}>
          {column.type.formatPrefix}
          {nf({ maximumFractionDigits: 0 }).format(v)}
        </span>
      );
    }
    case "daysBadge": {
      const v = Number(raw);
      return (
        <span className={`pill ${tone(column, v)}`}>
          {v}
          {column.type.formatSuffix}
        </span>
      );
    }
    case "trend": {
      const v = Number(raw);
      return (
        <span className="trend">
          <span className={`dot ${tone(column, v)}`} />
          <span>
            {v > 0 ? "▲" : v < 0 ? "▼" : "–"} {Math.abs(v).toFixed(1)} pp
          </span>
        </span>
      );
    }
    case "attentionProgress": {
      const v = Number(raw);
      return (
        <span className="progress">
          <span className="progress-track">
            <span
              className={`progress-fill ${tone(column, v)}`}
              style={{ width: `${Math.round(v * 100)}%` }}
            />
          </span>
          <span className="progress-label">{Math.round(v * 100)}%</span>
        </span>
      );
    }
    case "rawNumber":
      return <>{nf({ maximumFractionDigits: 0 }).format(Number(raw))}</>;
    case "decimal":
      return <>{nf({ minimumFractionDigits: 1 }).format(Number(raw))}</>;
    default:
      return <>{String(raw ?? "")}</>;
  }
}

// This demo's builder only ever produces a flat `all(...)`, so it can treat
// the filter as a list of conditions. A builder offering nested groups would
// walk the tree instead - the shape allows both.
function conditionsOf(filter: FilterNode | null): FilterCondition[] {
  if (filter === null) return [];
  if (filter.kind === "where") return [filter];
  return filter.of.filter((n): n is FilterCondition => n.kind === "where");
}

function withCondition(
  filter: FilterNode | null,
  condition: FilterCondition,
): FilterNode {
  return all(...conditionsOf(filter), condition);
}

function withoutConditionAt(
  filter: FilterNode | null,
  index: number,
): FilterNode | null {
  const kept = conditionsOf(filter).filter((_, i) => i !== index);
  return kept.length === 0 ? null : all(...kept);
}

function App() {
  // Search, filter, sort and grouping in one object - the same one the panel
  // on the right prints, and the same one a "save this view" button would
  // store verbatim.
  const [view, setView] = useState<GridView>(emptyGridView);
  const [wrapCells, setWrapCells] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(
    () => new Set(),
  );
  const [rowCount, setRowCount] = useState<number>(28);
  // Virtualization is opt-in, so the demo turns it on explicitly. Every row
  // must be the same height as every group header - `demo.css` pins both to
  // ROW_HEIGHT, which is the constraint the prop documents.
  const rows = useMemo(() => buildRows(rowCount), [rowCount]);
  const [reorderable, setReorderable] = useState(true);
  const [byCategory, setByCategory] = useState(false);

  // Draft filter-builder state
  const [field, setField] = useState(
    columns.find((c) => c.filterable)?.id ?? "",
  );
  const [op, setOp] = useState<FilterOp>("is");
  const [val, setVal] = useState("");

  // Order, widths and visibility are part of the view now - the panel on the
  // right prints all of it as the one object a saved view stores.
  const order = view.columns?.order ?? columns.map((c) => c.id);
  const sizes = view.columns?.sizes ?? {};
  const visibility = view.columns?.visibility ?? buildVisibility(columns);
  const patchColumns = (patch: Record<string, unknown>) =>
    setView((v) => ({ ...v, columns: { ...v.columns, ...patch } }));

  const filtered = useMemo(() => applyView(rows, view, columns), [rows, view]);
  const ordered = useMemo(
    () =>
      order
        .map((id) => byId.get(id))
        .filter((c): c is SchemaColumn<Item> => !!c),
    [order],
  );
  const layout = useMemo(
    () =>
      buildColumnLayout(
        ordered.map((c) => ({
          id: c.id,
          item: c,
          size: sizes[c.id] ?? c.width,
        })),
        ordered.filter((c) => c.frozen).map((c) => c.id),
      ),
    [ordered, sizes],
  );
  const groupField = view.group?.field ?? "";
  const conditions = conditionsOf(view.filter);
  const flatItems = useMemo(
    () =>
      buildFlatItems(
        filtered.map((original) => ({ original })),
        groupField,
        "asc",
      ),
    [filtered, groupField],
  );

  // One aggregation per aggregatable column, so the grid's own <tfoot> has
  // something to show. Previously the demo hand-rolled a footer strip below
  // the table because the component rendered none.
  const footerAggs = useMemo(() => {
    const out: Record<string, AggregationType> = {};
    for (const c of columns) if (c.type.aggregatable) out[c.id] = "avg";
    return out;
  }, []);

  const fieldColumn = byId.get(field);
  const addFilter = () => {
    if (!field || !op) return;
    setView((v) => ({
      ...v,
      filter: withCondition(v.filter, where(field, op, val)),
    }));
    setVal("");
  };

  const exportCsv = () => {
    // `selectExportColumns` reads the same visibility record the grid does, so
    // hiding a column drops it from the file too.
    const csv = buildCsvString(
      filtered,
      selectExportColumns(columns, order, visibility, filtered),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = buildExportFilename({
      prefix: "inventory",
      scope: groupField || null,
      ext: "csv",
    });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // One call now clears filter, sort, grouping AND the column layout.
  const reset = () => {
    setView(emptyGridView());
    setSelectedRows(new Set());
  };

  return (
    <main className="layout">
      <div className="left">
        <div className="toolbar">
          <label className="field">
            <span className="field-label">Search</span>
            <input
              type="search"
              placeholder="Search Item / SKU…"
              value={view.search}
              onChange={(e) =>
                setView((v) => ({ ...v, search: e.target.value }))
              }
            />
          </label>

          <label className="field">
            <span className="field-label">Rows</span>
            <select
              value={rowCount}
              onChange={(e) => {
                setRowCount(Number(e.target.value));
                setSelectedRows(new Set());
              }}
            >
              {ROW_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString("en-GB")}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">Group by</span>
            <select
              value={groupField}
              onChange={(e) =>
                setView((v) => ({
                  ...v,
                  group: e.target.value ? { field: e.target.value } : null,
                }))
              }
            >
              <option value="">No grouping</option>
              {columns
                .filter((c) => c.groupable)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
            </select>
          </label>

          <div className="field">
            <span className="field-label">Filter</span>
            <div className="builder">
              <select
                value={field}
                onChange={(e) => {
                  setField(e.target.value);
                  setOp(
                    (byId.get(e.target.value)?.operators?.[0] ??
                      "is") as FilterOp,
                  );
                }}
              >
                {columns
                  .filter((c) => c.filterable)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
              </select>
              <select
                value={op}
                onChange={(e) => setOp(e.target.value as FilterOp)}
              >
                {(fieldColumn?.operators ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <input
                placeholder="value"
                value={val}
                onChange={(e) => setVal(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addFilter()}
                list={fieldColumn?.filterOptions ? `o-${field}` : undefined}
              />
              {fieldColumn?.filterOptions ? (
                <datalist id={`o-${field}`}>
                  {fieldColumn.filterOptions.map((o) => (
                    <option key={o.value} value={o.value} />
                  ))}
                </datalist>
              ) : null}
              <button type="button" className="primary" onClick={addFilter}>
                Add
              </button>
            </div>
          </div>

          <label className="field">
            <span className="field-label">Drag to reorder</span>
            <input
              type="checkbox"
              checked={reorderable}
              onChange={(e) => setReorderable(e.target.checked)}
            />
          </label>

          <label className="field">
            <span className="field-label">Keep in category</span>
            <input
              type="checkbox"
              checked={byCategory}
              disabled={!reorderable}
              onChange={(e) => setByCategory(e.target.checked)}
            />
          </label>

          <label className="field">
            <span className="field-label">Wrap cells</span>
            <input
              type="checkbox"
              checked={wrapCells}
              onChange={(e) => setWrapCells(e.target.checked)}
            />
          </label>

          <div className="field">
            <span className="field-label">Columns</span>
            <div className="columns-menu">
              {columns
                .filter((c) => c.manageable)
                .map((c) => (
                  <label className="columns-item" key={c.id}>
                    <input
                      type="checkbox"
                      checked={isColumnVisible(c.id, visibility)}
                      onChange={(e) =>
                        patchColumns({
                          visibility: {
                            ...visibility,
                            [c.id]: e.target.checked,
                          },
                        })
                      }
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">&nbsp;</span>
            <div className="builder">
              <button type="button" onClick={exportCsv}>
                Export CSV
              </button>
              <button type="button" onClick={reset}>
                Reset
              </button>
            </div>
          </div>
        </div>

        <p className="hint">
          <strong>Scroll the table sideways</strong> — <em>#</em> and{" "}
          <em>Item</em> are frozen, so they stay put while the rest slides under
          them (that hairline is the frozen edge). Drag a{" "}
          <strong>header</strong> to reorder · drag a header's{" "}
          <strong>right edge</strong> to resize (or focus it and press ←/→) ·
          click a header to sort, <strong>shift-click</strong> a second header
          to sort by both (the small number is the sort rank). Frozen columns
          are excluded from reordering.
          {byCategory
            ? " Category mode is on: a column can only move within identity / facts / metrics."
            : ""}
        </p>

        <div className="chips">
          {conditions.length === 0 && !view.search ? (
            <span className="chips-empty">No filters — showing every row.</span>
          ) : null}
          {view.search ? (
            <span className="chip">search: “{view.search}”</span>
          ) : null}
          {conditions.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: two identical conditions are legal, so position is part of a chip's identity.
            <div className="chip" key={`${c.field}-${c.op}-${c.value}-${i}`}>
              <span>
                {byId.get(c.field)?.label ?? c.field} {c.op} {c.value}
              </span>
              <button
                type="button"
                className="chip-x"
                onClick={() =>
                  setView((v) => ({
                    ...v,
                    filter: withoutConditionAt(v.filter, i),
                  }))
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <DataGrid<Item>
          className="demo-grid"
          rows={rows}
          columns={columns}
          getRowId={(row) => row.sku}
          view={view}
          onViewChange={setView}
          virtualize={{ rowHeight: ROW_HEIGHT }}
          enableSelection
          selectedRowIds={selectedRows}
          onSelectionChange={setSelectedRows}
          footerAggregations={footerAggs}
          numberFormatter={formatter}
          reorderable={reorderable}
          categoryOf={byCategory ? categoryOf : undefined}
          wrapCells={wrapCells}
          renderCell={(column, row) => <Cell column={column} row={row} />}
        />
      </div>

      <aside className="panel">
        <h2>Engine state</h2>
        <div className="stats">
          <div className="stat">
            <div className="stat-value">{rows.length}</div>
            <div className="stat-key">rows in</div>
          </div>
          <div className="stat">
            <div className="stat-value">{filtered.length}</div>
            <div className="stat-key">after filter</div>
          </div>
          <div className="stat">
            <div className="stat-value">{countConditions(view.filter)}</div>
            <div className="stat-key">filters</div>
          </div>
          <div className="stat">
            <div className="stat-value">{flatItems.length}</div>
            <div className="stat-key">flat items</div>
          </div>
          <div className="stat">
            <div className="stat-value">{selectedRows.size}</div>
            <div className="stat-key">selected</div>
          </div>
        </div>

        <h3>Column order</h3>
        <p className="note">
          Rewritten by moveColumnWithinCategory() on every drop.
        </p>
        <pre>{order.join("\n")}</pre>

        <h3>Column sizes</h3>
        <p className="note">
          Committed on pointer-up; the drag itself is pure CSS.
        </p>
        <pre>
          {Object.keys(sizes).length === 0
            ? "— nothing resized yet —"
            : JSON.stringify(sizes, null, 2)}
        </pre>

        <h3>GridView</h3>
        <p className="note">
          Search, filter, sort, grouping and the column layout in one
          serializable object — this is exactly what a saved view stores.
        </p>
        <pre>{JSON.stringify(view, null, 2)}</pre>

        <h3>Column layout</h3>
        <p className="note">
          {layout.filter((e) => e.isPinned).length} pinned,{" "}
          {layout.filter((e) => !e.isPinned).length} scrolling.
        </p>
        <pre>
          {layout
            .map(
              (e) =>
                `${e.isPinned ? (e.isLastPinned ? "├ last" : "│ pin ") : "  ···"} ${e.id.padEnd(12)} w=${String(e.size).padStart(4)}${e.stickyLeft !== undefined ? ` left=${e.stickyLeft}` : ""}`,
            )
            .join("\n")}
        </pre>
      </aside>
    </main>
  );
}

createRoot(document.getElementById("app") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

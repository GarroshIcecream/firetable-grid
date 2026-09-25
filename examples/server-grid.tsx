"use client";

import { useEffect, useState } from "react";
import { emptyGridView } from "../src";
import { DataGrid } from "../src/react";
import { type GridRequest, type GridResult, nextGridPage } from "../src/sql";
import { type ListingRow, listingColumns } from "./sql-columns";

/** Complete fetch example using one page; the application provides endpoint. */
export function ServerListingsGrid({ endpoint }: { endpoint: string }) {
  const [request, setRequest] = useState<GridRequest>(() => ({
    view: emptyGridView(),
    page: { limit: 50, offset: 0 },
  }));
  const [loaded, setLoaded] = useState<{
    request: GridRequest;
    endpoint: string;
    result: GridResult<ListingRow>;
  } | null>(null);
  const [failure, setFailure] = useState<{
    request: GridRequest;
    endpoint: string;
    message: string;
  } | null>(null);
  const result =
    loaded?.request === request && loaded.endpoint === endpoint
      ? loaded.result
      : null;
  const error =
    failure?.request === request && failure.endpoint === endpoint
      ? failure.message
      : null;
  const loading = !result && !error;
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`Could not load listings (${response.status})`);
        const result: GridResult<ListingRow> = await response.json();
        if (!controller.signal.aborted)
          setLoaded({ request, endpoint, result });
      } catch (error) {
        if (!controller.signal.aborted)
          setFailure({
            request,
            endpoint,
            message:
              error instanceof Error
                ? error.message
                : "Could not load listings",
          });
      }
    })();
    return () => controller.abort();
  }, [request, endpoint]);
  const next = result ? nextGridPage(result) : undefined;
  return (
    <section aria-busy={loading}>
      <label>
        Search{" "}
        <input
          value={request.view.search}
          onChange={(event) =>
            setRequest({
              ...request,
              view: { ...request.view, search: event.target.value },
              page: { ...request.page, offset: 0 },
            })
          }
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <DataGrid
        dataMode="server"
        rows={result?.rows ?? []}
        columns={listingColumns}
        view={request.view}
        onViewChange={(view) =>
          setRequest({ ...request, view, page: { ...request.page, offset: 0 } })
        }
        getRowId={(row) => row.id}
        renderCell={(column, row) =>
          String(row[column.id as keyof ListingRow] ?? "")
        }
        emptyMessage={loading ? "Loading listings…" : "No listings found."}
      />
      <button
        type="button"
        disabled={loading || request.page.offset === 0}
        onClick={() =>
          setRequest({
            ...request,
            page: {
              ...request.page,
              offset: Math.max(0, request.page.offset - request.page.limit),
            },
          })
        }
      >
        Previous
      </button>
      <button
        type="button"
        disabled={loading || !next}
        onClick={() => {
          if (next) setRequest({ ...request, page: next });
        }}
      >
        Next
      </button>
    </section>
  );
}

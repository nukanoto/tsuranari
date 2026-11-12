import type { ResponseView } from "../shared";

const PREFIX = "#with=";

// A filter is the set of participant ids to aggregate. null means everyone,
// so participants who answer later are included without touching the URL.
export type Filter = ReadonlySet<string> | null;

export function parseFilter(hash: string): Filter {
  if (!hash.startsWith(PREFIX)) return null;
  const ids = decodeURIComponent(hash.slice(PREFIX.length)).split(",");
  return new Set(ids.filter((id) => id !== ""));
}

export function formatFilter(filter: Filter): string {
  return filter === null ? "" : PREFIX + [...filter].join(",");
}

export function selectedIds(filter: Filter, responses: ResponseView[]): Set<string> {
  return new Set(responses.map((r) => r.id).filter((id) => filter === null || filter.has(id)));
}

// Collapses a selection that covers everyone back to null.
export function toFilter(selected: ReadonlySet<string>, responses: ResponseView[]): Filter {
  return responses.every((r) => selected.has(r.id)) ? null : new Set(selected);
}

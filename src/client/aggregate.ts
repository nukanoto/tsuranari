import { type EventView, type Mode, type ResponseView, slotKey } from "../shared";

export function isAvailable(mode: Mode, marks: ReadonlySet<string>, key: string): boolean {
  return mode === "ok" ? marks.has(key) : !marks.has(key);
}

export type Cell = { ok: ResponseView[]; ng: ResponseView[] };

// Splits the selected participants into available / unavailable for every slot.
export function aggregate(ev: EventView, selected: ReadonlySet<string>): Map<string, Cell> {
  const people = ev.responses
    .filter((r) => selected.has(r.id))
    .map((r) => ({ r, marks: new Set(r.marks) }));
  const cells = new Map<string, Cell>();
  for (const date of ev.dates) {
    ev.slots.forEach((_, i) => {
      const key = slotKey(date, i);
      const cell: Cell = { ok: [], ng: [] };
      for (const p of people) {
        (isAvailable(ev.mode, p.marks, key) ? cell.ok : cell.ng).push(p.r);
      }
      cells.set(key, cell);
    });
  }
  return cells;
}

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

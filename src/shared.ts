// Shared between the Worker and the browser bundle, so keep it free of
// server-only imports.

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, i) => from + i);
}

// A time slot. "time" is the range shown under the label; units whose label is
// already a clock time (1 hour, 30 minutes) leave it out.
export type Slot = { label: string; time?: string };

export const slotText = (s: Slot) => (s.time ? `${s.label} (${s.time})` : s.label);

const plain = (labels: string[]): Slot[] => labels.map((label) => ({ label }));

const CLASS_PERIODS: Slot[] = [
  { label: "1限", time: "8:40-9:55" },
  { label: "2限", time: "10:10-11:25" },
  { label: "3限", time: "12:15-13:30" },
  { label: "4限", time: "13:45-15:00" },
  { label: "5限", time: "15:15-16:30" },
  { label: "6限", time: "16:45-18:00" },
];
const LUNCH: Slot = { label: "昼休み", time: "11:25-12:15" };
const AFTER_SCHOOL: Slot = { label: "放課後", time: "18:00〜" };

// Lunch break sits between 2nd and 3rd period.
const WITH_LUNCH = [...CLASS_PERIODS.slice(0, 2), LUNCH, ...CLASS_PERIODS.slice(2)];

// Class periods follow the University of Tsukuba timetable.
export const UNITS = {
  day: { label: "1日単位", slots: plain(["終日"]) },
  half: { label: "半日単位 (午前 / 午後)", slots: plain(["午前", "午後"]) },
  hour_0_24: {
    label: "1時間単位 (0:00 〜 24:00)",
    slots: plain(range(0, 24).map((h) => `${h}:00`)),
  },
  hour_8_18: {
    label: "1時間単位 (8:00 〜 18:00)",
    slots: plain(range(8, 18).map((h) => `${h}:00`)),
  },
  hour_8_21: {
    label: "1時間単位 (8:00 〜 21:00)",
    slots: plain(range(8, 21).map((h) => `${h}:00`)),
  },
  half_hour_8_18: {
    label: "30分単位 (8:00 〜 18:00)",
    slots: plain(range(16, 36).map((i) => `${Math.floor(i / 2)}:${i % 2 ? "30" : "00"}`)),
  },
  class_1_6: { label: "授業単位 (1限 〜 6限)", slots: CLASS_PERIODS },
  class_1_6_after: {
    label: "授業単位 (1限 〜 6限・放課後)",
    slots: [...CLASS_PERIODS, AFTER_SCHOOL],
  },
  // Added as separate units so slot indexes of existing events never shift.
  class_1_6_lunch: { label: "授業単位 (1限 〜 6限・昼休み)", slots: WITH_LUNCH },
  class_1_6_lunch_after: {
    label: "授業単位 (1限 〜 6限・昼休み・放課後)",
    slots: [...WITH_LUNCH, AFTER_SCHOOL],
  },
} satisfies Record<string, { label: string; slots: Slot[] }>;

export type Unit = keyof typeof UNITS;

export const isUnit = (v: unknown): v is Unit => typeof v === "string" && Object.hasOwn(UNITS, v);

export const MAX_DAYS = 100;

// "ng": participants check slots they cannot attend.
// "ok": participants check slots they can attend.
export type Mode = "ng" | "ok";

export const isMode = (v: unknown): v is Mode => v === "ng" || v === "ok";

export const slotKey = (date: string, slot: number) => `${date}#${slot}`;

export type ResponseView = {
  id: string;
  name: string;
  comment: string;
  marks: string[];
  updatedAt: string;
};

// A slot ranked by how many of the selected participants can attend.
export type RankedSlot = {
  slot: string;
  date: string;
  label: string;
  time?: string;
  ok: string[];
  ng: string[];
};

export type EventView = {
  id: string;
  title: string;
  creator: string;
  memo: string;
  mode: Mode;
  unit: Unit;
  start: string;
  end: string;
  excludeWeekends: boolean;
  dates: string[];
  slots: Slot[];
  responses: ResponseView[];
};

export function isAvailable(mode: Mode, marks: ReadonlySet<string>, key: string): boolean {
  return mode === "ok" ? marks.has(key) : !marks.has(key);
}

export type Cell = { ok: ResponseView[]; ng: ResponseView[] };

type Grid = Pick<EventView, "mode" | "dates" | "slots" | "responses">;

// Splits the selected participants into available / unavailable for every slot.
export function aggregate(ev: Grid, selected: ReadonlySet<string>): Map<string, Cell> {
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

// Best slots first; ties keep chronological order because Array.sort is stable.
export function rank(ev: Grid, selected: ReadonlySet<string>, limit: number): RankedSlot[] {
  if (selected.size === 0) return [];
  return [...aggregate(ev, selected)]
    .filter(([, cell]) => cell.ok.length > 0)
    .sort(([, a], [, b]) => b.ok.length - a.ok.length)
    .slice(0, limit)
    .map(([key, cell]) => {
      const [date, slot] = key.split("#");
      return {
        slot: key,
        date,
        ...ev.slots[Number(slot)],
        ok: cell.ok.map((r) => r.name),
        ng: cell.ng.map((r) => r.name),
      };
    });
}

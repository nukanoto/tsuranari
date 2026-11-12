// Shared between the Worker and the browser bundle, so keep it free of
// server-only imports.

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, i) => from + i);
}

const CLASS_PERIODS = ["1限 8:40", "2限 10:10", "3限 12:15", "4限 13:45", "5限 15:15", "6限 16:45"];

// Class periods follow the University of Tsukuba timetable.
export const UNITS = {
  day: { label: "1日単位", slots: ["終日"] },
  half: { label: "半日単位 (午前 / 午後)", slots: ["午前", "午後"] },
  hour_0_24: { label: "1時間単位 (0:00 〜 24:00)", slots: range(0, 24).map((h) => `${h}:00`) },
  hour_8_18: { label: "1時間単位 (8:00 〜 18:00)", slots: range(8, 18).map((h) => `${h}:00`) },
  hour_8_21: { label: "1時間単位 (8:00 〜 21:00)", slots: range(8, 21).map((h) => `${h}:00`) },
  half_hour_8_18: {
    label: "30分単位 (8:00 〜 18:00)",
    slots: range(16, 36).map((i) => `${Math.floor(i / 2)}:${i % 2 ? "30" : "00"}`),
  },
  class_1_6: { label: "授業単位 (1限 〜 6限)", slots: CLASS_PERIODS },
  class_1_6_after: {
    label: "授業単位 (1限 〜 6限・放課後)",
    slots: [...CLASS_PERIODS, "放課後"],
  },
} satisfies Record<string, { label: string; slots: string[] }>;

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

export type EventView = {
  id: string;
  title: string;
  creator: string;
  memo: string;
  mode: Mode;
  unit: Unit;
  dates: string[];
  slots: string[];
  responses: ResponseView[];
};

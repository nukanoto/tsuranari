import { Hono } from "hono";
import {
  type EventView,
  isMode,
  isUnit,
  MAX_DAYS,
  type Mode,
  slotKey,
  UNITS,
  type Unit,
} from "./shared";

type Env = { DB: D1Database };

type Body = Record<string, unknown> | null;

type EventRow = {
  id: string;
  title: string;
  creator: string;
  start_date: string;
  end_date: string;
  unit: Unit;
  exclude_weekends: number;
  mode: Mode;
  memo: string;
};

type ResponseRow = {
  id: string;
  name: string;
  comment: string;
  marks: string;
  updated_at: string;
};

const DAY_MS = 86_400_000;

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  // Date silently rolls 2026-02-30 over to March, so compare the round trip.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? d : null;
}

function listDates(start: string, end: string, excludeWeekends: boolean): string[] {
  const dates: string[] = [];
  const last = Date.parse(`${end}T00:00:00Z`);
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= last; t += DAY_MS) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    if (excludeWeekends && (dow === 0 || dow === 6)) continue;
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

const eventDates = (ev: EventRow) =>
  listDates(ev.start_date, ev.end_date, ev.exclude_weekends === 1);

function newId(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

// Returns the trimmed string, or null when it is missing, too long, or not a string.
function text(v: unknown, max: number, required: boolean): string | null {
  if (v === undefined || v === null) return required ? null : "";
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (required && s === "") return null;
  return s.length <= max ? s : null;
}

function parseResponse(body: Body, ev: EventRow) {
  const name = text(body?.name, 50, true);
  if (name === null) return { error: "名前は 1 から 50 文字で入力してください" };
  const comment = text(body?.comment, 200, false);
  if (comment === null) return { error: "コメントは 200 文字以内で入力してください" };
  const marks: unknown = body?.marks;
  if (!Array.isArray(marks)) return { error: "marks must be an array" };
  const valid = new Set(
    eventDates(ev).flatMap((date) => UNITS[ev.unit].slots.map((_, i) => slotKey(date, i))),
  );
  if (!marks.every((m) => typeof m === "string" && valid.has(m))) {
    return { error: "marks contains an unknown slot" };
  }
  return { name, comment, marks: [...new Set(marks as string[])] };
}

const loadEvent = (db: D1Database, id: string) =>
  db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRow>();

async function nameTaken(db: D1Database, eventId: string, name: string, exceptId: string | null) {
  const row = await db
    .prepare("SELECT 1 FROM responses WHERE event_id = ? AND name = ? AND id IS NOT ?")
    .bind(eventId, name, exceptId)
    .first();
  return row !== null;
}

const readJson = (req: Request): Promise<Body> => req.json<Body>().catch(() => null);

const app = new Hono<{ Bindings: Env }>();

app.post("/api/events", async (c) => {
  const body = await readJson(c.req.raw);
  const title = text(body?.title, 100, true);
  if (title === null) {
    return c.json({ error: "イベント名は 1 から 100 文字で入力してください" }, 400);
  }
  const creator = text(body?.creator, 50, true);
  if (creator === null)
    return c.json({ error: "作成者名は 1 から 50 文字で入力してください" }, 400);
  const memo = text(body?.memo, 1000, false);
  if (memo === null) return c.json({ error: "メモは 1000 文字以内で入力してください" }, 400);

  const start = parseDate(body?.start);
  const end = parseDate(body?.end);
  if (!start || !end || end < start) {
    return c.json({ error: "終了日は開始日以降を選択してください" }, 400);
  }
  if ((end.getTime() - start.getTime()) / DAY_MS + 1 > MAX_DAYS) {
    return c.json({ error: `期間は ${MAX_DAYS} 日以内に設定してください` }, 400);
  }
  const unit = body?.unit;
  if (!isUnit(unit)) return c.json({ error: "unknown unit" }, 400);
  const mode = body?.mode;
  if (!isMode(mode)) return c.json({ error: "unknown mode" }, 400);
  const excludeWeekends = body?.excludeWeekends === true;
  const startDate = body?.start as string;
  const endDate = body?.end as string;
  if (listDates(startDate, endDate, excludeWeekends).length === 0) {
    return c.json({ error: "候補日が 1 日もありません" }, 400);
  }

  const id = newId();
  await c.env.DB.prepare(
    `INSERT INTO events
       (id, title, creator, start_date, end_date, unit, exclude_weekends, mode, memo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      title,
      creator,
      startDate,
      endDate,
      unit,
      excludeWeekends ? 1 : 0,
      mode,
      memo,
      new Date().toISOString(),
    )
    .run();
  return c.json({ id }, 201);
});

app.get("/api/events/:id", async (c) => {
  const ev = await loadEvent(c.env.DB, c.req.param("id"));
  if (!ev) return c.json({ error: "not found" }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, comment, marks, updated_at FROM responses
     WHERE event_id = ? ORDER BY created_at, id`,
  )
    .bind(ev.id)
    .all<ResponseRow>();
  const view: EventView = {
    id: ev.id,
    title: ev.title,
    creator: ev.creator,
    memo: ev.memo,
    mode: ev.mode,
    unit: ev.unit,
    dates: eventDates(ev),
    slots: UNITS[ev.unit].slots,
    responses: results.map((r) => ({
      id: r.id,
      name: r.name,
      comment: r.comment,
      marks: JSON.parse(r.marks),
      updatedAt: r.updated_at,
    })),
  };
  return c.json(view);
});

app.post("/api/events/:id/responses", async (c) => {
  const ev = await loadEvent(c.env.DB, c.req.param("id"));
  if (!ev) return c.json({ error: "not found" }, 404);
  const parsed = parseResponse(await readJson(c.req.raw), ev);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  if (await nameTaken(c.env.DB, ev.id, parsed.name, null)) {
    return c.json({ error: "同じ名前の回答がすでにあります" }, 409);
  }
  const id = newId();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO responses (id, event_id, name, comment, marks, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, ev.id, parsed.name, parsed.comment, JSON.stringify(parsed.marks), now, now)
    .run();
  return c.json({ id }, 201);
});

app.put("/api/events/:id/responses/:rid", async (c) => {
  const ev = await loadEvent(c.env.DB, c.req.param("id"));
  if (!ev) return c.json({ error: "not found" }, 404);
  const rid = c.req.param("rid");
  const parsed = parseResponse(await readJson(c.req.raw), ev);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  if (await nameTaken(c.env.DB, ev.id, parsed.name, rid)) {
    return c.json({ error: "同じ名前の回答がすでにあります" }, 409);
  }
  const res = await c.env.DB.prepare(
    `UPDATE responses SET name = ?, comment = ?, marks = ?, updated_at = ?
     WHERE id = ? AND event_id = ?`,
  )
    .bind(
      parsed.name,
      parsed.comment,
      JSON.stringify(parsed.marks),
      new Date().toISOString(),
      rid,
      ev.id,
    )
    .run();
  if (res.meta.changes === 0) return c.json({ error: "not found" }, 404);
  return c.json({ id: rid });
});

app.delete("/api/events/:id/responses/:rid", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM responses WHERE id = ? AND event_id = ?")
    .bind(c.req.param("rid"), c.req.param("id"))
    .run();
  if (res.meta.changes === 0) return c.json({ error: "not found" }, 404);
  return c.body(null, 204);
});

app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

export default app;

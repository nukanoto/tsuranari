// Event and response operations shared by the REST API and the MCP server.
import {
  type EventView,
  isMode,
  isUnit,
  MAX_DAYS,
  type Mode,
  type ResponseView,
  slotKey,
  UNITS,
  type Unit,
} from "./shared";

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

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

export type EventInput = {
  title: string;
  creator: string;
  memo: string;
  start: string;
  end: string;
  unit: Unit;
  mode: Mode;
  excludeWeekends: boolean;
};

export type ResponseInput = { name: string; comment: string; marks: string[] };

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

const validSlots = (e: Pick<EventInput, "start" | "end" | "excludeWeekends" | "unit">) =>
  new Set(
    listDates(e.start, e.end, e.excludeWeekends).flatMap((date) =>
      UNITS[e.unit].slots.map((_, i) => slotKey(date, i)),
    ),
  );

// Returns the trimmed string, or throws when it is missing, too long, or not a string.
function text(v: unknown, max: number, required: boolean, message: string): string {
  if (v === undefined || v === null) {
    if (required) throw new ApiError(400, message);
    return "";
  }
  const s = typeof v === "string" ? v.trim() : null;
  if (s === null || (required && s === "") || s.length > max) throw new ApiError(400, message);
  return s;
}

export function parseEvent(body: Record<string, unknown> | null): EventInput {
  const title = text(body?.title, 100, true, "イベント名は 1 から 100 文字で入力してください");
  const creator = text(body?.creator, 50, true, "作成者名は 1 から 50 文字で入力してください");
  const memo = text(body?.memo, 1000, false, "メモは 1000 文字以内で入力してください");
  const start = parseDate(body?.start);
  const end = parseDate(body?.end);
  if (!start || !end || end < start) {
    throw new ApiError(400, "終了日は開始日以降を選択してください");
  }
  if ((end.getTime() - start.getTime()) / DAY_MS + 1 > MAX_DAYS) {
    throw new ApiError(400, `期間は ${MAX_DAYS} 日以内に設定してください`);
  }
  const unit = body?.unit;
  if (!isUnit(unit)) throw new ApiError(400, "unknown unit");
  const mode = body?.mode;
  if (!isMode(mode)) throw new ApiError(400, "unknown mode");
  const input: EventInput = {
    title,
    creator,
    memo,
    start: body?.start as string,
    end: body?.end as string,
    unit,
    mode,
    excludeWeekends: body?.excludeWeekends === true,
  };
  if (listDates(input.start, input.end, input.excludeWeekends).length === 0) {
    throw new ApiError(400, "候補日が 1 日もありません");
  }
  return input;
}

function parseResponse(
  body: Record<string, unknown> | null,
  valid: ReadonlySet<string>,
): ResponseInput {
  const name = text(body?.name, 50, true, "名前は 1 から 50 文字で入力してください");
  const comment = text(body?.comment, 200, false, "コメントは 200 文字以内で入力してください");
  const marks: unknown = body?.marks;
  if (!Array.isArray(marks)) throw new ApiError(400, "marks must be an array");
  const unknown = marks.find((m) => typeof m !== "string" || !valid.has(m));
  if (unknown !== undefined) {
    throw new ApiError(400, `unknown slot: ${JSON.stringify(unknown)}`);
  }
  return { name, comment, marks: [...new Set(marks as string[])] };
}

function newId(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const toInput = (ev: EventRow): EventInput => ({
  title: ev.title,
  creator: ev.creator,
  memo: ev.memo,
  start: ev.start_date,
  end: ev.end_date,
  unit: ev.unit,
  mode: ev.mode,
  excludeWeekends: ev.exclude_weekends === 1,
});

async function loadEvent(db: D1Database, id: string): Promise<EventRow> {
  const ev = await db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRow>();
  if (!ev) throw new ApiError(404, "event not found");
  return ev;
}

async function loadResponses(db: D1Database, eventId: string): Promise<ResponseView[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, comment, marks, updated_at FROM responses
       WHERE event_id = ? ORDER BY created_at, id`,
    )
    .bind(eventId)
    .all<ResponseRow>();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    comment: r.comment,
    marks: JSON.parse(r.marks),
    updatedAt: r.updated_at,
  }));
}

async function ensureNameFree(db: D1Database, eventId: string, name: string, exceptId: string) {
  const row = await db
    .prepare("SELECT 1 FROM responses WHERE event_id = ? AND name = ? AND id IS NOT ?")
    .bind(eventId, name, exceptId)
    .first();
  if (row) throw new ApiError(409, "同じ名前の回答がすでにあります");
}

export async function getEvent(db: D1Database, id: string): Promise<EventView> {
  const ev = await loadEvent(db, id);
  const input = toInput(ev);
  return {
    id: ev.id,
    title: ev.title,
    creator: ev.creator,
    memo: ev.memo,
    mode: ev.mode,
    unit: ev.unit,
    start: input.start,
    end: input.end,
    excludeWeekends: input.excludeWeekends,
    dates: listDates(input.start, input.end, input.excludeWeekends),
    slots: UNITS[ev.unit].slots,
    responses: await loadResponses(db, ev.id),
  };
}

export async function createEvent(db: D1Database, input: EventInput): Promise<string> {
  const id = newId();
  await db
    .prepare(
      `INSERT INTO events
         (id, title, creator, start_date, end_date, unit, exclude_weekends, mode, memo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.title,
      input.creator,
      input.start,
      input.end,
      input.unit,
      input.excludeWeekends ? 1 : 0,
      input.mode,
      input.memo,
      new Date().toISOString(),
    )
    .run();
  return id;
}

// Applies a partial change. Changing the unit or mode would silently change what
// existing marks mean, so it is refused once someone has answered. Marks that fall
// outside a new date range are dropped.
export async function updateEvent(
  db: D1Database,
  id: string,
  patch: Partial<EventInput>,
): Promise<void> {
  const ev = await loadEvent(db, id);
  const current = toInput(ev);
  const next = parseEvent({ ...current, ...patch });
  const responses = await loadResponses(db, id);
  if (responses.length > 0 && (next.unit !== current.unit || next.mode !== current.mode)) {
    throw new ApiError(409, "回答があるイベントは時間単位と回答方式を変更できません");
  }
  const valid = validSlots(next);
  const pruned = responses
    .map((r) => ({ r, marks: r.marks.filter((m) => valid.has(m)) }))
    .filter(({ r, marks }) => marks.length !== r.marks.length);
  await db.batch([
    db
      .prepare(
        `UPDATE events SET title = ?, creator = ?, memo = ?, start_date = ?, end_date = ?,
           unit = ?, mode = ?, exclude_weekends = ? WHERE id = ?`,
      )
      .bind(
        next.title,
        next.creator,
        next.memo,
        next.start,
        next.end,
        next.unit,
        next.mode,
        next.excludeWeekends ? 1 : 0,
        id,
      ),
    ...pruned.map(({ r, marks }) =>
      db.prepare("UPDATE responses SET marks = ? WHERE id = ?").bind(JSON.stringify(marks), r.id),
    ),
  ]);
}

export async function addResponse(
  db: D1Database,
  eventId: string,
  body: Record<string, unknown> | null,
): Promise<string> {
  const ev = await loadEvent(db, eventId);
  const input = parseResponse(body, validSlots(toInput(ev)));
  await ensureNameFree(db, eventId, input.name, "");
  const id = newId();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO responses (id, event_id, name, comment, marks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, eventId, input.name, input.comment, JSON.stringify(input.marks), now, now)
    .run();
  return id;
}

export async function updateResponse(
  db: D1Database,
  eventId: string,
  responseId: string,
  body: Record<string, unknown> | null,
): Promise<void> {
  const ev = await loadEvent(db, eventId);
  const input = parseResponse(body, validSlots(toInput(ev)));
  await ensureNameFree(db, eventId, input.name, responseId);
  const res = await db
    .prepare(
      `UPDATE responses SET name = ?, comment = ?, marks = ?, updated_at = ?
       WHERE id = ? AND event_id = ?`,
    )
    .bind(
      input.name,
      input.comment,
      JSON.stringify(input.marks),
      new Date().toISOString(),
      responseId,
      eventId,
    )
    .run();
  if (res.meta.changes === 0) throw new ApiError(404, "response not found");
}

export async function deleteResponse(db: D1Database, eventId: string, responseId: string) {
  const res = await db
    .prepare("DELETE FROM responses WHERE id = ? AND event_id = ?")
    .bind(responseId, eventId)
    .run();
  if (res.meta.changes === 0) throw new ApiError(404, "response not found");
}

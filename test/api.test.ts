// API tests run inside workerd against a real local D1, with migrations applied in setup.ts.
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { EventView } from "../src/shared";

const call = async (method: string, path: string, body?: unknown) => {
  const res = await exports.default.fetch(`https://example.com${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
};

const validEvent = {
  title: "研究室ミーティング",
  creator: "三谷",
  start: "2026-11-13",
  end: "2026-11-16",
  unit: "half",
  excludeWeekends: true,
  mode: "ng",
  memo: "オンライン可",
};

const createEvent = async (overrides: Record<string, unknown> = {}) => {
  const { status, data } = await call("POST", "/api/events", { ...validEvent, ...overrides });
  expect(status, "イベント作成が成功すること").toBe(201);
  return data.id as string;
};

const getEvent = async (id: string) => (await call("GET", `/api/events/${id}`)).data as EventView;

describe("イベント作成", () => {
  it("土日を除外すると金曜と月曜だけが候補日になる", async () => {
    // 2026-11-13 is Friday and 2026-11-16 is Monday.
    const ev = await getEvent(await createEvent());
    expect(ev.dates).toEqual(["2026-11-13", "2026-11-16"]);
    expect(ev.slots).toEqual(["午前", "午後"]);
    expect(ev.title).toBe("研究室ミーティング");
    expect(ev.responses).toEqual([]);
  });

  it("土日を含めると期間中の全日が候補日になる", async () => {
    const ev = await getEvent(await createEvent({ excludeWeekends: false }));
    expect(ev.dates).toHaveLength(4);
  });

  it("昼休みを含む授業単位では、昼休みが 2 限と 3 限の間に入る", async () => {
    const lunch = await getEvent(await createEvent({ unit: "class_1_6_lunch" }));
    expect(lunch.slots).toEqual([
      "1限 8:40",
      "2限 10:10",
      "昼休み",
      "3限 12:15",
      "4限 13:45",
      "5限 15:15",
      "6限 16:45",
    ]);
    const both = await getEvent(await createEvent({ unit: "class_1_6_lunch_after" }));
    expect(both.slots.at(2)).toBe("昼休み");
    expect(both.slots.at(-1), "放課後は最後に来ること").toBe("放課後");
  });

  it("昼休みを含まない授業単位の枠は変わらない", async () => {
    // Existing answers store slot indexes, so these lists must never change.
    const plain = await getEvent(await createEvent({ unit: "class_1_6" }));
    expect(plain.slots).not.toContain("昼休み");
    expect(plain.slots).toHaveLength(6);
    const after = await getEvent(await createEvent({ unit: "class_1_6_after" }));
    expect(after.slots).toHaveLength(7);
    expect(after.slots.at(-1)).toBe("放課後");
  });

  it("期間はちょうど 100 日まで許可し、101 日は拒否する", async () => {
    // 2026-01-01 + 99 days = 2026-04-10, which is 100 days inclusive.
    await createEvent({ start: "2026-01-01", end: "2026-04-10", excludeWeekends: false });
    const res = await call("POST", "/api/events", {
      ...validEvent,
      start: "2026-01-01",
      end: "2026-04-11",
    });
    expect(res.status, "101 日の期間は 400 になること").toBe(400);
  });

  it.each([
    ["イベント名が空", { title: "  " }],
    ["終了日が開始日より前", { start: "2026-11-16", end: "2026-11-13" }],
    ["存在しない日付", { start: "2026-02-30" }],
    ["未知の時間単位", { unit: "minute" }],
    ["未知の回答方式", { mode: "maybe" }],
    ["土日だけの期間で土日を除外", { start: "2026-11-14", end: "2026-11-15" }],
  ])("%s の場合は 400 を返す", async (_, overrides) => {
    const res = await call("POST", "/api/events", { ...validEvent, ...overrides });
    expect(res.status).toBe(400);
    expect(res.data.error, "エラーメッセージが返ること").toBeTypeOf("string");
  });

  it("存在しないイベントは 404 を返す", async () => {
    expect((await call("GET", "/api/events/nope")).status).toBe(404);
  });
});

describe("回答", () => {
  it("回答の追加、更新、削除ができる", async () => {
    const id = await createEvent();

    const created = await call("POST", `/api/events/${id}/responses`, {
      name: "佐藤",
      comment: "午後は遅れるかも",
      marks: ["2026-11-13#1", "2026-11-13#1"],
    });
    expect(created.status).toBe(201);
    const rid = created.data.id;

    let ev = await getEvent(id);
    expect(ev.responses).toHaveLength(1);
    // Duplicated marks are stored once.
    expect(ev.responses[0].marks, "重複したマークは 1 つにまとめられること").toEqual([
      "2026-11-13#1",
    ]);

    const updated = await call("PUT", `/api/events/${id}/responses/${rid}`, {
      name: "佐藤",
      comment: "",
      marks: ["2026-11-16#0"],
    });
    expect(updated.status).toBe(200);
    ev = await getEvent(id);
    expect(ev.responses[0].marks).toEqual(["2026-11-16#0"]);
    expect(ev.responses[0].comment).toBe("");

    expect((await call("DELETE", `/api/events/${id}/responses/${rid}`)).status).toBe(204);
    expect((await getEvent(id)).responses).toEqual([]);
  });

  it("同じイベントで同じ名前の回答は 409 で拒否する", async () => {
    const id = await createEvent();
    await call("POST", `/api/events/${id}/responses`, { name: "鈴木", marks: [] });
    const dup = await call("POST", `/api/events/${id}/responses`, { name: "鈴木", marks: [] });
    expect(dup.status).toBe(409);
  });

  it("別の回答の名前に変更する更新も 409 で拒否する", async () => {
    const id = await createEvent();
    await call("POST", `/api/events/${id}/responses`, { name: "鈴木", marks: [] });
    const other = await call("POST", `/api/events/${id}/responses`, { name: "高橋", marks: [] });
    const res = await call("PUT", `/api/events/${id}/responses/${other.data.id}`, {
      name: "鈴木",
      marks: [],
    });
    expect(res.status).toBe(409);
  });

  it("別のイベントなら同じ名前でも回答できる", async () => {
    const a = await createEvent();
    const b = await createEvent();
    await call("POST", `/api/events/${a}/responses`, { name: "鈴木", marks: [] });
    const res = await call("POST", `/api/events/${b}/responses`, { name: "鈴木", marks: [] });
    expect(res.status).toBe(201);
  });

  it.each([
    ["候補にない日付のマーク", ["2026-11-14#0"]],
    ["範囲外の時間帯のマーク", ["2026-11-13#2"]],
    ["文字列でないマーク", [1]],
  ])("%s は 400 を返す", async (_, marks) => {
    const id = await createEvent();
    const res = await call("POST", `/api/events/${id}/responses`, { name: "田中", marks });
    expect(res.status).toBe(400);
  });

  it("名前が空の回答は 400 を返す", async () => {
    const id = await createEvent();
    const res = await call("POST", `/api/events/${id}/responses`, { name: "", marks: [] });
    expect(res.status).toBe(400);
  });

  it("別のイベントの回答は更新も削除もできない", async () => {
    const a = await createEvent();
    const b = await createEvent();
    const r = await call("POST", `/api/events/${a}/responses`, { name: "伊藤", marks: [] });
    const put = await call("PUT", `/api/events/${b}/responses/${r.data.id}`, {
      name: "伊藤",
      marks: [],
    });
    expect(put.status, "他のイベント経由の更新は 404 になること").toBe(404);
    const del = await call("DELETE", `/api/events/${b}/responses/${r.data.id}`);
    expect(del.status, "他のイベント経由の削除は 404 になること").toBe(404);
    expect((await getEvent(a)).responses, "元の回答は残っていること").toHaveLength(1);
  });
});

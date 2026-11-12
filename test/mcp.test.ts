// MCP tests speak JSON-RPC to the real Worker over /mcp, backed by a local D1.
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

let nextId = 1;

const rpc = async (method: string, params: unknown) => {
  const res = await exports.default.fetch("https://tsuranari.test/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  expect(res.status, "MCP の HTTP 応答が 200 であること").toBe(200);
  return (await res.json()) as { result: Record<string, unknown> };
};

type ToolResult = { isError?: boolean; content: { text: string }[] };

// Returns the parsed event on success, or the error text when the tool reports one.
const call = async (name: string, args: Record<string, unknown>) => {
  const { result } = await rpc("tools/call", { name, arguments: args });
  const r = result as ToolResult;
  return r.isError ? { error: r.content[0].text } : JSON.parse(r.content[0].text);
};

const create = (overrides: Record<string, unknown> = {}) =>
  call("create_event", {
    title: "ゼミ",
    creator: "三谷",
    start: "2026-11-13",
    end: "2026-11-16",
    unit: "half",
    ...overrides,
  });

describe("MCP の基本", () => {
  it("初期化でサーバー名と使い方の説明を返す", async () => {
    const { result } = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(result.serverInfo).toMatchObject({ name: "tsuranari" });
    expect(result.instructions, "スロットの書き方が説明されていること").toContain("YYYY-MM-DD#i");
  });

  it("6 つのツールを公開する", async () => {
    const { result } = await rpc("tools/list", {});
    const names = (result.tools as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual([
      "add_response",
      "create_event",
      "delete_response",
      "get_event",
      "update_event",
      "update_response",
    ]);
  });
});

describe("イベント", () => {
  it("作成すると共有 URL つきで返り、回答方式と土日除外は既定値になる", async () => {
    const ev = await create();
    expect(ev.url).toBe(`https://tsuranari.test/e/${ev.id}`);
    expect(ev.mode).toBe("ng");
    // 11/14 and 11/15 are a weekend.
    expect(ev.dates, "土日が除外されること").toEqual(["2026-11-13", "2026-11-16"]);
    expect(ev.best, "回答がなければベスト候補は空であること").toEqual([]);
  });

  it("入力が不正ならエラー文をそのまま返す", async () => {
    const res = await create({ start: "2026-11-16", end: "2026-11-13" });
    expect(res.error).toBe("終了日は開始日以降を選択してください");
  });

  it("イベント URL でも ID でも参照できる", async () => {
    const ev = await create();
    expect((await call("get_event", { event: ev.url })).id).toBe(ev.id);
    expect((await call("get_event", { event: ev.id })).id).toBe(ev.id);
    expect((await call("get_event", { event: "nope" })).error).toBe("event not found");
  });

  it("指定した項目だけを更新し、期間を縮めると範囲外の印を消す", async () => {
    const ev = await create();
    await call("add_response", {
      event: ev.id,
      name: "佐藤",
      unavailable: ["2026-11-13#0", "2026-11-16#1"],
    });
    const updated = await call("update_event", { event: ev.id, title: "合宿", end: "2026-11-13" });
    expect(updated.title).toBe("合宿");
    expect(updated.creator, "指定していない項目は残ること").toBe("三谷");
    expect(updated.dates).toEqual(["2026-11-13"]);
    expect(updated.responses[0].marks, "11/16 の印が消えること").toEqual(["2026-11-13#0"]);
  });

  it("回答があると時間単位と回答方式は変えられないが、回答がなければ変えられる", async () => {
    const ev = await create();
    const changed = await call("update_event", { event: ev.id, unit: "day", mode: "ok" });
    expect(changed.slots).toEqual(["終日"]);
    await call("add_response", { event: ev.id, name: "佐藤" });
    const refused = await call("update_event", { event: ev.id, unit: "half" });
    expect(refused.error).toBe("回答があるイベントは時間単位と回答方式を変更できません");
  });
});

describe("回答", () => {
  it("× 方式のイベントに available で答えると、残りの枠が × として保存される", async () => {
    const ev = await create();
    const res = await call("add_response", {
      event: ev.id,
      name: "佐藤",
      available: ["2026-11-13#1"],
    });
    expect(res.marksMean).toBe("slots the participant cannot attend");
    expect(res.responses[0].marks.sort()).toEqual(["2026-11-13#0", "2026-11-16#0", "2026-11-16#1"]);
    expect(res.best.map((s: { slot: string }) => s.slot)).toEqual(["2026-11-13#1"]);
  });

  it("○ 方式のイベントに unavailable で答えると、残りの枠が ○ として保存される", async () => {
    const ev = await create({ mode: "ok" });
    const res = await call("add_response", {
      event: ev.id,
      name: "佐藤",
      unavailable: ["2026-11-13#0"],
    });
    expect(res.responses[0].marks.sort()).toEqual(["2026-11-13#1", "2026-11-16#0", "2026-11-16#1"]);
  });

  it("枠を指定しなければ全枠に参加できる回答になる", async () => {
    const ok = await create({ mode: "ok" });
    const res = await call("add_response", { event: ok.id, name: "佐藤" });
    expect(res.responses[0].marks, "○ 方式では全枠に印がつくこと").toHaveLength(4);
    expect(res.best).toHaveLength(4);
  });

  it("available と unavailable を両方渡すとエラーになる", async () => {
    const ev = await create();
    const res = await call("add_response", {
      event: ev.id,
      name: "佐藤",
      available: [],
      unavailable: [],
    });
    expect(res.error).toBe("pass either available or unavailable, not both");
  });

  it("存在しない枠はエラーになる", async () => {
    const ev = await create();
    const res = await call("add_response", {
      event: ev.id,
      name: "佐藤",
      available: ["2026-11-14#0"],
    });
    expect(res.error).toContain("2026-11-14#0");
  });

  it("名前で回答を指定して更新でき、省略した項目は残る", async () => {
    const ev = await create();
    await call("add_response", {
      event: ev.id,
      name: "佐藤",
      comment: "遅れます",
      unavailable: ["2026-11-13#0"],
    });
    const renamed = await call("update_response", {
      event: ev.id,
      response: "佐藤",
      name: "佐藤花子",
    });
    expect(renamed.responses[0]).toMatchObject({
      name: "佐藤花子",
      comment: "遅れます",
      marks: ["2026-11-13#0"],
    });
    const moved = await call("update_response", {
      event: ev.id,
      response: "佐藤花子",
      unavailable: ["2026-11-16#1"],
    });
    expect(moved.responses[0].marks, "枠の指定は全体を置き換えること").toEqual(["2026-11-16#1"]);
  });

  it("名前で回答を削除できる", async () => {
    const ev = await create();
    await call("add_response", { event: ev.id, name: "佐藤" });
    const res = await call("delete_response", { event: ev.id, response: "佐藤" });
    expect(res.responses).toEqual([]);
    expect((await call("delete_response", { event: ev.id, response: "佐藤" })).error).toBe(
      'no response matches "佐藤"',
    );
  });
});

describe("参加者の絞り込み", () => {
  it("with で選んだ人だけでベスト候補を計算する", async () => {
    const ev = await create();
    await call("add_response", { event: ev.id, name: "A", unavailable: ["2026-11-13#0"] });
    await call("add_response", {
      event: ev.id,
      name: "B",
      unavailable: ["2026-11-13#1", "2026-11-16#0", "2026-11-16#1"],
    });

    const all = await call("get_event", { event: ev.id });
    expect(all.selected).toEqual(["A", "B"]);
    expect(all.best[0], "全員なら 2 人とも参加できる枠はない").toMatchObject({ ok: ["B"] });

    const onlyA = await call("get_event", { event: ev.id, with: ["A"] });
    expect(onlyA.selected).toEqual(["A"]);
    expect(onlyA.best.map((s: { slot: string }) => s.slot)).toEqual([
      "2026-11-13#1",
      "2026-11-16#0",
      "2026-11-16#1",
    ]);
    expect(onlyA.best[0].ng, "選ばなかった B は数えないこと").toEqual([]);

    const unknown = await call("get_event", { event: ev.id, with: ["C"] });
    expect(unknown.error).toBe('no response matches "C"');
  });
});

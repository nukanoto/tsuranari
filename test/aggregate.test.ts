import { describe, expect, it } from "vitest";
import { formatFilter, parseFilter, selectedIds, toFilter } from "../src/client/filter";
import { aggregate, type EventView, type ResponseView, rank } from "../src/shared";

const person = (id: string, marks: string[]): ResponseView => ({
  id,
  name: id,
  comment: "",
  marks,
  updatedAt: "",
});

// Two days x two slots. In "ng" mode a mark means "cannot attend".
const event = (mode: "ng" | "ok"): EventView => ({
  id: "ev",
  title: "t",
  creator: "c",
  memo: "",
  mode,
  unit: "half",
  start: "2026-11-13",
  end: "2026-11-16",
  excludeWeekends: true,
  dates: ["2026-11-13", "2026-11-16"],
  slots: ["午前", "午後"],
  responses: [
    person("a", ["2026-11-13#0"]),
    person("b", ["2026-11-13#0", "2026-11-16#1"]),
    person("c", []),
  ],
});

const okNames = (cells: ReturnType<typeof aggregate>, key: string) =>
  cells.get(key)?.ok.map((r) => r.id);

describe("集計", () => {
  it("× 方式ではマークしていない人が参加できる人になる", () => {
    const cells = aggregate(event("ng"), new Set(["a", "b", "c"]));
    expect(okNames(cells, "2026-11-13#0")).toEqual(["c"]);
    expect(okNames(cells, "2026-11-13#1")).toEqual(["a", "b", "c"]);
    expect(okNames(cells, "2026-11-16#1")).toEqual(["a", "c"]);
    expect(cells.size, "全ての枠が集計されること").toBe(4);
  });

  it("○ 方式ではマークした人が参加できる人になる", () => {
    const cells = aggregate(event("ok"), new Set(["a", "b", "c"]));
    expect(okNames(cells, "2026-11-13#0")).toEqual(["a", "b"]);
    expect(cells.get("2026-11-13#0")?.ng.map((r) => r.id)).toEqual(["c"]);
  });

  it("選んだ人だけで集計し、選ばなかった人はどちらにも入らない", () => {
    const cells = aggregate(event("ng"), new Set(["a"]));
    const cell = cells.get("2026-11-16#1");
    expect(cell?.ok.map((r) => r.id)).toEqual(["a"]);
    expect(cell?.ng, "b は選ばれていないので × にも数えないこと").toEqual([]);
  });
});

describe("ベスト候補の順位付け", () => {
  it("参加できる人数の多い順に並べ、同数なら日時の早い順にする", () => {
    const best = rank(event("ng"), new Set(["a", "b", "c"]), 10);
    // 11/13 PM and 11/16 AM have all three; 11/16 PM has two; 11/13 AM has one.
    expect(best.map((s) => s.slot)).toEqual([
      "2026-11-13#1",
      "2026-11-16#0",
      "2026-11-16#1",
      "2026-11-13#0",
    ]);
    expect(best[0], "ラベルと名前で読めること").toMatchObject({
      date: "2026-11-13",
      label: "午後",
      ok: ["a", "b", "c"],
      ng: [],
    });
  });

  it("件数の上限を守り、誰も選ばなければ空になる", () => {
    expect(rank(event("ng"), new Set(["a", "b", "c"]), 2)).toHaveLength(2);
    expect(rank(event("ng"), new Set(), 10)).toEqual([]);
  });

  it("誰も参加できない枠は含めない", () => {
    // In ok mode only a and b marked 11/13 AM, so c alone has no slot.
    expect(rank(event("ok"), new Set(["c"]), 10)).toEqual([]);
  });
});

describe("個人フィルタ", () => {
  const responses = event("ng").responses;

  it("hash がなければ全員を選ぶ", () => {
    expect(parseFilter("")).toBeNull();
    expect([...selectedIds(null, responses)]).toEqual(["a", "b", "c"]);
  });

  it("hash に書いた人だけを選び、存在しない ID は無視する", () => {
    const filter = parseFilter("#with=c,zzz");
    expect([...selectedIds(filter, responses)]).toEqual(["c"]);
  });

  it("空の指定は誰も選ばない状態として復元できる", () => {
    const filter = parseFilter(formatFilter(new Set()));
    expect(filter?.size).toBe(0);
    expect(selectedIds(filter, responses).size).toBe(0);
  });

  it("全員を選んだら null に戻り、URL から hash が消える", () => {
    const filter = toFilter(new Set(["a", "b", "c"]), responses);
    expect(filter).toBeNull();
    expect(formatFilter(filter)).toBe("");
  });

  it("一部を選んだ状態は hash を経由しても同じ選択に戻る", () => {
    const filter = toFilter(new Set(["a", "c"]), responses);
    expect(formatFilter(filter)).toBe("#with=a,c");
    expect([...selectedIds(parseFilter(formatFilter(filter)), responses)]).toEqual(["a", "c"]);
  });

  it("フィルタ指定後に回答した人は、全員表示のときだけ自動で含まれる", () => {
    const later = [...responses, person("d", [])];
    expect(selectedIds(null, later).has("d")).toBe(true);
    expect(selectedIds(new Set(["a"]), later).has("d")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  aggregate,
  formatFilter,
  parseFilter,
  selectedIds,
  toFilter,
} from "../src/client/aggregate";
import type { EventView, ResponseView } from "../src/shared";

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

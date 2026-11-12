// Event pages are rendered by the Worker so link previews show the event, not the generic app.
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const post = (path: string, body: unknown) =>
  exports.default.fetch(`https://tsuranari.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const page = async (path: string) => {
  const res = await exports.default.fetch(`https://tsuranari.test${path}`);
  expect(res.status, "ページは 200 で返ること").toBe(200);
  return res.text();
};

const meta = (html: string, attr: string) =>
  html.match(new RegExp(`<meta ${attr} content="([^"]*)"`))?.[1];

describe("イベントページの OGP", () => {
  it("イベント名、作成者、期間、時間単位、回答人数が入る", async () => {
    const { id } = await (
      await post("/api/events", {
        title: "ゼミ",
        creator: "三谷",
        start: "2026-11-16",
        end: "2026-11-20",
        unit: "class_1_6_lunch",
        mode: "ng",
      })
    ).json<{ id: string }>();
    await post(`/api/events/${id}/responses`, { name: "佐藤", marks: [] });

    const html = await page(`/e/${id}`);
    expect(html).toContain("<title>ゼミ - tsuranari</title>");
    expect(meta(html, 'property="og:title"')).toBe("ゼミ");
    expect(meta(html, 'property="og:url"')).toBe(`https://tsuranari.test/e/${id}`);
    const description =
      "三谷 さんの日程調整。候補 11/16(月) 〜 11/20(金)。授業単位 (1限 〜 6限・昼休み)。回答 1 人";
    expect(meta(html, 'property="og:description"')).toBe(description);
    expect(meta(html, 'name="description"'), "検索向けの説明も同じであること").toBe(description);
    expect(html, "アプリ本体の読み込みが残っていること").toContain('<div id="root"></div>');
  });

  it("イベント名に HTML の特殊文字があっても属性から抜け出せず、元の文字列に戻せる", async () => {
    const title = `"><script>alert(1)</script> &amp; A&B`;
    const { id } = await (
      await post("/api/events", {
        title,
        creator: "x",
        start: "2026-11-16",
        end: "2026-11-16",
        unit: "day",
        mode: "ng",
      })
    ).json<{ id: string }>();
    const html = await page(`/e/${id}`);
    const raw = meta(html, 'property="og:title"');
    // The regex stops at the first quote, so a raw quote would cut the value short.
    expect(raw, "引用符がエスケープされ、属性値が途中で切れないこと").toContain("A&amp;B");
    const decoded = raw
      ?.replaceAll("&quot;", '"')
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&");
    expect(decoded, "HTML として読むと元のイベント名に戻ること").toBe(title);
    expect(html, "title 要素の中身もエスケープされること").toContain(
      '<title>"&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp;amp; A&amp;B - tsuranari</title>',
    );
  });

  it("存在しないイベントは汎用の OGP のまま返す", async () => {
    const html = await page("/e/unknown");
    expect(meta(html, 'property="og:title"')).toBe("tsuranari");
    expect(html).toContain("<title>tsuranari</title>");
  });
});

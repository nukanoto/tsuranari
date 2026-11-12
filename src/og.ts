// Fills Open Graph tags on event pages so shared links show what the event is.
import { getEvent } from "./events";
import { UNITS } from "./shared";

const shortDate = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  const weekday = "日月火水木金土"[d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${weekday})`;
};

export async function eventPage(
  db: D1Database,
  assets: Fetcher,
  url: URL,
  id: string,
): Promise<Response> {
  const page = await assets.fetch(new URL("/", url));
  const ev = await getEvent(db, id).catch(() => null);
  // Unknown events still get the app shell, which shows its own not-found message.
  if (!ev) return page;

  const title = `${ev.title} - tsuranari`;
  const description = [
    `${ev.creator} さんの日程調整`,
    `候補 ${shortDate(ev.start)} 〜 ${shortDate(ev.end)}`,
    UNITS[ev.unit].label,
    `回答 ${ev.responses.length} 人`,
  ].join("。");
  // setAttribute escapes only the quote, so a literal "&amp;" in a title would be
  // decoded by link previews. Escape "&" ourselves.
  const content = (value: string) => ({
    element: (el: Element) => {
      el.setAttribute("content", value.replaceAll("&", "&amp;"));
    },
  });

  return new HTMLRewriter()
    .on("title", { element: (el) => void el.setInnerContent(title) })
    .on('meta[property="og:title"]', content(ev.title))
    .on('meta[property="og:description"]', content(description))
    .on('meta[name="description"]', content(description))
    .on('meta[property="og:url"]', content(url.href))
    .transform(page);
}

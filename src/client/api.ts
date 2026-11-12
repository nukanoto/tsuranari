// Throws with the server's message so forms can show it as is.
export async function api<T>(path: string, init?: { method: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? {} : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function formatDate(date: string): { label: string; weekday: number } {
  const d = new Date(`${date}T00:00:00Z`);
  const weekday = d.getUTCDay();
  return { label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAYS[weekday]})`, weekday };
}

import {
  type Accessor,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import { type EventView, type ResponseView, slotKey } from "../shared";
import {
  aggregate,
  type Filter,
  formatFilter,
  parseFilter,
  selectedIds,
  toFilter,
} from "./aggregate";
import { api, formatDate } from "./api";
import styles from "./Event.module.css";

export function EventPage(props: { id: string }) {
  const [ev, { refetch }] = createResource(() => api<EventView>(`/api/events/${props.id}`));
  return (
    <Switch>
      <Match when={ev.error}>
        <p class={styles.error}>イベントが見つかりませんでした。</p>
      </Match>
      <Match when={ev.latest}>{(view) => <Loaded ev={view} refetch={refetch} />}</Match>
    </Switch>
  );
}

const weekdayClass = (date: string) => {
  const { weekday } = formatDate(date);
  return weekday === 0 ? styles.sun : weekday === 6 ? styles.sat : "";
};

function Loaded(props: { ev: Accessor<EventView>; refetch: () => unknown }) {
  const ev = props.ev;
  const [editing, setEditing] = createSignal<ResponseView | null>(null);
  const [filter, setFilterSignal] = createSignal<Filter>(parseFilter(location.hash));
  const [onlyFull, setOnlyFull] = createSignal(false);
  const [active, setActive] = createSignal<string | null>(null);

  const setFilter = (f: Filter) => {
    setFilterSignal(f);
    history.replaceState(null, "", formatFilter(f) || location.pathname);
  };
  const onHash = () => setFilterSignal(parseFilter(location.hash));
  window.addEventListener("hashchange", onHash);
  onCleanup(() => window.removeEventListener("hashchange", onHash));

  const selected = createMemo(() => selectedIds(filter(), ev().responses));
  const cells = createMemo(() => aggregate(ev(), selected()));
  const maxOk = createMemo(() => Math.max(0, ...[...cells().values()].map((c) => c.ok.length)));

  const toggle = (id: string) => {
    const next = new Set(selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFilter(toFilter(next, ev().responses));
  };

  const saved = async (id: string | null) => {
    // Keep someone who just answered visible under an explicit filter.
    const f = filter();
    if (id && f !== null && !f.has(id)) setFilter(new Set([...f, id]));
    setEditing(null);
    await props.refetch();
  };

  const remove = async (r: ResponseView) => {
    if (!confirm(`${r.name} さんの回答を削除しますか?`)) return;
    await api(`/api/events/${ev().id}/responses/${r.id}`, { method: "DELETE" });
    if (editing()?.id === r.id) setEditing(null);
    await props.refetch();
  };

  const [copied, setCopied] = createSignal(false);
  const copyUrl = async () => {
    await navigator.clipboard.writeText(location.origin + location.pathname);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const activeCell = () => {
    const key = active();
    return key ? cells().get(key) : undefined;
  };
  const describe = (key: string) => {
    const [date, slot] = key.split("#");
    return `${formatDate(date).label} ${ev().slots[Number(slot)]}`;
  };

  return (
    <div class={styles.page}>
      <section class={styles.card}>
        <h1>{ev().title}</h1>
        <p class={styles.muted}>作成者: {ev().creator}</p>
        <Show when={ev().memo}>
          <p class={styles.memo}>{ev().memo}</p>
        </Show>
        <div class={styles.share}>
          <input type="text" readOnly value={location.origin + location.pathname} />
          <button type="button" onClick={copyUrl}>
            {copied() ? "コピーしました" : "URL をコピー"}
          </button>
        </div>
      </section>

      <section class={styles.card}>
        <h2>集計</h2>
        <div class={styles.filter}>
          <div class={styles.filterHead}>
            <strong>
              表示する参加者 ({selected().size} / {ev().responses.length} 人)
            </strong>
            <button type="button" onClick={() => setFilter(null)}>
              全員選択
            </button>
            <button type="button" onClick={() => setFilter(new Set())}>
              全員解除
            </button>
            <label class={styles.inline}>
              <input
                type="checkbox"
                checked={onlyFull()}
                onChange={(e) => setOnlyFull(e.currentTarget.checked)}
              />
              全員が参加できる枠だけ表示
            </label>
          </div>
          <Show
            when={ev().responses.length > 0}
            fallback={<p class={styles.muted}>まだ回答がありません。</p>}
          >
            <ul class={styles.people}>
              <For each={ev().responses}>
                {(r) => (
                  <li classList={{ [styles.off]: !selected().has(r.id) }}>
                    <label class={styles.inline}>
                      <input
                        type="checkbox"
                        checked={selected().has(r.id)}
                        onChange={() => toggle(r.id)}
                      />
                      {r.name}
                    </label>
                    <Show when={r.comment}>
                      <span class={styles.comment}>{r.comment}</span>
                    </Show>
                    <span class={styles.actions}>
                      <button type="button" onClick={() => setFilter(new Set([r.id]))}>
                        この人だけ
                      </button>
                      <button type="button" onClick={() => setEditing(r)}>
                        編集
                      </button>
                      <button type="button" class="danger" onClick={() => remove(r)}>
                        削除
                      </button>
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>

        <div class={styles.scroll}>
          <table class={styles.grid}>
            <thead>
              <tr>
                <th />
                <For each={ev().dates}>
                  {(d) => <th class={weekdayClass(d)}>{formatDate(d).label}</th>}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={ev().slots}>
                {(slot, i) => (
                  <tr>
                    <th>{slot}</th>
                    <For each={ev().dates}>
                      {(d) => {
                        const key = slotKey(d, i());
                        const cell = () => cells().get(key) ?? { ok: [], ng: [] };
                        const full = () => selected().size > 0 && cell().ng.length === 0;
                        return (
                          <td
                            class={styles.sum}
                            classList={{
                              [styles.full]: full(),
                              [styles.dim]: onlyFull() && !full(),
                              [styles.active]: active() === key,
                            }}
                            style={{
                              "--ratio":
                                selected().size === 0 ? 0 : cell().ok.length / selected().size,
                            }}
                          >
                            <button
                              type="button"
                              title={describe(key)}
                              onClick={() => setActive(active() === key ? null : key)}
                            >
                              {cell().ok.length}
                            </button>
                          </td>
                        );
                      }}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>

        <Show
          when={activeCell()}
          fallback={
            <p class={styles.muted}>
              セルを選ぶと、参加できる人と参加できない人を表示します。
              <Show when={maxOk() > 0}> 最大 {maxOk()} 人が参加できます。</Show>
            </p>
          }
        >
          {(cell) => (
            <div class={styles.detail}>
              <strong>{describe(active() ?? "")}</strong>
              <p>
                <span class={styles.ok}>○ {cell().ok.length} 人</span>{" "}
                {cell()
                  .ok.map((r) => r.name)
                  .join("、")}
              </p>
              <p>
                <span class={styles.ng}>× {cell().ng.length} 人</span>{" "}
                {cell()
                  .ng.map((r) => r.name)
                  .join("、")}
              </p>
            </div>
          )}
        </Show>
      </section>

      <AnswerForm ev={ev} editing={editing} onCancel={() => setEditing(null)} onSaved={saved} />
    </div>
  );
}

function AnswerForm(props: {
  ev: Accessor<EventView>;
  editing: Accessor<ResponseView | null>;
  onCancel: () => void;
  onSaved: (id: string | null) => void;
}) {
  const ev = props.ev;
  const [name, setName] = createSignal("");
  const [comment, setComment] = createSignal("");
  const [marks, setMarks] = createSignal<ReadonlySet<string>>(new Set());
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let form: HTMLElement | undefined;

  createEffect(
    on(props.editing, (r) => {
      setName(r?.name ?? "");
      setComment(r?.comment ?? "");
      setMarks(new Set(r?.marks ?? []));
      setError("");
      if (r) form?.scrollIntoView({ behavior: "smooth" });
    }),
  );

  // Drag painting: the first cell decides whether the stroke marks or clears.
  let paint: boolean | null = null;
  const apply = (keys: string[], value: boolean) => {
    const next = new Set(marks());
    for (const k of keys) {
      if (value) next.add(k);
      else next.delete(k);
    }
    setMarks(next);
  };
  const stop = () => {
    paint = null;
  };
  window.addEventListener("pointerup", stop);
  onCleanup(() => window.removeEventListener("pointerup", stop));

  const toggleDay = (date: string) => {
    const keys = ev().slots.map((_, i) => slotKey(date, i));
    apply(keys, !keys.every((k) => marks().has(k)));
  };

  const markSymbol = () => (ev().mode === "ng" ? "×" : "○");

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = { name: name(), comment: comment(), marks: [...marks()] };
    const r = props.editing();
    try {
      const { id } = await api<{ id: string }>(
        r ? `/api/events/${ev().id}/responses/${r.id}` : `/api/events/${ev().id}/responses`,
        { method: r ? "PUT" : "POST", body },
      );
      props.onSaved(r ? null : id);
      setName("");
      setComment("");
      setMarks(new Set<string>());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class={styles.card} ref={form}>
      <h2>{props.editing() ? `${props.editing()?.name} さんの回答を編集` : "回答する"}</h2>
      <form class={styles.answer} onSubmit={submit}>
        <div class={styles.row}>
          <label class={styles.field}>
            <span>名前</span>
            <input
              type="text"
              required
              maxLength={50}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </label>
          <label class={styles.field}>
            <span>コメント (任意)</span>
            <input
              type="text"
              maxLength={200}
              value={comment()}
              onInput={(e) => setComment(e.currentTarget.value)}
            />
          </label>
        </div>
        <p class={styles.muted}>
          {ev().mode === "ng"
            ? "都合がつかない時間に × をつけてください。"
            : "都合がつく時間に ○ をつけてください。"}
          ドラッグでまとめて選べます。日付を押すとその日をまとめて切り替えます。
        </p>
        <div class={styles.scroll}>
          <table class={styles.grid}>
            <thead>
              <tr>
                <th />
                <For each={ev().dates}>
                  {(d) => (
                    <th class={weekdayClass(d)}>
                      <button type="button" class={styles.dayButton} onClick={() => toggleDay(d)}>
                        {formatDate(d).label}
                      </button>
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={ev().slots}>
                {(slot, i) => (
                  <tr>
                    <th>{slot}</th>
                    <For each={ev().dates}>
                      {(d) => {
                        const key = slotKey(d, i());
                        const marked = () => marks().has(key);
                        return (
                          <td
                            class={styles.mark}
                            classList={{
                              [styles.marked]: marked(),
                              [styles.markOk]: ev().mode === "ok",
                            }}
                            onPointerDown={(e) => {
                              e.preventDefault();
                              paint = !marked();
                              apply([key], paint);
                            }}
                            onPointerEnter={() => {
                              if (paint !== null) apply([key], paint);
                            }}
                          >
                            {marked() ? markSymbol() : ""}
                          </td>
                        );
                      }}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
        <Show when={error()}>
          <p class={styles.error}>{error()}</p>
        </Show>
        <div class={styles.buttons}>
          <button type="submit" class="primary" disabled={busy()}>
            {props.editing() ? "更新する" : "回答する"}
          </button>
          <Show when={props.editing()}>
            <button type="button" onClick={props.onCancel}>
              キャンセル
            </button>
          </Show>
        </div>
      </form>
    </section>
  );
}

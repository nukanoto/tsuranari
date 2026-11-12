import { createSignal, For, Show } from "solid-js";
import { MAX_DAYS, type Mode, UNITS, type Unit } from "../shared";
import { api } from "./api";
import styles from "./Create.module.css";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function Create() {
  const [title, setTitle] = createSignal("");
  const [creator, setCreator] = createSignal("");
  const [start, setStart] = createSignal(today());
  const [end, setEnd] = createSignal(today());
  const [unit, setUnit] = createSignal<Unit>("hour_8_18");
  const [excludeWeekends, setExcludeWeekends] = createSignal(true);
  const [mode, setMode] = createSignal<Mode>("ng");
  const [memo, setMemo] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { id } = await api<{ id: string }>("/api/events", {
        method: "POST",
        body: {
          title: title(),
          creator: creator(),
          start: start(),
          end: end(),
          unit: unit(),
          excludeWeekends: excludeWeekends(),
          mode: mode(),
          memo: memo(),
        },
      });
      location.href = `/e/${id}`;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form class={styles.form} onSubmit={submit}>
      <h1>新規日程調整の作成</h1>
      <p class={styles.lead}>イベントの候補日を設定して、参加者に URL を共有しましょう。</p>

      <label class={styles.field}>
        <span>イベント名</span>
        <input
          type="text"
          required
          maxLength={100}
          onInput={(e) => setTitle(e.currentTarget.value)}
        />
      </label>
      <label class={styles.field}>
        <span>作成者名</span>
        <input
          type="text"
          required
          maxLength={50}
          onInput={(e) => setCreator(e.currentTarget.value)}
        />
      </label>

      <div class={styles.row}>
        <label class={styles.field}>
          <span>候補開始日</span>
          <input
            type="date"
            required
            value={start()}
            onInput={(e) => {
              setStart(e.currentTarget.value);
              if (end() < start()) setEnd(start());
            }}
          />
        </label>
        <label class={styles.field}>
          <span>候補終了日</span>
          <input
            type="date"
            required
            min={start()}
            value={end()}
            onInput={(e) => setEnd(e.currentTarget.value)}
          />
        </label>
      </div>
      <p class={styles.hint}>期間は {MAX_DAYS} 日以内に設定してください。</p>

      <fieldset class={styles.field}>
        <legend>時間単位</legend>
        <For each={Object.entries(UNITS) as [Unit, { label: string }][]}>
          {([key, u]) => (
            <label class={styles.choice}>
              <input
                type="radio"
                name="unit"
                checked={unit() === key}
                onChange={() => setUnit(key)}
              />
              {u.label}
            </label>
          )}
        </For>
      </fieldset>

      <fieldset class={styles.field}>
        <legend>休日の扱い</legend>
        <label class={styles.choice}>
          <input
            type="radio"
            name="weekend"
            checked={excludeWeekends()}
            onChange={() => setExcludeWeekends(true)}
          />
          土日を除外する
        </label>
        <label class={styles.choice}>
          <input
            type="radio"
            name="weekend"
            checked={!excludeWeekends()}
            onChange={() => setExcludeWeekends(false)}
          />
          土日を含める
        </label>
      </fieldset>

      <fieldset class={styles.field}>
        <legend>回答方式</legend>
        <label class={styles.choice}>
          <input
            type="radio"
            name="mode"
            checked={mode() === "ng"}
            onChange={() => setMode("ng")}
          />
          × 都合がつかない時間をチェックする
        </label>
        <label class={styles.choice}>
          <input
            type="radio"
            name="mode"
            checked={mode() === "ok"}
            onChange={() => setMode("ok")}
          />
          ○ 都合がつく時間をチェックする
        </label>
      </fieldset>

      <label class={styles.field}>
        <span>参加者へのメモ (任意)</span>
        <textarea rows={3} maxLength={1000} onInput={(e) => setMemo(e.currentTarget.value)} />
      </label>

      <Show when={error()}>
        <p class={styles.error}>{error()}</p>
      </Show>
      <button type="submit" class="primary" disabled={busy()}>
        この内容で日程調整ページを作成する
      </button>
    </form>
  );
}

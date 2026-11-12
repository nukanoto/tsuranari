CREATE TABLE events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  creator TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  unit TEXT NOT NULL,
  exclude_weekends INTEGER NOT NULL,
  mode TEXT NOT NULL,
  memo TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE responses (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  comment TEXT NOT NULL,
  -- JSON array of slot keys the participant checked.
  marks TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX responses_event_id ON responses(event_id);

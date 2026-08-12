// Database layer. Uses SQLite by default so the project runs standalone
// with zero external setup. The schema is simple relational data (one
// trial -> many calls, one trial -> up to 3 verdicts), which is why SQL
// was chosen over a document store.
//
// Swap-out note: moving to Postgres (e.g. Supabase) only touches this
// file — the rest of the app talks to these exported functions, not to
// SQL directly.

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(__dirname, '..', '..', 'tribunal.db');
const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS trials (
  id TEXT PRIMARY KEY,
  defendant TEXT NOT NULL,
  act TEXT NOT NULL,
  question TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trial_id TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  model_used TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  cost REAL,
  status TEXT NOT NULL,
  output_text TEXT,
  error_message TEXT,
  verdict TEXT,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (trial_id) REFERENCES trials(id)
);
`);

// Migration for DBs created before the 'verdict' column existed.
// CREATE TABLE IF NOT EXISTS above is a no-op on an already-existing
// table, so this covers upgrading it in place without losing prior trials.
const callsColumns = db.prepare(`PRAGMA table_info(calls)`).all();
if (!callsColumns.some((c) => c.name === 'verdict')) {
  db.exec(`ALTER TABLE calls ADD COLUMN verdict TEXT`);
}

function createTrial({ id, defendant, act, question }) {
  db.prepare(
    `INSERT INTO trials (id, defendant, act, question, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, defendant, act, question, new Date().toISOString());
}

function logCall({
  trialId,
  agentRole,
  modelUsed,
  promptTokens,
  completionTokens,
  totalTokens,
  cost,
  status,
  outputText,
  errorMessage,
  verdict,
}) {
  // verdict is null for advocate calls (they argue, they don't rule) and
  // for judge calls that errored or came back unparseable. Never
  // fabricated to fill the column.
  db.prepare(
    `INSERT INTO calls
      (trial_id, agent_role, model_used, prompt_tokens, completion_tokens, total_tokens, cost, status, output_text, error_message, verdict, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    trialId,
    agentRole,
    modelUsed || null,
    promptTokens ?? null,
    completionTokens ?? null,
    totalTokens ?? null,
    cost ?? null,
    status,
    outputText ?? null,
    errorMessage ?? null,
    verdict ?? null,
    new Date().toISOString()
  );
}

function getTrial(id) {
  const trial = db.prepare(`SELECT * FROM trials WHERE id = ?`).get(id);
  if (!trial) return null;
  const calls = db
    .prepare(`SELECT * FROM calls WHERE trial_id = ? ORDER BY id ASC`)
    .all(id);
  return { trial, calls };
}

function listTrials() {
  return db
    .prepare(`SELECT id, defendant, act, question, created_at FROM trials ORDER BY created_at DESC LIMIT 50`)
    .all();
}

module.exports = { createTrial, logCall, getTrial, listTrials };

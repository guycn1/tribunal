// Database layer. Uses SQLite by default so the project runs standalone
// with zero external setup. The schema is deliberately simple relational
// data (one trial -> many calls, one trial -> up to 3 verdicts) which is
// why SQL was chosen over a document store — see TRIBUNAL_SPEC.md Part 3.
//
// Swap-out note: if you move to Supabase (Postgres) per the recommended
// toolbox in TRIBUNAL_SPEC.md Part 3, only this file needs to change —
// the rest of the app talks to these exported functions, not to SQL
// directly.

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
  timestamp TEXT NOT NULL,
  FOREIGN KEY (trial_id) REFERENCES trials(id)
);
`);

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
}) {
  db.prepare(
    `INSERT INTO calls
      (trial_id, agent_role, model_used, prompt_tokens, completion_tokens, total_tokens, cost, status, output_text, error_message, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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

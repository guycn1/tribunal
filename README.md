# Tribunal

ASE-26 running project. A fictional Game-of-Thrones-themed courtroom tribunal: 4 advocates and 3 judges, powered by OpenRouter, arguing and ruling independently on a charge.

Read `TRIBUNAL_SPEC.md` before changing anything — it's the actual spec this build follows. `CLAUDE.md` briefs any agent (Claude Code or otherwise) working in this repo automatically.

## Status

This runs end to end and has been exercised against a real OpenRouter key — see `tribunal.db` for logged trials. Treat it as a working scaffold to keep building on and verifying, not a finished, battle-tested app.

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Copy the environment template and add your real OpenRouter key:
   ```
   cp .env.example .env
   ```
   Then edit `.env` and paste in your key from https://openrouter.ai.

3. Run the server:
   ```
   npm start
   ```
4. Open http://localhost:3000

## Tests

```
npm test
```

Runs the automated unit suite (`test/`, Node's built-in test runner — no extra dependency) covering charge sheet validation, judge-output parsing, and cost computation. This is a logic-only gate — it does not call OpenRouter live and does not substitute for the named live test case in `TRIBUNAL_SPEC.md` Part 4. Also runs automatically on every push via GitHub Actions (`.github/workflows/test.yml`).

## What's here

- `server/` — Express backend. `index.js` is the entry point; `lib/orchestrate.js` runs the actual 7-call workflow; `lib/db.js` is the SQLite layer.
- `prompts/` — the 7 versioned agent prompts, one file per role.
- `public/` — the frontend (plain HTML/CSS/JS, no build step).
- `tribunal.db` — created automatically on first run (SQLite file, git-ignored).

## Known gaps — read before treating this as done

- **SQL vs NoSQL** was chosen as SQLite here as a working default — the spec leaves this as your judgment call to justify in your own words, not something to accept silently.
- **Charge sheet validation** is minimal (non-empty fields only) — Part 5 of the spec flags this as something to harden.
- **Model choice fallback.** The hardcoded default in `models.config.js` (`meta-llama/llama-3.1-8b-instruct:free`) is itself already retired — always set `DEFAULT_MODEL` in `.env` to a currently-live free model rather than relying on that fallback.

## Deploying

Not yet wired to Netlify/Supabase. The recommended path (per the toolbox in `TRIBUNAL_SPEC.md` Part 3) is to move `db.js` to talk to Supabase's Postgres instead of local SQLite, and deploy the server portion accordingly — left as a next step, since it needs your actual Supabase project credentials.

# Tribunal

ASE-26 running project. A fictional Game-of-Thrones-themed courtroom tribunal: 4 advocates and 3 judges, powered by OpenRouter, arguing and ruling independently on a charge.

Read `TRIBUNAL_SPEC.md` before changing anything — it's the actual spec this build follows. `CLAUDE.md` briefs any agent (Claude Code or otherwise) working in this repo automatically.

## Status

This is a first working scaffold — it runs end to end, but hasn't been run against a real OpenRouter key yet. Treat it as a solid starting point to build on and verify, not a finished, battle-tested app.

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

## What's here

- `server/` — Express backend. `index.js` is the entry point; `lib/orchestrate.js` runs the actual 7-call workflow; `lib/db.js` is the SQLite layer.
- `prompts/` — the 7 versioned agent prompts, one file per role.
- `public/` — the frontend (plain HTML/CSS/JS, no build step).
- `tribunal.db` — created automatically on first run (SQLite file, git-ignored).

## Known gaps — read before treating this as done

- **Not yet run against a real API key.** The orchestration logic, JSON parsing, and error handling are written to spec but unverified against live model output.
- **SQL vs NoSQL** was chosen as SQLite here as a working default — the spec leaves this as your judgment call to justify in your own words, not something to accept silently.
- **Model choice** defaults to a free OpenRouter model as a placeholder — verify it's still available and actually free before relying on it, and replace with your own considered choice.
- **Charge sheet validation** is minimal (non-empty fields only) — Part 5 of the spec flags this as something to harden.
- The "protocol" concept (structured per-judge reasoning) is implemented as the `reasoning` field per verdict — worth double-checking this interpretation as the spec firms up.

## Deploying

Not yet wired to Netlify/Supabase. The recommended path (per the toolbox in `TRIBUNAL_SPEC.md` Part 3) is to move `db.js` to talk to Supabase's Postgres instead of local SQLite, and deploy the server portion accordingly — left as a next step, since it needs your actual Supabase project credentials.

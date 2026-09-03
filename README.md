# Tribunal

A fixed, canonical fictional tribunal — **Case T-001: The Realm v. Jon Snow** — argued and ruled on by seven independent AI agents: four representatives (two defense, two prosecution) and three judges, each modeled on a distinct real judicial reasoning method (Aharon Barak, Menachem Elon, Meir Shamgar).

The Tribunal decides one question — **justified / not justified** — and gives reasons. It does not impose a sentence, and the three judges' rulings are never combined into a single verdict; they are displayed independently, side by side.

**Live:** https://tribunal-t001.netlify.app

## Architecture

Three-tier: browser (static HTML/CSS/vanilla JS) → backend (Netlify Functions, TypeScript) → database (Supabase/Postgres). The backend holds the OpenRouter API key and orchestrates every model call; the database stores the case record, every representative argument, every judge ruling, and a full per-call log (model, tokens, cost, status, duration).

- Four representatives run in parallel — they don't depend on each other.
- Three judges run after, each independently receiving the case record plus all four representative arguments (or however many are actually available — a failed representative call is never backfilled with invented text).
- A failed model call is logged as a visible failure and never produces a fabricated argument or ruling.

**Background Functions + polling.** Representative and judge calls run as Netlify Background Functions rather than standard synchronous invocations — a real generation can take well past the ~10s ceiling a synchronous function gets. The browser triggers a call, gets an immediate `202`, and polls `GET /api/trials/:id` until the result lands.

**A 4-tier model escalation chain** guards against truncated or degenerate output: `default model → mistral-large-2512 → a top-tier model → a last-resort model`, escalating only once every attempt at the current tier has also failed. Two independent failure signals trigger escalation — `finish_reason === 'length'` (hit the token cap) and a heuristic for a response that finished on its own but degenerated into a long, punctuation-less run-on. Every discarded attempt gets logged as its own real row (model, tokens, cost, outcome) the moment it's decided, not batched at the end — the call log shows the fallback happening, not just the final result. A live-in-progress card shows the model actually being attempted right now, updating as the chain escalates.

**Anti-abuse / cost controls**, layered since the deployed site runs on a paid model with no login: a site-wide rolling call cap, per-IP rate limiting on the two functions that spend OpenRouter quota, and a lightweight site-gate header that filters traffic that never loaded the page at all (not real access control — the token is a public constant in `app.js` — just a cheap first filter).

### Database

Five tables in Supabase/Postgres: `case_definitions` (the fixed charge sheet), `trials`, `representative_arguments`, `judge_rulings`, `api_call_logs` (one row per model call attempt, kept or discarded), and `agent_progress` (one row per trial/role, overwritten in place, tracking whichever attempt is currently in flight for the live-progress display).

## Local development

Prerequisites: Node.js, a Supabase project (schema in `supabase/schema.sql`), an OpenRouter API key.

```bash
npm install
cp .env.example .env   # fill in OPENROUTER_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
npm run dev             # netlify dev — serves the static frontend and functions locally
npm run typecheck       # tsc --noEmit
```

`netlify dev` costs no Netlify credits — it never touches the cloud build/deploy pipeline. It does reach the real OpenRouter API for any representative/judge call, so local testing still spends real quota.

## Tech stack

Netlify Functions (TypeScript, `esbuild` bundler) · Supabase (Postgres) · OpenRouter · vanilla HTML/CSS/JS on the frontend, no build step or framework.

## Project history and directing decisions

This project was built with Claude Code. `CLAUDE.md`, tracked in this repository, is the working brief and running status/decision log used throughout — the case content and requirements it was built against, every architectural decision and why, real bugs found and fixed (with root causes), and the reasoning behind UI/UX choices made along the way.

## Status

Feature-complete and stable. The full pipeline (four representatives in parallel, three judges after, independent rulings never combined) has been verified across many real end-to-end trials, including the reliability chain (escalation, degenerate-output detection) and the anti-abuse layers, both locally and against the live deployed site. A long round of frontend polish (layout, live status display, call log transparency, cross-browser scrollbar/interaction details) is also done. Treated as done pending any further issue noticed on inspection, not as a hard, permanent freeze.

This repository's `main` branch is what's actually deployed at the live URL above; `draft` is the full working history and may sit ahead of it between merges — see `CLAUDE.md`'s status log for exactly what's landed where.

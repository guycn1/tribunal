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

**A 4-tier model escalation chain** guards against unusable output: `default model (2 attempts) → claude-haiku-4.5 (2 attempts) → a top-tier model (2 attempts) → a last-resort model (1 attempt)`, escalating once a tier has used up its attempts. The escalation signals are `finish_reason === 'length'` (hit the token cap), two independent degeneration heuristics (a long punctuation-less run-on, and the same whole sentence repeated 4+ times), a plain HTTP failure such as a removed model id (which skips the tier's remaining attempts, since re-asking a model that just 404'd is pointless), and transient failures (timeout, 429, 5xx, an empty-content 200).

Transient failures are split by **how long they took**, because the right response differs: a call that bounces back in under 10 seconds (a burst rate limit, say) gets a bounded number of same-model retries that don't count against the tier's attempt budget — escalating to a costlier model within seconds of a rate limit that clears on its own would be exactly the wrong move — while one that burns its whole ceiling is treated as a real failure of that tier and escalates. Per-attempt timeouts scale with both prompt size and the token cap, so a judge's much larger prompt gets a proportionally larger ceiling.

Every tier in the chain is a paid model; none of them runs on a free tier. The tiers differ in cost by a wide margin (the default is $0.05/$0.08 per million prompt/completion tokens, the next is $1.00/$5.00), which is why the chain is built to exhaust the cheapest option before reaching for a better one — not to avoid spending, but to spend proportionately.

Every discarded attempt — including a timeout — gets logged as its own real row (model, tokens, cost, outcome) the moment it's decided, not batched at the end, so the call log shows the whole path rather than only the final result. A live-in-progress card shows the model and attempt actually running right now, updating as the chain escalates.

**Abort stops server-side work, not just the UI.** A Background Function can't be cancelled by the browser that started it, so the trial's abort is recorded in the database and each in-flight call checks for it between attempts and stops itself, rather than continuing to escalate through increasingly expensive models for a result nobody is waiting for. A result that arrives after an abort is discarded rather than written into the aborted trial.

**Anti-abuse / cost controls**, layered since the deployed site runs on a paid model with no login: a site-wide rolling call cap, per-IP rate limiting on the two functions that spend OpenRouter quota, and a lightweight site-gate header that filters traffic that never loaded the page at all (not real access control — the token is a public constant in `app.js` — just a cheap first filter).

### Database

Five tables in Supabase/Postgres: `case_definitions` (the fixed charge sheet), `trials`, `representative_arguments`, `judge_rulings`, `api_call_logs` (one row per model call attempt, kept or discarded), and `agent_progress` (one row per trial/role, overwritten in place, tracking whichever attempt is currently in flight for the live-progress display).

## Reading the UI: status badges

Every model call is shown, whether it was kept or thrown away, and every failure is labelled with what actually went wrong. These two tables are the full set of badges either view can produce.

### Call log

One row per real model attempt, including attempts that were discarded in favour of a retry or an escalation. Discarded rows are dimmed, since the call usually went on to succeed further down the table.

| Badge | Colour | What triggered it |
| --- | --- | --- |
| `success` | green | The attempt returned usable content and was kept. This is the text shown on that agent's card. |
| `failed` | red | The attempt failed and no tier or time budget remained. The agent's card reads "Call failed". |
| `Truncated` | amber | `finish_reason === 'length'` — the model was still writing when it hit that tier's token cap. Retried or escalated; the caption says which. |
| `Degenerated` | amber | A detector fired on text that finished *on its own*: a 40+ word run with no punctuation, or the same whole sentence 4+ times. Retried or escalated. |
| `Truncated` | red | The same cap hit, but on the final tier with nothing left to fall back to. Nothing was saved. |
| `Degenerated` | red | The same detector hit, on the final tier. Nothing was saved. |
| `Escalated` | amber | A plain HTTP failure from that tier's own model (e.g. a removed model id returning 404). Skips the tier's remaining attempts, since re-asking a model that just 404'd is pointless. |
| `No response` | amber | A transient failure — timeout, HTTP 429, a 5xx, or a 200 carrying no content. Retried. If it came back in under 10 seconds it did not even cost the tier an attempt. |
| `Aborted` | amber | The chain stopped itself between attempts because the trial was aborted while it was still running server-side. |
| `truncated` | amber | Legacy only: shown *next to* a green `success` on historical rows recorded before truncation became a real failure. New trials never produce it. |

Truncation and degeneration are separate failures rather than nested ones — a capped response is usually coherent prose that simply got cut off, while a degenerate one finished naturally and produced unusable text. A repetition loop that runs until it hits the cap is both at once.

### Run history sidebar

One badge per trial, summarising the whole run.

| Badge | Colour | What triggered it |
| --- | --- | --- |
| `Completed` | green | Finished, with all 7 of 7 results saved. |
| `Completed — missing N of 7` | amber | Finished, but fewer than 7 results were saved: some agent failed on every tier, or was never reached. |
| `Aborted` | grey | Stopped by the user before the trial reached completion. |
| `Aborted (N of 7 completed)` | grey | Stopped by the user, but the trial had already been marked complete — the count says how much survived. |
| `In progress…` | slate | Still running, and under 40 minutes old. |
| `Interrupted` | red | Not finished and over 40 minutes old, so it is treated as never going to finish (a dev-server restart mid-run, say). The threshold is sized to the genuine worst case: a full four-tier escalation for every agent through a three-slot concurrency pool. |

"Missing N" counts results that actually persisted, **not** whether any individual call ever failed along the way. A transient failure that the retry recovered from is a real logged attempt, not a flaw in the outcome — labelling the run on that basis would mark almost every trial as damaged. The call log still shows every attempt in full.

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

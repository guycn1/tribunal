# Tribunal

A fixed, canonical fictional tribunal — **Case T-001: The Realm v. Jon Snow** — argued and ruled on by seven independent AI agents: four representatives (two defense, two prosecution) and three judges, each modeled on a distinct real judicial reasoning method (Aharon Barak, Menachem Elon, Meir Shamgar).

The Tribunal decides one question — **justified / not justified** — and gives reasons. It does not impose a sentence, and the three judges' rulings are never combined into a single verdict; they are displayed independently, side by side.

**Live:** https://tribunal-t001.netlify.app

## Architecture

Three-tier: browser (static HTML/CSS/vanilla JS) → backend (Netlify Functions, TypeScript) → database (Supabase/Postgres). The backend holds the OpenRouter API key and orchestrates every model call; the database stores the case record, each trial, every representative argument and judge ruling, a full per-call log (model, tokens, cost, status, duration), and the attempt each running call is on.

- Four representatives run concurrently — they don't depend on each other. Dispatch goes through a small worker pool, but because the agent endpoints are Background Functions that return as soon as the work is accepted, a pool slot frees at the trigger rather than at the end of the generation — so all four are genuinely in flight at the same time. That is measured from the call log's own timings rather than assumed, and it is how every trial behind the reliability record below actually ran. What the pool still bounds is how many trigger requests overlap, which matters only for Netlify's per-IP rate limit.
- Three judges run after, each independently receiving the case record plus all four representative arguments (or however many are actually available — a failed representative call is never backfilled with invented text).
- A failed model call is logged as a visible failure and never produces a fabricated argument or ruling.

**Background Functions + polling.** Representative and judge calls run as Netlify Background Functions rather than standard synchronous invocations — a real generation can take well past the ~10s ceiling a synchronous function gets. The browser triggers a call, gets an immediate `202`, and polls `GET /api/trials/:id` until the result lands.

**A 4-tier model escalation chain** guards against unusable output: `default model (2 attempts) → claude-haiku-4.5 (2 attempts) → a top-tier model (2 attempts) → a last-resort model (1 attempt)`, escalating once a tier has used up its attempts. The escalation signals are `finish_reason === 'length'` (hit the token cap), two independent degeneration heuristics (a long punctuation-less run-on, and the same whole sentence repeated 4+ times), a plain HTTP failure such as a removed model id (which skips the tier's remaining attempts, since re-asking a model that just 404'd is pointless), and transient failures (a timeout or network error, a 429, a 5xx, or a 200 with no content). Two failures end the call at once instead, since no retry can fix them: the account running out of credits (HTTP 402), and a rate-limit window that outlasts the remaining time budget.

Transient failures are split by **how long they took**, because the right response differs: a call that bounces back in under 10 seconds (a burst rate limit, say) gets a bounded number of same-model retries that don't count against the tier's attempt budget — escalating to a costlier model within seconds of a rate limit that clears on its own would be exactly the wrong move — while one that burns its whole ceiling is treated as a real failure of that tier and escalates. Per-attempt timeouts scale with both prompt size and the token cap, so a judge's much larger prompt gets a proportionally larger ceiling.

Every tier in the chain is a paid model; none of them runs on a free tier. The tiers differ in cost by a wide margin (the default is $0.05/$0.08 per million prompt/completion tokens, the next is $1.00/$5.00), which is why the chain is built to exhaust the cheapest option before reaching for a better one — not to avoid spending, but to spend proportionately.

Every discarded attempt — including a timeout — gets logged as its own real row (model, tokens, cost, duration, outcome) the moment it's decided, not batched at the end, so the call log shows the whole path rather than only the final result. A live-in-progress card shows the model and attempt actually running right now, updating as the chain escalates.

**Abort stops server-side work, not just the UI.** A Background Function can't be cancelled by the browser that started it, so the trial's abort is recorded in the database and each in-flight call checks for it between attempts and stops itself, rather than continuing to escalate through increasingly expensive models for a result nobody is waiting for. A result that arrives after an abort is discarded rather than written into the aborted trial.

**Anti-abuse / cost controls**, layered since the deployed site runs on a paid model with no login: a site-wide rolling call cap, per-IP rate limiting on the two functions that spend OpenRouter quota, and a lightweight site-gate header that filters traffic that never loaded the page at all (not real access control — the token is a public constant in `app.js` — just a cheap first filter).

### API endpoints

Each route below is a rewrite in `netlify.toml` to one function in `netlify/functions/`. Everything this app's own code returns is JSON.

| Method | Path | Function | What it does |
| --- | --- | --- | --- |
| `GET` | `/api/case` | `case.ts` | The fixed case record, the starting model for each role, and the shared completion-token cap. Read once when the page loads. |
| `GET` | `/api/trials` | `trials.ts` | The 50 most recent trials, newest first, for the run-history sidebar — each with its status, how many of its 7 results were saved, whether it was aborted, and whether any attempt ever failed. |
| `POST` | `/api/trials` | `trials.ts` | Creates a trial and returns it with the case record (`201`). Needs the site-gate header. Makes no model call. |
| `GET` | `/api/trials/:id` | `trial.ts` | Everything recorded for one trial: the trial itself, the case record, its saved arguments and rulings, every call-log row (oldest first), and the attempt each role most recently started. Polled throughout a run, and read once to open a past trial. `404` for an unknown id. |
| `POST` | `/api/trials/:id/representatives/:role` | `representative-background.ts` | Runs one representative through the escalation chain and saves the argument, unless the trial has been aborted meanwhile. |
| `POST` | `/api/trials/:id/judges/:role` | `judge-background.ts` | Runs one judge on the case record plus whichever representative arguments were saved, and saves the ruling, unless the trial has been aborted meanwhile. Marks the trial completed once every judge has a final outcome. |
| `POST` | `/api/trials/:id/abort` | `abort.ts` | Takes `{ "roles": [...] }` — the roles still pending — records an abort for each one it recognises, and replies with the roles it recorded. The running calls check for it between attempts and stop. |

**The two agent endpoints behave differently from the rest.** They are the only ones that spend OpenRouter quota, and the only Background Functions: Netlify answers the POST with `202` as soon as the call is accepted and runs the handler afterwards, so nothing the handler returns ever reaches the browser, which learns the outcome by polling `GET /api/trials/:id`. The handler checks, in order, that the request is a POST naming a trial and a role, that the role is one it knows (`jon_snow`, `tyrion_lannister`, `daenerys_targaryen` or `grey_worm`; `barak`, `elon` or `shamgar`), the site-gate header, the site-wide call cap, and that the trial exists. Because of the `202`, a rejection at any of those steps never reaches the browser: the site-gate and call-cap rejections are written to Netlify's function logs, the others are not logged at all, and in the browser that role never resolves — its card says so once polling gives up, after about 12 minutes. Netlify's per-IP rate limit (45 requests per 5 minutes on each of the two, declared in each function's `config`) is enforced by the platform ahead of the handler, so a rejection there would reach the browser directly; it has never been tripped, so that path is untested in production. A judge's reply must contain a `VERDICT: justified` or `VERDICT: not justified` line, and one without it is logged as a failure rather than saved.

### Database

Six tables in Supabase/Postgres. `supabase/schema.sql` is the authority on every column, type and constraint; what follows is a map of what each table holds and the rules worth knowing, not a copy of that file.

- Row-level security is on for all six tables, with no policies, so the public (anon) key can read or write nothing. Only the backend's service-role key can, and the browser never talks to Supabase directly.
- Every table except `case_definitions` and `trials` itself belongs to a single trial through `trial_id`, and deleting a trial deletes its rows in all of them.

**`case_definitions`** — one row per case, keyed by `case_code`. Holds the charge sheet: `title`, `accused`, `deceased`, `act_alleged`, `background`, `agreed_facts` (a JSON array of strings), `question` and `scope_note`. `schema.sql` seeds the only row, `T-001`, and the app reads the case from here at runtime rather than from any copy in the code.

**`trials`** — one row per run: `id` (a UUID — the `:id` in every route above), `case_code`, `status`, `created_at` and `updated_at`. `status` is `created` until every judge has a final outcome logged — a ruling, a failure the chain gave up on, or an abort — and then `completed`, set by the judge endpoint that finds it so. A judge that notices its trial was aborted stops without setting it, so a trial aborted before any judge finished stays `created`.

**`representative_arguments`** — one row per representative whose argument was kept: `id`, `trial_id`, `role` (one of the four representatives), `seat` (`defense` or `prosecution`), `argument_text`, `model_used` and `created_at`. There is at most one row per trial and role, so a representative that needed several attempts still counts once; this table and `judge_rulings` are what the sidebar's "N of 7" counts. Discarded attempts never land here — they live in `api_call_logs`.

**`judge_rulings`** — one row per judge whose ruling was kept: `id`, `trial_id`, `role` (one of the three judges), `verdict` (`justified` or `not justified`), `reasoning_text`, `model_used` and `created_at`. At most one row per trial and role. A trial's three rulings are independent rows, and nothing in the schema or the code combines them.

**`api_call_logs`** — one row per model-call attempt, kept or discarded, appended and never updated. It carries the fields the spec requires for every call — `agent_role`, `model_used`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost` (in US dollars), `status` (`success` or `failed`) and `timestamp` — plus the row's own `id`, `trial_id`, `call_type` (`representative` or `judge`), `error_message` and `duration_ms`. A discarded attempt's `error_message` starts with a marker saying what happened to it, such as `[transient-retried]`, and `duration_ms` is empty on the abort endpoint's rows (they record a decision, not an attempt) and on rows logged before that column existed. An abort is recorded here too, as a `failed` row with the model `n/a` for each pending role; that row is what running calls look for to know they should stop.

**`agent_progress`** — one row per trial and role (`trial_id` and `role` together are its key), overwritten each time a new attempt starts: `model`, `tier_index`, `attempt_in_tier`, `tier_max_attempts` and `updated_at`. It drives the live "Model: … (second attempt)" line on a card that is still running. A row left behind after a role has finished is harmless: the page only reads it for a role with no final result yet.

## Reading the UI: status badges

Every model call is shown, whether it was kept or thrown away, and every failure is labelled with what actually went wrong. These two tables are the full set of badges either view can produce.

### Call log

One row per real model attempt, including attempts that were discarded in favour of a retry or an escalation. Discarded rows are dimmed, since the call usually went on to succeed further down the table.

| Badge | Colour | What triggered it |
| --- | --- | --- |
| `success` | green | The attempt returned usable content and was kept — for a judge, that includes a `VERDICT` line. This is the text shown on that agent's card. The one exception: a result that arrives after its trial was aborted is logged as a success but not saved. |
| `failed` | red | Either a real attempt that ended the call (the agent's card reads "Call failed") — every tier or the time budget used up, a failure no retry can fix such as the account running out of credits, or a judge reply with no `VERDICT` line — or the marker row the abort endpoint writes for a role that was still pending when the user stopped the trial — recognisable by a model of `n/a` and zero tokens, and the agent's card reads "Aborted" rather than "Call failed" for that one. |
| `Truncated` | amber | `finish_reason === 'length'` — the model was still writing when it hit that tier's token cap. Retried or escalated; the caption says which. |
| `Degenerated` | amber | A detector fired on text that finished *on its own*: a 40+ word run with no punctuation, or the same whole sentence 4+ times. Retried or escalated; the caption says which. |
| `Truncated` | red | The same cap hit, with nothing left to fall back to: on the final tier, or with no time budget left for another. Nothing was saved. |
| `Degenerated` | red | The same detector hit, with nothing left to fall back to. Nothing was saved. |
| `Escalated` | amber | A plain HTTP failure from that tier's own model (e.g. a removed model id returning 404). Skips the tier's remaining attempts, since re-asking a model that just 404'd is pointless. On the last tier there is nowhere to escalate, so the same failure ends the call and shows as `failed`. |
| `No response` | amber | A transient failure — a timeout or network error, HTTP 429, a 5xx, or a 200 carrying no content. Retried on the same model, or escalated once the tier's attempts are used up. Coming back in under 10 seconds *can* make the retry free — not counted against the tier's attempts — but only for the first few at each tier, and only with enough time budget left to try again; past that a fast failure costs an attempt like any other. |
| `Aborted` | amber | The chain stopped itself between attempts because the trial was aborted while it was still running server-side. |
| `truncated` | amber | Legacy only: shown *next to* a green `success` on historical rows recorded before truncation became a real failure. New trials never produce it. |

Truncation and degeneration are separate failures rather than nested ones — a capped response is usually coherent prose that simply got cut off, while a degenerate one finished naturally and produced unusable text. A repetition loop that runs until it hits the cap is both at once.

### Run history sidebar

One badge per trial, summarising the whole run.

| Badge | Colour | What triggered it |
| --- | --- | --- |
| `Completed` | green | Finished, with all 7 of 7 results saved. |
| `Completed — missing N of 7` | amber | Finished, but fewer than 7 results were saved: some agent's call failed for good (every tier or the time budget used up, a failure no retry can fix, or a judge reply with no `VERDICT` line), or never ran because its trigger request was rejected or never got through. |
| `Aborted` | grey | Stopped by the user before the trial reached completion. |
| `Aborted (N of 7 completed)` | grey | Stopped by the user, but the trial had already been marked complete — the count says how much survived. |
| `In progress…` | slate | Not finished, not aborted, and under 40 minutes old — presumably still running. |
| `Interrupted` | red | Not finished, not aborted, and over 40 minutes old, so it is treated as never going to finish — a dev-server restart mid-run, say, or the page closed before the judges were started (the browser starts each phase). The threshold is sized above the genuine worst case: a full four-tier escalation for every representative, then the same again for every judge — about 22 minutes. |

"Missing N" counts results that actually persisted, **not** whether any individual call ever failed along the way. A transient failure that the retry recovered from is a real logged attempt, not a flaw in the outcome — labelling the run on that basis would mark almost every trial as damaged. The call log still shows every attempt in full.

## Project layout

Every file tracked in the repository. Not tracked, and git-ignored: `node_modules/` and `.netlify/`, which are generated locally; `.env`, which holds your own keys (copied from `.env.example`); and logs and a few other local-only paths, listed in `.gitignore`.

```text
.
├── public/                           static frontend, served as-is — no build step
│   ├── index.html
│   ├── app.js                        all client logic: running and aborting a trial, polling, rendering, run history
│   └── styles.css
├── netlify/functions/                backend — one file per Netlify Function
│   ├── case.ts                       GET /api/case
│   ├── trials.ts                     GET and POST /api/trials
│   ├── trial.ts                      GET /api/trials/:id
│   ├── representative-background.ts  POST /api/trials/:id/representatives/:role
│   ├── judge-background.ts           POST /api/trials/:id/judges/:role
│   ├── abort.ts                      POST /api/trials/:id/abort
│   └── lib/                          code shared by the functions above
│       ├── openrouter.ts             the escalation chain: tiers, timeouts, detectors
│       ├── models.ts                 the model for each role and tier, and the token cap
│       ├── pricing.ts                per-token prices, for the cost column
│       ├── prompts.ts                builds each agent's prompt; parses a judge's verdict
│       ├── representatives.ts        the four representatives, in character
│       ├── judges.ts                 the three judges' reasoning methods
│       ├── chargeSheet.ts            reads the case record from the database; formats it for prompts
│       ├── db.ts                     every other Supabase query, the call cap, the abort check
│       ├── supabase.ts               the Supabase client (service-role key)
│       ├── siteGate.ts               the X-Site-Gate header check
│       ├── extractParams.ts          reads :id and :role from the request
│       ├── safeHandler.ts            turns an uncaught error into a JSON 500
│       ├── response.ts               JSON response helper
│       └── types.ts                  types shared across the backend
├── supabase/schema.sql               all six tables, the seeded case, RLS, grants
├── tests/                            npm test — no network, spends no quota
│   ├── retry-logic.test.js           the escalation chain, from the real TypeScript
│   ├── trial-status.test.js          when a trial is marked completed
│   ├── render-cards.test.js          app.js: cards, the call log, failed requests
│   ├── shared-constants.test.js      values duplicated across files still agree
│   ├── docs.test.js                  README, SPEC.md and CLAUDE.md agree with the code
│   └── support/                      setup shared by the suites above
│       ├── compile-backend.js        compiles the real backend TypeScript
│       ├── fake-supabase.js          an in-memory Supabase, for running the backend
│       └── load-app.js               runs the real app.js against a stub DOM
├── netlify.toml                      build and local-dev settings, and the /api/* routes
├── package.json, package-lock.json
├── tsconfig.json                     type-checks netlify/functions (not app.js)
├── .env.example                      every environment variable the backend reads
├── .gitignore
├── .vscode/settings.json             turns format-on-save off for this workspace
├── SPEC.md                           the requirements, from the course's Case Design Dossier
├── README.md
└── CLAUDE.md                         the working brief and full build/decision log
```

## Local development

Prerequisites: Node.js, a Supabase project, an OpenRouter API key.

Apply `supabase/schema.sql` to the Supabase project first — pasting it into the SQL Editor is enough. It creates the six tables, seeds the fixed case record, enables row-level security, and issues the grants the backend needs. All of that is required: without the grants at the bottom of that file, every backend call fails with `permission denied for table X` even though the key is correct.

```bash
npm install
cp .env.example .env   # fill in OPENROUTER_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
npm run dev             # netlify dev — serves the static frontend and functions locally
npm run typecheck       # tsc --noEmit
npm test                # five regression suites (see below)
```

`npm test` needs no network and spends no quota. Every suite runs the real source rather than a copy of it — the backend compiled from its TypeScript with the project's own `tsc`, and `app.js` executed against a stub DOM:

- `tests/retry-logic.test.js` — the escalation chain, driven against a mocked `fetch`.
- `tests/trial-status.test.js` — when a trial is marked completed, against an in-memory stand-in for Supabase, including the real judge endpoint end to end.
- `tests/render-cards.test.js` — `app.js`'s agent cards and call log, how it shortens model ids, and how it reports a request that fails outright.
- `tests/shared-constants.test.js` — values that are deliberately duplicated across files still agree.
- `tests/docs.test.js` — this README, `SPEC.md` and the requirement parts of `CLAUDE.md` still say what the code does. Every file, route, table, column, threshold, price and badge they describe is checked against its source, so changing one without the other fails the suite.

`netlify dev` costs no Netlify credits — it never touches the cloud build/deploy pipeline. It does reach the real OpenRouter API for any representative/judge call, so local testing still spends real quota.

## Tech stack

Netlify Functions (TypeScript, `esbuild` bundler) · Supabase (Postgres) · OpenRouter · vanilla HTML/CSS/JS on the frontend, no build step or framework.

## Project history and directing decisions

This project was built with Claude Code. `CLAUDE.md`, tracked in this repository, is the working brief and running status/decision log used throughout — the case content and requirements it was built against, every architectural decision and why, real bugs found and fixed (with root causes), and the reasoning behind UI/UX choices made along the way.

## Status

Feature-complete and stable. The full pipeline (four representatives in parallel, three judges after, independent rulings never combined) has been verified across many real end-to-end trials against real models, both locally and against the live deployed site. The reliability chain — tier escalation, degenerate-output detection, and recovery from truncated or transient failures — has been exercised repeatedly against the real OpenRouter API, including on the deployed site: one production trial caught a genuinely degenerate response, retried it on the same model, hit the token cap, escalated a tier, and finished cleanly, without anything being staged to provoke it. Five offline regression suites (`npm test`) drive the real shipped source for the same paths. All three anti-abuse layers are in place: the site-gate header is checked on every request that creates a trial or starts an agent call, and the site-wide call cap on every agent call — both are live, and each has been exercised directly. The third, per-IP rate limiting, is declared in each agent function's config and enforced by Netlify's own platform; it has never been tripped, so it is untested in production. A long round of frontend polish (layout, live status display, call log transparency, a responsive card view for narrow screens, cross-browser scrollbar/interaction details) is also done. Treated as done pending any further issue noticed on inspection, not as a hard, permanent freeze.

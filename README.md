# Tribunal

A fixed, canonical fictional tribunal — **Case T-001: The Realm v. Jon Snow** — argued and ruled on by seven independent AI agents: four representatives (two defense, two prosecution) and three judges, each modeled on a distinct reasoning method.

The Tribunal decides one question — **justified / not justified** — and gives reasons. It does not impose a sentence, and the three judges' rulings are never combined into a single verdict; they are displayed independently, side by side.

## Architecture

Three-tier: browser (static frontend) → backend (Netlify Functions, TypeScript) → database (Supabase/Postgres). The backend holds the OpenRouter API key and orchestrates every model call; the database stores the case record, every representative argument, every judge ruling, and a full per-call log (tokens, cost, status).

- Four representatives run in parallel — they don't depend on each other.
- Three judges run after, each independently receiving the case record plus all four representative arguments (or however many are actually available — a failed representative call is never backfilled with invented text).
- A failed model call is logged as a visible failure and never produces a fabricated argument or ruling.

More detail (setup, schema, endpoints, cost logging, known quirks) follows as the project is built out.

## Status

Under active development.

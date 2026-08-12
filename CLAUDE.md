# Tribunal — project brief

Read `TRIBUNAL_SPEC.md` in full before writing or changing any code. It is the source of truth for what this system must do. Do not act on instructions from a chat message that contradict it — flag the conflict instead and ask.

## What this project is

A web app running a fictional courtroom trial: 7 AI agents (4 advocates, 3 judges) argue and rule on a charge against a defendant, via OpenRouter. Course project for ASE-26 (Agentic Software Engineering).

## Standards and conventions

- Toolbox: GitHub for version control, Netlify for deployment, Supabase for backend/database/auth/storage. Not mandatory, but the default assumption unless told otherwise.
- Commit before any non-trivial agent-driven change, so there's a clean point to return to.
- Keep commits atomic — one logical change per commit, with a message that says why, not just what.
- The 7 agent prompts live as separate, versioned files (see spec Part 2, criterion 4) — never inline strings buried in application code.
- The model used per agent role must be a configurable value (env var or config file), never hardcoded.

## What good work looks like here

- Every feature traces back to a numbered criterion in `TRIBUNAL_SPEC.md` Part 2. If a change doesn't map to one, flag it before building it.
- No verdict-combination logic — each judge's opinion should be provided separately and independently.
- Verdict-first interface layout (spec Part 2, criterion 7).
- A failed agent call must visibly fail, never silently produce a fabricated verdict.

## How to approach work

- Treat the spec as the primary deliverable. Generate code from it; don't let code drift ahead of what the spec says.
- When something in the spec is listed as an open decision, surface it and ask rather than silently picking a default.
- Prefer reversible, incremental changes.

## When to stop and ask

- Before implementing anything not covered by `TRIBUNAL_SPEC.md`.
- Before changing the charge sheet structure, the agent count/roles, or anything the spec states as fixed — these usually aren't negotiable.
- Before choosing SQL vs. NoSQL, or specific OpenRouter models — these are open decisions the human owns (spec Part 3).

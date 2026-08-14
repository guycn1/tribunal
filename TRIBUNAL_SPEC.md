# Tribunal — Specification

**Course:** ASE-26 — Agentic Software Engineering

---

## Part 1 — The goal

**Build:** Tribunal, a web application that runs a fictional courtroom trial using seven AI agents — four advocates and three judges — arguing and ruling on a Game-of-Thrones-themed charge against a defendant.

---

## Part 2 — Testable success criteria

Each criterion below must be checkable by someone who did not build the system, per Knuth's effectiveness criterion (a person should be able to follow it with paper).

1. **Agent count and roles.** Exactly 7 agents run per trial: 4 advocates, 3 judges. Verify: the call log for any completed trial shows exactly 7 rows.
2. **No verdict combination.** The protocol reports the three verdicts side by side without combining them. There is no majority vote, no aggregation logic, no single "final ruling." Each verdict is one of exactly two values, `justified` or `not justified`. Verify: read the output schema — there must be no field representing a combined/aggregate verdict, only three independent judge verdicts.
3. **Charge sheet is a specification, not free text.** The charge sheet is written precisely as a specification, not free text. Verify: the charge sheet input is structured (named fields), not a single open text box.
4. **Seven prompts, versioned.** The seven agent prompts are written and versioned. Verify: each of the 7 prompts exists as its own tracked file with commit history showing changes over time.
5. **Progression from one model to several is visible.** The progression from one model toward several must be visible as far as it's carried. Verify: the model used per agent role is configurable (not hardcoded to one value), and commit history shows at least one point where a single shared model was used, and (if carried further) a point where roles used different models.
6. **Token/cost logging per call.** The database keeps a log of every model call — the model, the verdict, the tokens, the cost, the time. Verify: query the database for any trial and confirm each of the 7 calls has all five fields populated.
7. **Verdict-first interface.** The interface shows the verdict(s) before the reasoning/arguments. Verify: visually inspect the result screen — verdicts appear above arguments in the layout.
8. **Visible failure.** A failed or errored agent call must visibly look like a failure, never silently default to a verdict. Verify: force a call to fail (e.g., invalid API key) and confirm the UI shows an error state, not a fabricated verdict.

---

## Part 3 — Architectural guidance

Three-tier structure: **browser** (renders the charge sheet form and the result; holds no secrets), **backend** (holds the OpenRouter API key; orchestrates the 4 parallel advocate calls, then the 3 judge calls; writes to the database), **database** (stores charge sheets, opinions, and the full per-call log).

Recommended toolbox, not mandatory: Claude Code as the agentic development environment, GitHub for version control, Netlify for deployment, Supabase for backend/database/auth/storage.

Reach the models through OpenRouter's API. Leave interior implementation choices (file structure, specific functions, exact framework) open — this section states boundaries only, not design.

**Open boundary decisions, left to judgment:**
- SQL vs. NoSQL for the database
- Exact bad-input validation rules for the charge sheet
- Which specific free/cheap OpenRouter models get assigned to which agent role

---

## Part 4 — The validation approach

**Named test case:** submit one complete example trial (a defendant, an act, and a specific question) and confirm all 8 success criteria in Part 2 pass against that single run before considering any feature "done." A canonical test case: defendant Jon Snow, act "kills Daenerys," question "was it justified?" — defence advocates argue Jon Snow's side, prosecution advocates argue Daenerys's side.

Run against a live OpenRouter key, with the three judges each on a different model (`google/gemma-4-26b-a4b-it:free`, `openai/gpt-oss-20b:free`, `nvidia/nemotron-3-nano-30b-a3b:free`) and all four advocates sharing `DEFAULT_MODEL`. Result: judge_1 (`google/gemma-4-26b-a4b-it:free`) ruled `justified`; judge_3 (`nvidia/nemotron-3-nano-30b-a3b:free`) ruled `not justified`; judge_2 (`openai/gpt-oss-20b:free`) hit an upstream 429 from its provider and was logged as a visible failure — `verdict: null`, not a fabricated ruling — which happened to also confirm criterion 8 live. All 7 rows persisted correctly to the database with the model actually used, the verdict where one was reached, and populated tokens/cost. This exercised criteria 1, 2, 5, 6, and 8 against real model output in one run.

**Additional validation (verification before trust):** no agent output enters the project without passing a defined gate. At minimum: does the code run, does it produce the required output shape (7 calls, 3 independent verdicts, full log), and does a review of the diff make sense before it's committed.

**Self-check against self-confirming tests:** since agents may write tests that only confirm their own implementation, at least one validation step per major feature should be a manual check against Part 2's criteria, not solely a test the agent wrote and ran itself.

---

## Part 5 — Known pitfalls

- A judge call may return prose instead of a structured verdict — the parsing logic must handle this, not assume clean output every time.
- A model call may time out — the orchestration logic needs a defined behavior for this (visible failure, not silent default — see Part 2, criterion 8).
- A charge sheet may be submitted missing its question — validation must catch this before any agent calls are made, not after.
- **Do not build any verdict-combination logic.** No majority vote, no aggregation, no single final ruling.
- Prompt caching should be used for the charge sheet, since all 7 agents read the same input — but verify OpenRouter's actual response format for cached vs. non-cached token counts before assuming a particular field name.

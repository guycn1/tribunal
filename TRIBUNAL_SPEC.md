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

Run against a live OpenRouter key, with all four advocates sharing `DEFAULT_MODEL` (`nvidia/nemotron-3-nano-30b-a3b:free`) and the three judges each on a different NVIDIA-served model (`nvidia/nemotron-3-super-120b-a12b:free`, `nvidia/nemotron-3.5-lightning:free`, `nvidia/nemotron-nano-9b-v2:free`). Result: 7/7 calls succeeded — judge_1 ruled `justified`, judges 2 and 3 both ruled `not justified`. All 7 rows persisted correctly to the database with the model actually used and populated tokens/cost. This exercised criteria 1, 2, 5, and 6 against real model output in one run; criterion 8 was separately confirmed live in an earlier attempt at this same case, where a Google-served judge model 429'd and was correctly logged as a failure rather than a fabricated verdict (see Part 5).

**Additional validation (verification before trust):** no agent output enters the project without passing a defined gate. At minimum: does the code run, does it produce the required output shape (7 calls, 3 independent verdicts, full log), and does a review of the diff make sense before it's committed.

As of the automated gate added below, this minimum is now backed by a real, non-manual check: `npm test` runs an automated unit suite (`test/`, Node's built-in `node:test` runner — no new dependency) covering the two logic paths most likely to silently misbehave — charge sheet validation and judge-output parsing (`server/lib/orchestrate.js`), and cost computation for untracked models (`server/lib/pricing.js`). A GitHub Actions workflow (`.github/workflows/test.yml`) runs this suite on every push, so a broken build is visible on the repository itself rather than depending on someone remembering to run it locally. This covers pure logic only — it does not call OpenRouter live and does not replace the named live test case above.

**Self-check against self-confirming tests:** since agents may write tests that only confirm their own implementation, at least one validation step per major feature should be a manual check against Part 2's criteria, not solely a test the agent wrote and ran itself.

---

## Part 5 — Known pitfalls

- A judge call may return prose instead of a structured verdict — the parsing logic must handle this, not assume clean output every time.
- A model call may time out — the orchestration logic needs a defined behavior for this (visible failure, not silent default — see Part 2, criterion 8).
- A charge sheet may be submitted missing its question — validation must catch this before any agent calls are made, not after.
- **Do not build any verdict-combination logic.** No majority vote, no aggregation, no single final ruling.
- Prompt caching should be used for the charge sheet, since all 7 agents read the same input — but verify OpenRouter's actual response format for cached vs. non-cached token counts before assuming a particular field name.
- Google-served free models on OpenRouter (`gemma-4-31b-it:free`, then separately `gemma-4-26b-a4b-it:free`) have both 429'd from the shared Google AI Studio free pool, on two different days. NVIDIA-served free models have not failed once across many calls in this project so far. Not a guarantee either provider stays this way, but worth a fresh live check before assuming any specific free model — regardless of provider — is currently reliable.

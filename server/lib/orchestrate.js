// The core 7-agent workflow. Structure, per TRIBUNAL_SPEC.md:
//   1. Validate the charge sheet (Part 2, criterion 3)
//   2. Call the 4 advocates IN PARALLEL (they don't depend on each other)
//   3. Wait for all 4, then call the 3 judges (each receives all 4
//      advocate arguments — judges depend on advocate output)
//   4. Return the 3 verdicts SIDE BY SIDE, never combined
//      (this is a hard prohibition — see spec Part 5 for why)
//   5. Every call, successful or failed, is logged with tokens/cost

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { callModel } = require('./openrouter');
const { computeCost } = require('./pricing');
const { MODELS } = require('./models.config');
const { createTrial, logCall } = require('./db');

const PROMPTS_DIR = path.join(__dirname, '..', '..', 'prompts');

function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), 'utf-8');
}

const ADVOCATE_ROLES = ['advocate_for_1', 'advocate_for_2', 'advocate_against_1', 'advocate_against_2'];
const JUDGE_ROLES = ['judge_1', 'judge_2', 'judge_3'];

function validateChargeSheet({ defendant, act, question }) {
  const errors = [];
  if (!defendant || !defendant.trim()) errors.push('Defendant is required.');
  if (!act || !act.trim()) errors.push('Act is required.');
  if (!question || !question.trim()) errors.push('Question is required.');
  return errors;
}

async function runAgentCall({ trialId, role, model, systemPrompt, userMessage }) {
  try {
    const result = await callModel({ model, systemPrompt, userMessage });
    const cost = computeCost(model, result.promptTokens, result.completionTokens);

    logCall({
      trialId,
      agentRole: role,
      modelUsed: model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      cost,
      status: 'ok',
      outputText: result.text,
    });

    return { role, status: 'ok', text: result.text, model, tokens: result.totalTokens, cost };
  } catch (err) {
    // Visible failure, per spec Part 2 criterion 8 — never silently
    // fabricate a result. Logged with status 'error' so the audit
    // trail shows exactly what happened.
    logCall({
      trialId,
      agentRole: role,
      modelUsed: model,
      status: 'error',
      errorMessage: err.message,
    });
    return { role, status: 'error', error: err.message, model };
  }
}

function parseJudgeOutput(rawText) {
  // Judges are asked to return JSON, but per spec Part 5 pitfall,
  // a judge may return prose instead. Try to parse; fall back to
  // marking it unparsed rather than guessing at a verdict.
  try {
    const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/```$/, '');
    const parsed = JSON.parse(cleaned);
    if (parsed.verdict && parsed.reasoning) {
      return { parsed: true, verdict: parsed.verdict, reasoning: parsed.reasoning };
    }
    return { parsed: false, raw: rawText };
  } catch {
    return { parsed: false, raw: rawText };
  }
}

async function runTrial({ defendant, act, question }) {
  const errors = validateChargeSheet({ defendant, act, question });
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const trialId = randomUUID();
  createTrial({ id: trialId, defendant, act, question });

  const chargeSheetText = `Defendant: ${defendant}\nAct: ${act}\nQuestion for the tribunal: ${question}`;

  // Step 1: 4 advocates, in parallel.
  const advocateResults = await Promise.all(
    ADVOCATE_ROLES.map((role) =>
      runAgentCall({
        trialId,
        role,
        model: MODELS[role],
        systemPrompt: loadPrompt(role),
        userMessage: chargeSheetText,
      })
    )
  );

  const argumentsText = advocateResults
    .map((r) => {
      if (r.status === 'error') return `[${r.role}]: (this argument failed to generate — ${r.error})`;
      return `[${r.role}]: ${r.text}`;
    })
    .join('\n\n');

  const judgeUserMessage = `${chargeSheetText}\n\nArguments from the four advocates:\n\n${argumentsText}`;

  // Step 2: 3 judges, in parallel, each seeing all 4 arguments.
  const judgeResults = await Promise.all(
    JUDGE_ROLES.map((role) =>
      runAgentCall({
        trialId,
        role,
        model: MODELS[role],
        systemPrompt: loadPrompt(role),
        userMessage: judgeUserMessage,
      })
    )
  );

  // Step 3: parse each judge's output. Verdicts are returned SIDE BY
  // SIDE — no combination, no majority, no aggregate field. This is
  // a deliberate, spec-mandated omission. See TRIBUNAL_SPEC.md Part 5.
  const verdicts = judgeResults.map((r) => {
    if (r.status === 'error') {
      return { role: r.role, status: 'error', error: r.error };
    }
    const parsed = parseJudgeOutput(r.text);
    return { role: r.role, status: 'ok', model: r.model, ...parsed };
  });

  return {
    ok: true,
    trialId,
    chargeSheet: { defendant, act, question },
    arguments: advocateResults,
    verdicts, // three independent entries — never combined
  };
}

module.exports = { runTrial };

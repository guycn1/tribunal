/**
 * @file Regression tests for callOpenRouter()'s retry/escalation logic.
 *
 * Run with `npm test`. No framework, no dependencies, no network: the real
 * shipped TypeScript is compiled with the project's own tsc and exercised
 * against a mocked global.fetch, so these assert the actual source rather
 * than a hand-copied imitation of it.
 *
 * This file exists because this specific logic has now produced several
 * subtle, expensive bugs that only showed up in real use - an escalation
 * chain that silently never escalated, a timeout ceiling that ignored
 * prompt size, a degeneration check blind to its most common signature, a
 * fractional millisecond that would have crashed half of all real calls,
 * a fast-429 storm that escalated to a costlier tier within five seconds,
 * a backoff pause timed as part of the attempt before it, a three-copy
 * loop the repeated-sentence check let through, near-verbatim loops that no
 * exact comparison could see, and an attempt that failed as the user
 * aborted logged as "re-tried" when no retry followed. Each one below is a
 * test, so none of them can quietly come back.
 */

const { compileBackend } = require('./support/compile-backend');

const backend = compileBackend(['lib/openrouter.ts']);
process.env.OPENROUTER_API_KEY = 'test-key';
const { callOpenRouter, finishedAfterAbort } = backend.load('lib/openrouter.js');

/** Tier 1 of the escalation chain - the default, and cheapest, model. */
const DEFAULT = 'mistralai/mistral-small-24b-instruct-2501';
/** Tier 2 - the first fallback. */
const TIER2 = 'anthropic/claude-haiku-4.5';
/** Tier 3 - the second fallback. */
const TIER3 = 'openai/gpt-5.6-sol';

// Quiet the real console.log/warn chatter from the module under test; a
// failing check prints everything it needs on its own.
const realLog = console.log;
const realWarn = console.warn;
const captured = [];
console.log = (...a) => captured.push(a.join(' '));
console.warn = (...a) => captured.push(a.join(' '));
/**
 * Prints to the real console, which the capture above no longer reaches.
 * @param {...unknown} a
 */
const say = (...a) => realLog(...a);

let failures = 0;
/**
 * Records and prints one assertion. A failure is counted rather than thrown,
 * so every check in the file runs and reports.
 *
 * @param {string} name
 * @param {unknown} condition Truthy to pass.
 * @param {unknown} [detail] Printed after a failure, to show what was
 *   actually found.
 */
function check(name, condition, detail) {
  if (condition) say(`  PASS  ${name}`);
  else {
    failures++;
    say(`  FAIL  ${name}${detail !== undefined ? ` :: ${detail}` : ''}`);
  }
}
/**
 * Runs one named scenario, clearing the captured console output first so the
 * scenario's log lines are its own.
 *
 * @param {string} name
 * @param {() => Promise<void>} fn
 * @returns {Promise<void>}
 */
async function test(name, fn) {
  say(`\n=== ${name} ===`);
  captured.length = 0;
  await fn();
}

/**
 * The parts of a fetch Response that callOpenRouter() reads.
 * @typedef {object} MockResponse
 * @property {boolean} ok
 * @property {number} status
 * @property {Map<string, string>} headers
 * @property {() => Promise<object>} [json]
 * @property {() => Promise<string>} [text]
 */
/**
 * Builds a successful chat-completion response from OpenRouter.
 *
 * @param {string} model
 * @param {string} content
 * @param {string} [finishReason='stop'] 'length' simulates a truncation.
 * @param {number} [completionTokens=400]
 * @returns {MockResponse}
 */
function reply(model, content, finishReason = 'stop', completionTokens = 400) {
  return {
    ok: true, status: 200, headers: new Map(),
    json: async () => ({
      model,
      choices: [{ message: { content }, finish_reason: finishReason }],
      usage: { prompt_tokens: 1000, completion_tokens: completionTokens, total_tokens: 1000 + completionTokens },
    }),
  };
}
/**
 * An HTTP 429 - OpenRouter rate-limiting the request.
 * @returns {MockResponse}
 */
const rateLimited = () => ({ ok: false, status: 429, headers: new Map(), text: async () => '{}' });
/**
 * An HTTP 404 in the shape OpenRouter returns for a model id it no longer
 * serves.
 * @param {string} model
 * @returns {MockResponse}
 */
const notFound = (model) => ({ ok: false, status: 404, headers: new Map(), text: async () => JSON.stringify({ error: { message: `No endpoints found for ${model}.` } }) });
/**
 * Throws the error AbortSignal.timeout() produces when an attempt outlives
 * its ceiling.
 * @throws {Error} Always, named 'TimeoutError'.
 * @returns {never}
 */
function throwTimeout() {
  const e = new Error('The operation was aborted due to timeout');
  e.name = 'TimeoutError';
  throw e;
}
/** A short, well-formed argument that no degeneration check should flag. */
const CLEAN = 'The bells had already rung when she turned the dragon on the city. That is the fact this tribunal cannot reason past.';

/**
 * Runs every scenario in order, then restores the console, deletes the
 * compiled output, and exits non-zero if any check failed.
 * @returns {Promise<void>}
 */
async function main() {
  // ------------------------------------------------------------------ 1
  await test('A sentence repeated many times is caught as degeneration', async () => {
    // The real shape of the miss: short, fully punctuated, repeated verbatim.
    // The older run-length check cannot see this at all.
    const degenerate = 'I was wrong about the realm. ' + 'I can only tell you that I was wrong, and I am sorry. '.repeat(8);
    const calls = [];
    global.fetch = async (_u, o) => {
      const m = JSON.parse(o.body).model;
      calls.push(m);
      return m === DEFAULT ? reply(m, degenerate) : reply(m, CLEAN);
    };
    const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'x'.repeat(4000) }], 1400, 'rep:test');
    check('did not accept the looping response', r.content !== degenerate, 'accepted a degenerate response');
    check('spent both tier-1 attempts before escalating', calls[0] === DEFAULT && calls[1] === DEFAULT, JSON.stringify(calls));
    check('escalated and returned a clean result', r.status === 'success' && r.model === TIER2, `${r.status}/${r.model}`);
    // Discarded text is kept for audit - see DiscardedAttempt.responseText.
    const discarded = r.discardedAttempts || [];
    check('each discarded reply is kept word for word', discarded.length === 2 && discarded.every((d) => d.responseText === degenerate), discarded.map((d) => typeof d.responseText).join(', '));
    check('and the kept reply is returned for the log as well', r.responseText === CLEAN, r.responseText);
  });

  // ------------------------------------------------------------------ 2
  await test('Deliberate anaphora is NOT mistaken for degeneration', async () => {
    // Real anaphora repeats an opening and continues differently, so the
    // whole sentences differ. The abandoned 5-word-phrase heuristic used to
    // false-positive on exactly this.
    const anaphora = [
      'I ask you to consider the scale of the harm.',
      'I ask you to consider the alternatives he had.',
      'I ask you to consider his lack of any authority.',
      'I ask you to consider what he actually knew that day.',
      'I ask you to consider the bells over a surrendered city.',
    ].join(' ');
    const calls = [];
    global.fetch = async (_u, o) => { calls.push(JSON.parse(o.body).model); return reply(DEFAULT, anaphora); };
    const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'rep:test');
    check('accepted first time, no escalation', calls.length === 1 && r.status === 'success', JSON.stringify(calls));
  });

  // ------------------------------------------------------------------ 2b
  await test('Shorter verbatim loops are caught, and the pattern just short of each is not', async () => {
    /**
     * What the first attempt's reply gets logged as, or null if it was kept.
     * @param {string} content
     * @returns {Promise<string | null>}
     */
    const verdict = async (content) => {
      global.fetch = async (_u, o) => { const m = JSON.parse(o.body).model; return reply(m, m === DEFAULT ? content : CLEAN); };
      const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'rep:test');
      return r.discardedAttempts && r.discardedAttempts.length ? r.discardedAttempts[0].errorMessage : null;
    };
    /**
     * A filler sentence sharing no word with any other, so copies can be
     * kept apart without the fillers looking like near-copies themselves.
     * @param {number} i
     * @returns {string}
     */
    const filler = (i) => `Note${i}a note${i}b note${i}c note${i}d note${i}e note${i}f note${i}g note${i}h.`;
    const SHORT = 'He had no lawful authority to act.';
    // Exactly at the long-sentence minimum (18 words), and one word under.
    const LONG = 'He had seen the city burn after the bells rang and he knew that she would not stop.';
    const LONG_LESS_ONE = 'He had seen the city burn after the bells rang and he knew she would not stop.';

    // The 2026-09-26 miss, word for word: three copies back to back, a
    // fourth differing by one word ("Jon Snow's" for "his").
    const closing = 'I ask the Tribunal to consider these words, and to consider the facts of the case. I ask the Tribunal to consider whether Jon Snow\'s actions were justified, and I ask the Tribunal to consider whether his actions were necessary. ' + 'I ask the Tribunal to consider whether his actions were justified, and I ask the Tribunal to consider whether his actions were necessary. '.repeat(3);
    const missed = await verdict(closing);
    check('the looped closing that got through is now caught', missed !== null && /3 times in a row \(sentences 3-5 of 5\)/.test(missed), missed);

    const twiceInARow = await verdict(`${filler(1)} ${SHORT} ${SHORT} ${filler(2)}`);
    check('a sentence twice in a row is caught', twiceInARow !== null && /2 times in a row/.test(twiceInARow), twiceInARow);
    check('the same short sentence twice apart is not', (await verdict(`${SHORT} ${filler(1)} ${SHORT}`)) === null);

    const threeApart = await verdict(`${SHORT} ${filler(1)} ${SHORT} ${filler(2)} ${SHORT}`);
    check('a short sentence 3 times apart is caught', threeApart !== null && /same sentence 3 times/.test(threeApart), threeApart);

    const longTwice = await verdict(`${LONG} ${filler(1)} ${filler(2)} ${LONG}`);
    check('a long sentence twice apart is caught', longTwice !== null && /an 18-word sentence 2 times \(sentences 1 and 4 of 4\)/.test(longTwice), longTwice);
    check('a 17-word sentence twice apart is not', (await verdict(`${LONG_LESS_ONE} ${filler(1)} ${filler(2)} ${LONG_LESS_ONE}`)) === null);
    check('a 4-word sentence repeated back to back is not (too short to count)', (await verdict('I agree with him. I agree with him. I agree with him. ' + filler(1))) === null);

    const passage = [filler(1), filler(2), filler(3)].join(' ');
    const repeatedPassage = await verdict(`${passage} ${filler(4)} ${passage}`);
    check('a 3-sentence passage repeated later is caught', repeatedPassage !== null && /3-sentence passage word for word \(sentences 1-3 and 5-7 of 7\)/.test(repeatedPassage), repeatedPassage);
    // Two sentences repeated are short of the verbatim-passage rule's 3, and
    // are the near-copy passage rule's to catch instead (see 2c).
    const twoSentencePassage = await verdict(`${filler(1)} ${filler(2)} ${filler(3)} ${filler(1)} ${filler(2)}`);
    check('a 2-sentence passage repeated later is not named by the 3-sentence rule', twoSentencePassage === null || !/passage word for word/.test(twoSentencePassage), twoSentencePassage);

    // Loops that never end a sentence, only a clause. Both are stored
    // replies the sentence rules passed: a grey_worm reply (2026-08-29)
    // looping one clause between commas, and a daenerys_targaryen closing
    // saved as a success (2026-09-20), word for word.
    const commaLoop = await verdict('He was a man who had seen the destruction she would choose to cause, ' + 'and who had seen the destruction she would choose to cause, '.repeat(6));
    check('a clause looped between commas is caught', commaLoop !== null && /same clause 6 times in a row \(clauses 2-7 of 7\)/.test(commaLoop), commaLoop);
    const loopedClosing = await verdict(`${filler(1)} I ask the Tribunal to consider the truth, and to render a verdict that reflects the reality of what happened in that throne room. I ask the Tribunal to consider the truth, and to render a verdict that reflects the reality of what happened in that throne room, and to consider the truth, and to render a verdict that reflects the reality of what happened in that throne room.`);
    check('the looped closing saved on 2026-09-20 is now caught', loopedClosing !== null && /a 16-word clause 3 times close together \(clauses 3, 5 and 7 of 7\)/.test(loopedClosing), loopedClosing);
    // Three copies of a clause, each in a different sentence, so no
    // sentence rule can fire.
    const CLAUSE6 = 'she would never stop the burning';
    // Each copy ends differently enough that the sentences are not
    // near-copies of each other, so only the clause rules are in play.
    const TAIL = ['alpha bravo charlie delta echo foxtrot', 'golf hotel india juliet kilo lima', 'mike november oscar papa quebec romeo'];
    const close = await verdict(`${CLAUSE6}, ${TAIL[0]}. ${filler(1)} ${CLAUSE6}, ${TAIL[1]}. ${filler(2)} ${CLAUSE6}, ${TAIL[2]}.`);
    check('a 6-word clause 3 times within 6 clauses is caught', close !== null && /a 6-word clause 3 times close together \(clauses 1, 4 and 7 of 8\)/.test(close), close);
    check('the same 3 copies spread one clause wider are not', (await verdict(`${CLAUSE6}, ${TAIL[0]}. ${filler(1)} ${CLAUSE6}, ${TAIL[1]}. ${filler(2)} ${filler(3)} ${CLAUSE6}, ${TAIL[2]}.`)) === null);
    check('a 5-word clause 3 times close together is not', (await verdict('she would never stop burning, then one. she would never stop burning, then two. she would never stop burning, then three.')) === null);
    check('a clause twice close together is not', (await verdict(`${CLAUSE6}, ${TAIL[0]}. ${filler(1)} ${CLAUSE6}, ${TAIL[1]}.`)) === null);
    check('a 4-word clause twice in a row is not', (await verdict(`${filler(1)} He saw the fire, he saw the fire, and he acted. ${filler(2)}`)) === null);
  });

  // ------------------------------------------------------------------ 2c
  await test('Near-verbatim loops are caught, by passage and by closing', async () => {
    // Two replies saved as successes before these rules existed, word for
    // word: a daenerys_targaryen closing that reshuffles the paragraph
    // before it (trial 5bb8f477, 2026-09-27), and a grey_worm reply that
    // re-emits two sentences almost verbatim (trial 7520a32c, 2026-09-04).
    const DANY_5BB8F477 = "Honorable Tribunal, I stand before you not merely as a victim, but as a voice from beyond the grave, compelled to speak the truth as I see it. I, Daenerys Targaryen, First of My Name, The Unburnt, Queen of the Andals and the First Men, Khaleesi of the Great Grass Sea, Breaker of Chains, and Mother of Dragons, address you with the same fire that once burned in my veins.\n\nThe facts are clear: I was slain by Jon Snow, a man I loved and trusted. He stabbed me in the throne room, a place where I had hoped to rule with wisdom and justice. But let us not forget the context in which this act occurred. I had just liberated King's Landing from the tyranny of Cersei Lannister. The bells rang, the city surrendered, and yet, I was met with betrayal.\n\nJon witnessed the destruction wrought by Drogon and my forces. He saw the streets burn, the people suffer, and he heard my declaration that our campaign of liberation would continue. He knew the scale of the harm I was prepared to inflict. He knew the fear and despair I had caused, and he knew that I would not hesitate to do it again. He knew the threat I posed to his sisters, to his friends, and to the realm.\n\nBut did Jon have the right to take my life? Did he have the right to decide that I was a threat that needed to be eliminated? I say no. I say that he had no right to take the throne from me, to take my life, to take my dragons, and to take my legacy.\n\nJon had alternatives. He could have convened a council, sought a public surrender of power, or even attempted to detain me. He could have tried to reason with me, to persuade me to change my ways. But he chose to take the easy way out, to take the life of a woman who had fought for her people, who had freed the enslaved, and who had brought dragons back to Westeros.\n\nI do not deny that I was a threat. I was a threat to those who would stand in the way of my rule, to those who would seek to undermine my authority. But I was also a threat to the tyranny and oppression that had plagued Westeros for so long. I was a threat to the status quo, to the entrenched cruelty that had held the realm in its grip for generations.\n\nI was not a perfect ruler, but I was a ruler. I was a ruler who had fought for her people, who had sacrificed everything for them, and who had given them hope. I was a ruler who had earned her throne, who had earned her dragons, and who had earned her legacy. And I was a ruler who was betrayed by the man she loved.\n\nI ask the Tribunal to consider these things. I ask you to consider the context, the alternatives, and the consequences. I ask you to consider the legacy of a woman who fought for her people, who freed the enslaved, and who brought dragons back to Westeros. And I ask you to consider the legacy of a man who betrayed her, who took her life, and who took her throne.\n\nI ask you to consider the legacy of a woman who was betrayed, who was killed, and who was silenced. I ask you to consider the legacy of a woman who was a threat, who was a liberator, and who was a ruler. And I ask you to consider the legacy of a man who was a friend, who was a lover, and who was a killer.\n\nI ask you to consider the legacy of a woman who was Daenerys Targaryen, and I ask you to consider the legacy of a man who was Jon Snow. And I ask you to consider the legacy of a realm that was torn apart by their actions, by their betrayals, and by their deaths.\n\nI ask you to consider the legacy of a realm that was torn apart by the actions of a man who was a friend, who was a lover, and who was a killer. And I ask you to consider the legacy of a realm that was torn apart by the actions of a woman who was a threat, who was a liberator, and who was a ruler.";
    const GREY_7520A32C = "Honorable Tribunal,\n\nI stand before you today to present the facts as they are, not as some might wish them to be. I speak of what I saw, what I heard, and what I know to be true.\n\nDaenerys Targaryen, my queen, my commander, burned King's Landing to the ground. The city had surrendered, the bells had rung, and still, she ordered Drogon to rain fire upon the streets. I was there, on the ground, and I saw the destruction. I followed her orders, and I know the scale of the harm she was willing to inflict.\n\nJon Snow saw it too. He saw the city burn, he heard her promise to continue her campaign of \"liberation,\" and he knew that Tyrion Lannister, her own Hand, had resigned in protest and been imprisoned. Tyrion warned Jon that Daenerys would treat anyone she saw as an obstacle as an enemy. Jon knew the threat was real. He knew that Daenerys would not stop at King's Landing.\n\nJon had a choice. He could have stood by and done nothing, allowing Daenerys to continue her reign of terror. He could have tried to reason with her, but he had already seen that she would not listen. He could have tried to convene a council or attempt detention, but Daenerys would not have allowed it. She had made it clear that her judgment was final.\n\nJon chose to act. He used his intimacy with Daenerys to get close enough to strike. He did not have formal authority, but he had seen the threat, he had heard the warning, and he had acted to stop it. He had no other choice.\n\nThe Tribunal must decide if Jon Snow's actions were justified. I say they were. Jon knew the threat, he knew the harm that Daenerys was willing to inflict, and he knew that there were no safer alternatives. He acted to defend others and to defend the realm. He did what he had to do.\n\nI do not speak of motives or speculations. I speak of facts. I speak of what I saw, what I heard, and what I know to be true. Jon Snow's actions were justified. He acted to defend others and to defend the realm. He did what he had to do.";
    /**
     * What the first attempt's reply gets logged as, or null if it was kept.
     * @param {string} content
     * @returns {Promise<string | null>}
     */
    const firstReason = async (content) => {
      global.fetch = async (_u, o) => { const m = JSON.parse(o.body).model; return reply(m, m === DEFAULT ? content : CLEAN); };
      const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'rep:test');
      return r.discardedAttempts && r.discardedAttempts.length ? r.discardedAttempts[0].errorMessage : null;
    };
    const closing = await firstReason(DANY_5BB8F477);
    check('the reshuffled closing is caught by the closing rule', closing !== null && /closed on a near-copy of a sentence just before it \(sentences 35 and 38 of 39\)/.test(closing), closing);
    const passage = await firstReason(GREY_7520A32C);
    check('the re-emitted pair is caught by the passage rule', passage !== null && /repeated a 2-sentence passage almost word for word \(sentences 24-25 and 30-31 of 31\)/.test(passage), passage);
  });

  // ------------------------------------------------------------------ 3
  await test('Repeated slow timeouts escalate instead of looping at one tier', async () => {
    // The six-minute stall: every transient failure used to retry the same
    // model without ever consuming a tier attempt.
    const calls = [];
    const starts = [];
    const realNow = Date.now;
    let skew = 0;
    Date.now = () => realNow() + skew;
    global.fetch = async (_u, o) => {
      const m = JSON.parse(o.body).model;
      calls.push(m);
      if (m === DEFAULT || m === TIER2) { skew += 45000; throwTimeout(); }
      return reply(m, CLEAN);
    };
    const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'x'.repeat(18000) }], 1400, 'judge:test', undefined, (i) => starts.push(i));
    Date.now = realNow;
    check('tier 1 got exactly its 2 attempts', calls.filter((m) => m === DEFAULT).length === 2, String(calls.filter((m) => m === DEFAULT).length));
    check('tier 2 got exactly its 2 attempts', calls.filter((m) => m === TIER2).length === 2, String(calls.filter((m) => m === TIER2).length));
    check('reached tier 3 and succeeded', r.status === 'success' && r.model === TIER3, `${r.status}/${r.model}`);
    check('attempt counter advances (no permanent "first attempt")', starts.some((s) => s.attemptInTier === 2), JSON.stringify(starts.map((s) => s.attemptInTier)));
    check('every discarded attempt is visible in the log', (r.discardedAttempts || []).length === 4, String((r.discardedAttempts || []).length));
  });

  // ------------------------------------------------------------------ 4
  await test('Fast 429 bounces do NOT burn tier attempts', async () => {
    // The over-correction: two burst 429s (2.3s and 2.9s in the real trial)
    // consumed tier 1 entirely and escalated to a costlier tier in ~5 seconds.
    // (Every tier here is a paid model; tier 1 is simply the cheapest by far.)
    const calls = [];
    global.fetch = async (_u, o) => {
      const m = JSON.parse(o.body).model;
      calls.push(m);
      return m === DEFAULT && calls.filter((c) => c === DEFAULT).length <= 2 ? rateLimited() : reply(m, CLEAN);
    };
    const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'rep:test');
    check('stayed on the cheap default model', r.model === DEFAULT, r.model);
    check('never escalated to a costlier tier', !calls.includes(TIER2), JSON.stringify(calls));
    check('succeeded once the burst cleared', r.status === 'success', r.status);
    check('the 429s are still logged', (r.discardedAttempts || []).length === 2, String((r.discardedAttempts || []).length));
    check('logged as not counted against the tier', (r.discardedAttempts || []).every((d) => /not counted against it/.test(d.errorMessage)), (r.discardedAttempts || [])[0]?.errorMessage);
    // These 429s come back instantly, so each logged duration should be close
    // to zero. The backoff pause after one is at least 800ms, and it used to
    // be timed as part of the attempt - which also made a failure need to
    // return in about 8s, not 10, to count as fast.
    check('each logged duration is the attempt alone, not the pause after it', (r.discardedAttempts || []).every((d) => d.durationMs < 400), (r.discardedAttempts || []).map((d) => d.durationMs).join(', '));
  });

  // ------------------------------------------------------------------ 5
  await test('A tier that is rate limited forever still escalates (fast path is bounded)', async () => {
    const calls = [];
    global.fetch = async (_u, o) => {
      const m = JSON.parse(o.body).model;
      calls.push(m);
      return m === DEFAULT ? rateLimited() : reply(m, CLEAN);
    };
    const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'rep:test');
    const n = calls.filter((c) => c === DEFAULT).length;
    check('was patient with the cheap model', n > 2, String(n));
    check('but bounded - did not loop forever', n <= 7, String(n));
    check('escalated and succeeded', r.status === 'success' && calls.includes(TIER2), `${r.status}/${JSON.stringify(calls.slice(-2))}`);
  });

  // ------------------------------------------------------------------ 6
  await test('A removed model id is skipped after exactly one attempt', async () => {
    const calls = [];
    global.fetch = async (_u, o) => {
      const m = JSON.parse(o.body).model;
      calls.push(m);
      if (m === DEFAULT) return reply(m, 'cut off mid-', 'length', 1400);
      if (m === TIER2) return notFound(m);
      return reply(m, CLEAN);
    };
    const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'rep:test');
    check('only one call wasted on the dead model', calls.filter((c) => c === TIER2).length === 1, String(calls.filter((c) => c === TIER2).length));
    check('succeeded at the next tier', r.status === 'success' && r.model === TIER3, `${r.status}/${r.model}`);
  });

  // ------------------------------------------------------------------ 7
  await test('Per-attempt timeout scales with prompt size, and is always an integer', async () => {
    // AbortSignal.timeout() throws on a non-integer, which would fail any
    // call whose estimated prompt token count is odd.
    const timeouts = [];
    global.fetch = async (_u, o) => { return reply(JSON.parse(o.body).model, CLEAN); };
    for (const [label, chars] of [['rep', 4120], ['judge', 18200], ['odd', 4001]]) {
      captured.length = 0;
      await callOpenRouter(DEFAULT, [{ role: 'user', content: 'x'.repeat(chars) }], 1400, `${label}:t`);
      const line = captured.find((l) => l.includes(`${label}:t`) && l.includes('timeout='));
      // [\d.]+, not \d+: a fractional timeout is exactly what the integer
      // check below exists to catch, so it must parse rather than crash.
      timeouts.push(Number(line.match(/timeout=([\d.]+)ms/)[1]));
    }
    const [rep, judge, odd] = timeouts;
    check('a judge prompt gets a larger ceiling than a representative', judge > rep + 5000, `${rep} vs ${judge}`);
    check('the judge ceiling clears the real 43.2s worst case', judge > 53000, String(judge));
    check('an odd token estimate still yields an integer', Number.isInteger(odd), String(odd));
  });

  // ------------------------------------------------------------------ 8
  await test('Abort stops the chain rather than spending more', async () => {
    const calls = [];
    let userAborted = false;
    global.fetch = async (_u, o) => { calls.push(JSON.parse(o.body).model); userAborted = true; throwTimeout(); };
    const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'judge:test', undefined, undefined, () => userAborted);
    check('made no further attempt after the abort', calls.length === 1, JSON.stringify(calls));
    check('reported as an abort, not a generic failure', r.status === 'failed' && r.errorMessage.startsWith('[aborted-mid-call]'), r.errorMessage);
    check('never reached a costlier tier', !calls.includes(TIER2), JSON.stringify(calls));
  });

  // ------------------------------------------------------------------ 8b
  await test('An abort during a run gives the call log one honest last row', async () => {
    // Trial a02b8215 (2026-09-21): aborted 4s in, while all four attempts
    // were generating. Two ran into the token cap after the abort and were
    // logged "re-tried with the same model" - a retry that never happened -
    // followed by a "Stopped before attempt 2" row carrying the previous
    // attempt's duration again.
    const TRUNCATED = 'He had seen the city burn and '.repeat(40);
    let userAborted = false;
    let calls = 0;
    global.fetch = async () => { calls++; userAborted = true; return reply(DEFAULT, TRUNCATED, 'length', 1400); };
    const cut = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'rep:test', undefined, undefined, () => userAborted);
    check('an attempt failing as the abort lands is not logged as re-tried', (cut.discardedAttempts || []).length === 0, JSON.stringify(cut.discardedAttempts));
    check('it is the call\'s one final row, saying it was not retried', cut.status === 'failed' && /^\[aborted-mid-call\] This attempt hit the max_tokens limit.*Not retried: the user aborted this trial/.test(cut.errorMessage), cut.errorMessage);
    check('and it keeps the attempt\'s real tokens, cost and reply', cut.completionTokens === 1400 && cut.cost > 0 && cut.responseText === TRUNCATED, `${cut.completionTokens} / ${cut.cost}`);
    check('with the attempt\'s own duration', typeof cut.durationMs === 'number', String(cut.durationMs));
    check('and no second request is made', calls === 1, String(calls));

    // A transient failure as the abort lands reads the same way.
    userAborted = false;
    global.fetch = async () => { userAborted = true; return rateLimited(); };
    const limited = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'rep:test', undefined, undefined, () => userAborted);
    check('a rate limit as the abort lands is not retried either', (limited.discardedAttempts || []).length === 0 && /^\[aborted-mid-call\] This attempt was rate limited \(HTTP 429\)\. Not retried/.test(limited.errorMessage), limited.errorMessage);
    // Every other failure an attempt can end in, the same way.
    const endings = {
      'a timeout': () => throwTimeout(),
      'an upstream 5xx': () => ({ ok: false, status: 503, headers: new Map(), text: async () => '{}' }),
      'a removed model': () => notFound(DEFAULT),
      'an empty reply': () => reply(DEFAULT, ''),
    };
    for (const [what, respond] of Object.entries(endings)) {
      userAborted = false;
      global.fetch = async () => { userAborted = true; return respond(); };
      const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'rep:test', undefined, undefined, () => userAborted);
      check(`${what} as the abort lands is not retried either`, (r.discardedAttempts || []).length === 0 && /^\[aborted-mid-call\] This attempt .*\. Not retried/.test(r.errorMessage), r.errorMessage);
    }

    // Stopping before any attempt is not an attempt: no duration, no tokens.
    calls = 0;
    global.fetch = async () => { calls++; return reply(DEFAULT, CLEAN); };
    const before = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'rep:test', undefined, undefined, () => true);
    check('a call aborted before its first attempt sends nothing', calls === 0, String(calls));
    check('and its row has no duration and no tokens', before.durationMs === undefined && before.totalTokens === 0 && /Stopped before attempt 1/.test(before.errorMessage), `${before.durationMs} / ${before.totalTokens}`);

    // A reply that finished after the abort: logged as aborted, not success.
    const done = finishedAfterAbort({ status: 'success', content: CLEAN, responseText: CLEAN, model: DEFAULT, promptTokens: 1000, completionTokens: 400, totalTokens: 1400, cost: 0.0001, durationMs: 9000 });
    check('a reply finished after the abort is not a success', done.status === 'failed' && done.content === undefined && /^\[aborted-mid-call\] Finished after the user aborted this trial/.test(done.errorMessage), done.errorMessage);
    check('but keeps what it cost', done.completionTokens === 400 && done.cost === 0.0001 && done.durationMs === 9000 && done.responseText === CLEAN);
    const failedAlready = { status: 'failed', model: DEFAULT, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, errorMessage: 'OpenRouter account is out of credits (HTTP 402): x', durationMs: 100 };
    check('a result that already failed is left as it is', finishedAfterAbort(failedAlready) === failedAlready);
  });

  // ------------------------------------------------------------------ 9
  await test('When everything fails, the failure is honest about it', async () => {
    global.fetch = async () => throwTimeout();
    const r = await callOpenRouter(DEFAULT, [{ role: 'user', content: 'hi' }], 1400, 'rep:test');
    check('terminal failure', r.status === 'failed', r.status);
    check('says every tier was tried', /Every model tier was tried/.test(r.errorMessage), r.errorMessage);
  });

  console.log = realLog;
  console.warn = realWarn;
  backend.cleanup();
  say(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.log = realLog;
  console.warn = realWarn;
  say('SUITE ERROR:', e);
  process.exit(1);
});

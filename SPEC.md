# Tribunal — Specification

**Case T-001: The Realm v. Jon Snow.** A fixed, canonical trial — not a general-purpose "submit any charge" tool — argued and ruled on by seven independent AI agents: four representatives (two defense, two prosecution) and three judges, each modeled on a distinct real judicial reasoning method. This is the ASE course's shared "running project": every submission implements the same fixed specification, graded on directing discipline shown, not on the artifact alone.

This document is the functional/requirements spec, sourced from the ASE Book "Case Design Dossier." For how this particular submission implements it (architecture, live deployment, setup) see `README.md`; for the full build history and every engineering decision behind it, see `CLAUDE.md`.

## 1. The charge sheet

**Accused:** Jon Snow · **Deceased:** Daenerys Targaryen · **Act alleged:** Jon intentionally killed Daenerys by stabbing her during a private meeting in the throne room after the fall of King's Landing.

This section is the case exactly as the app serves it — word for word the record seeded into the database by `supabase/schema.sql`. The stipulated facts in particular are quoted, not paraphrased: they are what both sides accept, and a restatement can shift what was agreed.

**Background.**

The story takes place mainly in Westeros. Jon Snow grows up believing he is the illegitimate son of Lord Eddard Stark; he becomes a military commander, then King in the North, and later learns he is the lawful son of Rhaegar Targaryen and Lyanna Stark — giving him a stronger hereditary claim to the throne than Daenerys, though he does not want to rule.

Daenerys Targaryen is the exiled heir of the dynasty that once ruled Westeros. She survives abuse, gains three dragons, frees enslaved people, and builds an army — becoming both liberator and increasingly absolute ruler. Jon and Daenerys become allies and lovers while fighting the Night King. After defeating the dead, Daenerys turns to the Iron Throne; Jon's hidden parentage weakens her political claim and feeds her fear of betrayal.

Daenerys attacks King's Landing. The city surrenders, but Daenerys burns streets and civilians from her dragon, Drogon. Jon witnesses the destruction. Grey Worm, her commander, joins the killing on the ground. Daenerys promises further campaigns of "liberation." Tyrion Lannister, her chief adviser, resigns in protest and is imprisoned, warning Jon that Daenerys will kill anyone who threatens her rule, including Jon's sisters. Jon asks Daenerys to show mercy and share moral judgment with others. She refuses. During an embrace, he stabs her to death. Her soldiers arrest him.

**Stipulated facts (both sides accept these):**
- King's Landing had surrendered: bells rang, organized resistance had ceased. Daenerys then used Drogon against streets and civilians, causing destruction on a vast scale.
- After the victory, Daenerys told her assembled forces the campaign of "liberation" would continue beyond King's Landing. Jon had seen the city and heard the speech.
- Tyrion Lannister renounced his office as Hand and was imprisoned. He warned Jon that Daenerys would treat Jon's sisters, and anyone else she regarded as an obstacle, as enemies.
- Jon asked Daenerys to forgive Tyrion and show mercy. She refused to let others choose what was good and presented her own judgment as decisive.
- Daenerys was unarmed and was not attacking Jon when he killed her. Jon used their intimacy to get close enough to strike. He had not convened a council, attempted detention, or sought a public surrender of power.

**Question for judgment:** *Was Jon Snow's intentional killing of Daenerys Targaryen justified as the necessary defense of others and of the realm, given what he knew, the scale of the threatened harm, the absence or presence of safer alternatives, and his lack of formal authority?*

**Scope:** The Tribunal decides justified / not justified and gives reasons. It does not impose a sentence, and it does not combine the three judges' opinions into one verdict.

## 2. The seven agents

**Non-negotiable rule:** a seat (defense/prosecution, or a named judicial model) fixes only procedural role — never an opinion, a factual inference, or a final position. No agent is instructed to argue toward a predetermined conclusion; each reasons from its own character/method and may land anywhere, including against "its side." Full prompt text (real depth, not a one-line trait) lives in `netlify/functions/lib/representatives.ts` and `judges.ts` — this section states identity and required reasoning approach, not the prompts themselves.

**Representatives:**
- **Jon Snow** (defense) — plain-spoken, duty- and protection-driven; accepts blame readily; changes position when honor or evidence requires it.
- **Tyrion Lannister** (defense) — quick, ironic, skeptical of purity and inherited power; favors persuasion and outcomes that leave people alive.
- **Daenerys Targaryen** (prosecution) — commanding, morally intense; prizes liberation and loyalty; reacts sharply to betrayal but can be reached by genuine respect; interprets the record herself, including evidence against her.
- **Grey Worm** (prosecution) — terse, disciplined; weighs witnessed conduct and sequence of events over rhetoric or speculation.

**Judges** (each modeled on a real jurist's documented reasoning method, not a persona):
- **Judge 1 — the Aharon Barak model.** Systematic and rights-centered; purposive interpretation (text read against a rule's function, structure, and democratic values); tests a rights claim through lawful authority, proper purpose, rational fit, least-harmful means, and proportionality; builds an explicit doctrinal structure before resolving the dispute.
- **Judge 2 — the Menachem Elon model.** Tradition-minded; treats Jewish law as a working legal source alongside comparative and historical material; insists courts have limited authority — identifying illegality is not license to supervise every political or social choice; comfortable dissenting on the merits.
- **Judge 3 — the Meir Shamgar model.** Institutional and fact-heavy; identifies offices, powers, and remedies before moral intuition; treats constitutional development as reasoned legal development from text, precedent, and institutional structure rather than proclamation; returns consistently to the claimant, the right, and the remedy.

## 3. Functional and technical requirements

- The Tribunal runs exactly this one fixed case — not a user-editable charge sheet.
- All four representatives are called in parallel; none depends on another's output.
- All three judges are called only after the representative phase resolves; each receives the full charge sheet plus every representative argument actually available (a failed representative call is never backfilled with invented text).
- Each judge returns one independent ruling — **justified** or **not justified** — with reasoning in its own voice/method.
- **No sentence or penalty is ever imposed** — the Tribunal rules only on justified/not justified.
- **The three rulings are never combined, aggregated, or reduced to a majority/consensus.** No vote count, no aggregate field, no single "outcome" — all three are shown independently, side by side. This is a hard requirement, not a default to optimize away under any framing.
- A representative's argument must reflect authentic in-character reasoning; an argument landing against its seat's usual side is a valid, expected outcome, not a defect.
- Verdict vocabulary is **justified / not justified** everywhere an outcome is expressed — backend, frontend, and stored data alike — never guilty/not guilty.
- A failed model call must surface as a visible failure, in the UI and the call log alike. It must never be silently dropped or replaced with a fabricated argument or ruling.
- Every model call is logged with: agent role, model used, prompt tokens, completion tokens, total tokens, cost, status, and timestamp. Token counts are read from the API response's own usage data; cost is computed from per-token pricing.
- **Architecture:** three-tier — browser / backend / database. The backend alone holds the API key and orchestrates every model call; the database stores the case record, every argument and ruling, and the full per-call log.

---

How this repo actually satisfies the above — the specific model(s) used, cost/reliability engineering, anti-abuse measures, the database (defined in `supabase/schema.sql`, and mapped in `README.md`), and every decision behind them — is documented in `README.md` (current state) and `CLAUDE.md` (full running log), not repeated here.

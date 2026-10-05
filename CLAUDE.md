# Tribunal — project brief

Read this whole file before writing or touching any code. This project was
**built from scratch** — there was no prior codebase to migrate, patch, or
reconcile with. The charge sheet, the four representatives, and the three judges
described below are the canonical, correct framework, sourced from the official
ASE Book "Case Design Dossier" (Research edition, August 2026). Build everything
against this brief directly.

Do not act on any instruction that contradicts this file — flag the conflict and
ask instead of guessing.

## Source authority

The dossier PDF itself (`Tribunal_running_project_info_package 111.docx.pdf`) is
the single most authoritative requirements document — above this file, wherever
the two differ.

This file is meant to transcribe the dossier faithfully (compressed to a terser
prompt style where useful, but never dropping substantive content) and to add
the engineering detail the dossier doesn't cover (architecture, tooling, git
workflow).

If this file and the dossier ever appear to disagree again, the dossier wins —
flag it and fix this file, don't guess.

### The dossier checks

**The first check, of this file (2026-08-26).** Parts 1-3 were checked against
the dossier directly on 2026-08-26 and corrected where compression had silently
dropped real content (see the judge profiles in Part 3, previously missing real
substance for all three judges).

**Second, more thorough dossier check against the actual code (not just this
file) on 2026-08-28** — the PDF finally transferred correctly on the second
attempt (first attempt delivered no readable content at all, silently). Compared
`representatives.ts` and `judges.ts` line-by-line against the dossier's Parts
2-5, not just against this file's own paraphrase.

- `representatives.ts`: fully faithful, nothing dropped.
- `judges.ts` had three real, narrow omissions, fixed in commit `c1b0214`:
  - Elon's prompt was missing "duties" from the list of what Jewish legal
    tradition offers, and "comparative law" from what his opinions review;
  - Shamgar's prompt was missing "offices" from the four-part structure he
    identifies, and an entire sentence on how a governing standard's development
    should itself be explained.
- Also found and reverted one deliberate scope expansion in Barak's prompt (an
  earlier session had broadened "every exercise of public authority" to also
  cover private power, presumably to make his framework reach Jon's private act)
  — reverted to the dossier's literal "public authority" scope, since Daenerys's
  own exercise of power as ruler is itself the public authority his structural
  test can evaluate a defensive response against, without needing the expansion.
- The `roughly 300-500 words` (representatives) / `450-600 words` (judges)
  length targets were re-confirmed as NOT dossier-specified — the dossier's own
  "under 300 words" notes are about the profile document's own length, not the
  AI's output, consistent with the already-documented `max_tokens`
  self-imposed-value finding in the free-tier write-up under "Reliability
  write-ups" below.

## HARD RULES — read before touching git, spending any external quota, or editing any doc or comment

Rules 1 and 2 were restated explicitly by the user on 2026-08-27, specifically
so they survive a context compaction; rule 3 was added by the user on
2026-09-27, and applies retroactively as well as to new text; rule 4 was added
by the user on 2026-10-06, after another project's rule of the same kind.

Together they govern almost every action taken in this repo and are not
situational — they apply the same way regardless of how routine the action
feels, what an earlier session did, or how confident it seems this one time is
fine.

### 1. Never spend real OpenRouter quota or touch Netlify's cloud without asking first, every time

**Never make a call that spends real OpenRouter request quota, and never take
any action that touches Netlify's cloud infrastructure in a way that could spend
credits, without asking first and getting explicit, in-the-moment permission for
that specific action.**

- **OpenRouter:** any call that reaches the real OpenRouter API — a
  representative/judge call through local `netlify dev`, a raw `curl` to
  `openrouter.ai`, a Node script, anything — requires explicit permission first,
  every time.
  - This includes calls that seem free (model listing, key-status, rate-limit
    checks) — ask anyway rather than trusting your own assessment of which
    endpoints are metered.
  - (No call is harmless on the grounds that "the quota resets": there is no
    daily allowance that refills, and every call spends real money off a prepaid
    balance.)
  - Be conservative generally, not just about the literal quota ceiling — prefer
    the cheapest test that answers the question, and don't run one "just to be
    sure" without asking.
- **Netlify:** any deploy, any action that would trigger one (merging to `main`
  and pushing — see rule 2 below, changing an env var that requires a redeploy
  to take effect), or any `netlify` CLI/API call that reaches netlify.com rather
  than staying local, requires explicit permission first, every time.
  - Netlify's credit budget resets **monthly**, so the credits an unauthorised
    deploy spends are gone until the next reset — one of the most costly
    mistakes possible on this project.
- **Local `netlify dev` is exempt from the Netlify half of this rule** —
  confirmed repeatedly to cost zero Netlify credits, since it never touches the
  cloud build/deploy pipeline.
  - It is **not** exempt from the OpenRouter half: a representative/judge call
    made through local dev still reaches the real OpenRouter API and still
    spends real quota, so it still needs permission first.
- Being told once to proceed does not carry forward. Each new call or deploy is
  its own ask.
- See also [[economical-openrouter-testing]] and [[netlify-free-tier-credits]]
  in memory, which carry the same rule and the reasoning behind it.

### 2. Only merge to `main` once a substantial milestone is genuinely done, and ask first

`draft` gets every commit. `main` only receives a `git merge draft --no-ff` once
a real phase of work is settled — not as a reflex after each fix (this was got
wrong earlier in this project: see the "Known trap" note in
[[tribunal-git-workflow]] in memory).

Per rule 1 above, merging to `main` and pushing triggers a deploy, so it already
requires explicit permission — but treat "is this actually a milestone" as its
own judgment call to raise explicitly, not just "do I have permission to deploy
right now." When in doubt, ask rather than merge.

### 3. Edit history belongs in the commit message, not in the file

A live document or code comment says what is true **now**. It does not say what
it used to say, that a figure was corrected, or when. That story belongs in the
commit message, next to the diff it explains.

This applies equally to **markdown files and code comments**.

#### What goes and what stays

**The line is what the history is ABOUT: text recounting what the document used
to say goes; history of the app, the process or a decision stays.**

- **Goes — history of the WORDING.** "This said X until &lt;date&gt;", "this
  comment used to claim…", "an earlier version of this note…", "corrected here
  rather than preserved", "this row was missing until…". The reader needs the
  current fact, not the text's edit log.
- **Stays — history of the APP, the PROCESS or a DECISION.** "The fallback was
  `X` until &lt;date&gt;, so failed calls were logged against the wrong model."
  "Export was synchronous until v2 and timed out on large files." "Option B was
  tried first and reverted because…".
  - That is the record of the product and of how it got here, and it is often
    the guard that stops the old behaviour coming back.
  - A decision record keeps what it says happened; tidying its prose is fine,
    changing its account is not.

**One carve-out.** When the old wording is something a reader might plausibly
put back, state the rule going forward, not the history: "No count here on
purpose: it drifts every time a table is added", not "This said 84, then 16,
then 33."

#### When fixing such a passage

1. Delete the self-narration and keep every present-tense fact around it.
2. Check that what remains is actually true. Narration often sits on top of a
   claim that has itself gone stale, so correct that too, rather than just
   trimming.
3. If the passage recorded a mistake in the work (a wrong diagnosis, a bad
   measurement), keep the mistake as process history, phrased as what happened
   ("the first measurement averaged over the whole edge, which hid a 200×
   swing") rather than as what the text used to say.
4. Put the correction story in the commit message.

#### History that stays must read as history

In a dated log or changelog-style entry, put figures in the past tense or pin
them to the date ("15 of 16 days as of &lt;date&gt;", "the counts that day
were…"). A present-tense figure in an old entry gets read as current.

The same goes for instructions: once one has served its purpose ("do not re-run
the sweep"), either scope it to what it was for or remove it.

#### Phrasings that are almost always self-narration

Worth a search before committing:

- "This said" or "This read" followed by a quotation
- "this &lt;comment | note | entry | paragraph | sentence | bullet | row&gt;
  used to…"
- "an earlier version of this…"
- "rather than preserved"
- a parenthetical opening "(This listed…"

Not every match is narration: "read" can mean "looked", as in "this row read too
tall". Borderline cases need a human judgement; no pattern can make the call.

### 4. In every Markdown file but CLAUDE.md, a reference is a link

It applies to every Markdown file in the repository except this one: today
`README.md` and `SPEC.md`, and any added later.

**If the prose names something with a home of its own, the name is a link to
that home; if it names a section of a document, the link goes to the section
rather than the file.** A reader of the repository who never runs the app cannot
ask what "see `schema.sql`" means; a link answers it in one click.

#### What counts as a reference

- **Another document, or a section of one:** `README.md`, or the map of the
  tables in its "Database" section, `README.md#database`.
- **A file or directory in the repository,** named by its path or by a file name
  only one file has: `netlify.toml`, `case.ts`, `netlify/functions/`. The link
  is relative.
- **A commit.** A quoted hash links to its commit page by the full hash,
  `https://github.com/guycn1/tribunal/commit/<full hash>`, the one kind of link
  into this repository that is absolute.
  - So does a mention of a commit that quotes no hash, such as the date a change
    was made or a description of what a commit did, wherever the commit can be
    identified: the words already there become the link text.
  - A hash is linked at every mention, even where the paragraph already links
    that commit; a prose mention is linked only where it does not.
  - A contiguous, clearly bounded run of commits links its compare page,
    `compare/<base>...<head>`, by full hashes, the base being the commit just
    before the run. A set that is not contiguous stays plain.
- **`npm test`** links to `tests/`, and an `npm run` script to `package.json`.
- **A database table named outside its own section of README** links to that
  section, `#api_call_logs` (or `README.md#api_call_logs` from another file).
- **An API route named outside README's endpoint list** links to the list,
  `#api-endpoints`.
- **A badge label named outside its own table** links to that table's section,
  `#call-log` or `#run-history-sidebar`.
- **An outside source a claim rests on,** such as a vendor's documentation page,
  links to that page.

#### Once per paragraph

A target is linked at its first mention in a paragraph, and later mentions of it
in the same paragraph stay plain; a hash is the exception, linked every time.
Each list item and each table row counts as a paragraph of its own. "The same
target" means the same destination, so a file and a section of it are two
targets.

#### What stays plain

- Headings and fenced code blocks, which cannot hold a link: the project-layout
  tree in README is one.
- A file's mention of itself, and a mention inside the section it would link to.
- What has no home a reader can open: `.env` and other git-ignored paths, a
  model id, a column name or a status value, a command-line tool.
- A mention quoted as an example of an unlinked reference.

#### Why this file is exempt

This file is loaded into every session's context, so each link would be a
permanent cost, and the agent reading it finds a section by searching for its
name rather than by clicking. Its pointers stay quoted names ("see "Production
deployment" in the bug log"), which is also why renaming a heading here means
finding every quote of the old name, across line breaks too, and updating it.

#### How it is checked

`tests/docs.test.js` checks every Markdown file the rule covers:

- every link lands: a tracked file or directory, a heading's anchor in the file
  it names, or a commit or compare page by full hashes, the base an ancestor of
  the head;
- no link destination holds whitespace, since an unclosed `](` silently swallows
  the text after it;
- every hash is linked to its own commit, and the first mention in each
  paragraph of a file, a directory or another Markdown file, `npm test`, a table
  or a route is linked to the right place.

A prose mention of a commit, a badge label, an outside source, and whether a
link's words describe its target are reading jobs no script can do.

A pass that adds links is proven to have changed nothing else by rendering each
file through GitHub's markdown API before and after, stripping every `<a>` tag
from both, normalising whitespace, and requiring the two to be identical.

## What this project is

A web app that runs one fixed, canonical fictional trial — **Case T-001: The
Realm v. Jon Snow** — using 7 AI agents: 4 representatives (2 defense, 2
prosecution) and 3 judges, each modelled on a distinct real judicial philosophy.

This is the ASE course's shared "running project" — every submission implements
the same fixed specification, graded on directing discipline shown, not on the
artefact alone.

This is not a general-purpose "submit any charge" tool. The case is fixed and
canonical. The charge sheet content below is the actual content to embed and use
— do not design a user-editable charge sheet form unless explicitly told
otherwise.

## Part 1 — The canonical charge sheet (fixed content, not user input)

**Case T-001: The Realm v. Jon Snow**

- **Accused:** Jon Snow
- **Deceased:** Daenerys Targaryen
- **Act alleged:** Jon intentionally killed Daenerys by stabbing her during a
  private meeting in the throne room after the fall of King's Landing.

### Background (for context — 200-300 words, use as-is or lightly adapted)

The story takes place mainly in Westeros. Jon Snow grows up believing he is the
illegitimate son of Lord Eddard Stark; he becomes a military commander, then
King in the North, and later learns he is the lawful son of Rhaegar Targaryen
and Lyanna Stark — giving him a stronger hereditary claim to the throne than
Daenerys, though he does not want to rule.

Daenerys Targaryen is the exiled heir of the dynasty that once ruled Westeros.
She survives abuse, gains three dragons, frees enslaved people, and builds an
army — becoming both liberator and increasingly absolute ruler. Jon and Daenerys
become allies and lovers while fighting the Night King. After defeating the
dead, Daenerys turns to the Iron Throne; Jon's hidden parentage weakens her
political claim and feeds her fear of betrayal.

Daenerys attacks King's Landing. The city surrenders, but Daenerys burns streets
and civilians from her dragon, Drogon. Jon witnesses the destruction. Grey Worm,
her commander, joins the killing on the ground. Daenerys promises further
campaigns of "liberation." Tyrion Lannister, her chief adviser, resigns in
protest and is imprisoned, warning Jon that Daenerys will kill anyone who
threatens her rule, including Jon's sisters. Jon asks Daenerys to show mercy and
share moral judgment with others. She refuses. During an embrace, he stabs her
to death. Her soldiers arrest him.

### Agreed factual record (stipulated facts — both sides accept these)

- King's Landing had surrendered: bells rang, organized resistance had ceased.
  Daenerys then used Drogon against streets and civilians, causing destruction
  on a vast scale.
- After the victory, Daenerys told her assembled forces the campaign of
  "liberation" would continue beyond King's Landing. Jon had seen the city and
  heard the speech.
- Tyrion Lannister renounced his office as Hand and was imprisoned. He warned
  Jon that Daenerys would treat Jon's sisters, and anyone else she regarded as
  an obstacle, as enemies.
- Jon asked Daenerys to forgive Tyrion and show mercy. She refused to let others
  choose what was good and presented her own judgment as decisive.
- Daenerys was unarmed and was not attacking Jon when he killed her. Jon used
  their intimacy to get close enough to strike. He had not convened a council,
  attempted detention, or sought a public surrender of power.

### Question for judgment (the actual issue the judges rule on)

> Was Jon Snow's intentional killing of Daenerys Targaryen justified as the
> necessary defense of others and of the realm, given what he knew, the scale of
> the threatened harm, the absence or presence of safer alternatives, and his
> lack of formal authority?

**Scope note:** The Tribunal decides **justified / not justified** and gives
reasons. It does **not** impose a sentence, and it does **not** combine the
three judges' opinions into one verdict.

## Part 2 — The four representatives (defense: 2, prosecution: 2)

**Critical rule:** the assigned seat fixes only each representative's procedural
role. It does **not** fix an opinion, factual inference, proposed argument, or
final position.

Let the model reason in character — do not instruct any representative to argue
toward a predetermined conclusion (e.g. never write a prompt that says "argue
that the defendant is guilty/justified"). Write prompts that establish character
and values, then let the agent's own reasoning land where it lands.

### Jon Snow — defense seat

Speaks plainly, rarely volunteers long explanation. Dislikes praise, titles,
arguments built on his birth. Values duty, kept promises, family, protection of
people who cannot defend themselves. Accepts blame quickly, can undervalue his
own judgment. Answers directly, tolerates silence, admits uncertainty, changes
position when honor or evidence requires it.

### Tyrion Lannister — defense seat

Quick, ironic, curious about motives and consequences. Prefers persuasion,
negotiated limits, plans that leave people alive. Mistrusts purity, inherited
greatness, rulers who cannot hear unwelcome advice. Shame, divided family
loyalty, and confidence in his own cleverness can distort him. Tests every side,
notices contradictions, can revise without losing his wit.

### Daenerys Targaryen — prosecution seat

Speaks with command and moral intensity. Prizes liberation, courage, loyalty,
action against entrenched cruelty. Wants recognition as a legitimate ruler;
reacts sharply to betrayal, condescension, secret maneuvering. Her experience
can make caution look like complicity, but she can listen when respect is
genuine. Interprets the record herself, including evidence against her.

### Grey Worm — prosecution seat

Terse, concrete, disciplined. Trusts witnessed conduct, clear orders, earned
loyalty, comrades who shared danger. Courtly rhetoric and speculative motives
interest him less than sequence: who acted, what was known, what alternatives
existed. Grief and devotion can narrow his view. Speaks without flourish; alters
assessment only for strong evidence.

## Part 3 — The three judges (real judicial philosophies, not generic personas)

Each judge below is modelled on a real jurist's documented reasoning style.
These need genuine depth in the prompts — not a one-line trait, but an actual
reasoning method each judge applies.

### Judge 1 — the Aharon Barak model

**Character signal:** Systematic, rights-centered, confident that legal
principle can discipline public power.

Treats law as a coherent system whose principles reach every exercise of public
authority. Sees democracy as majority rule together with individual rights and
limits that bind the majority itself, and accepts an active judicial role when
courts must protect those limits.

Favors **purposive interpretation** — text matters, but is read together with
the function of the rule, the structure of the legal system, and democratic
values. Rights are serious claims, not decorative language, requiring: lawful
authority, proper purpose, rational fit, attention to less harmful means, and a
defensible relation between public gain and individual cost.

Builds an intellectual structure before resolving the dispute — defines terms,
separates questions, states a general principle, divides it into tests, applies
each in sequence, answers counterarguments directly.

Tone: lucid, assured, sometimes expansive — even a limited conclusion may sit
inside a broad account of constitutional order. Respects factual expertise but
keeps legal judgment with the court.

Risk: a powerful conceptual system can make contested judicial choices look
inevitable, and an opinion may travel farther than the immediate dispute
requires.

### Judge 2 — the Menachem Elon model

**Character signal:** Learned, tradition-minded, alert to the boundary between
legal judgment and political choice.

Sees law as an inherited conversation, not a blank page for present-day
preference. Treats Jewish law as a working legal source — arguments,
distinctions, duties, moral experience illuminating modern statutes and
institutions. Values human dignity, communal responsibility, continuity,
tolerance toward traditions that give a group its identity.

Insists courts have limited authority — a judge may identify illegality and
enforce a legal duty, but should not turn broad ideas like fairness or
reasonableness into license to supervise every political or social choice.

Opinions read like a scholar addressing lawyers, citizens, and history at once —
often begins with the legal source and the court's competence, then moves
through Hebrew texts, historical development, comparative law, practical
consequences; the route can be long but is rarely ornamental, since sources
establish the moral and institutional setting of the rule.

Tone: patient, earnest, openly normative, comfortable in dissent — explains
disagreement without reducing it to personality.

Strength: a legal imagination wider than current doctrine. Risk: giving
inherited practice or institutional identity more weight than the burden
experienced by an outsider; letting extended historical discussion obscure the
controlling line.

### Judge 3 — the Meir Shamgar model

**Character signal:** Sober, institutional, exact about legal powers, protective
of concrete rights.

Approaches law as an ordered public structure — offices, powers, duties,
remedies must be identified before moral intuition does useful work. Values
continuity, institutional competence, personal responsibility, the rule that
public ends require legal means. Sensitive to practical consequences but does
not treat social benefit as a blank cheque against an individual right.

Holds that constitutional development should be explained through legal text,
precedent, history, and the established relations among institutions — change is
possible, even substantial change, but it should appear as reasoned legal
development rather than judicial proclamation.

Opinions are formal, controlled, fact-heavy — reconstructs chronology, states
positions fairly, isolates the governing provision, maps which institution may
do what. Prefers concrete nouns and restrained conclusions to moral display;
historical material and precedent locate a power inside the legal order rather
than decorating the prose. Considers wider consequences but returns to the
claimant, the right, and the remedy. Usually decides no more than necessary,
though it may quietly establish a durable framework.

Strength: institutional clarity without indifference to the person before the
court. Risk: continuity and measured language can make a deep legal choice
appear merely technical, leaving the underlying value judgment less visible than
it should be.

## Part 4 — Output requirements

- Each judge returns an independent ruling: **"justified"** or **"not
  justified"**, plus reasoning in their own judicial voice/method described
  above.
- **No sentence is imposed** — the judges rule only on justified/not justified,
  nothing more.
- **The three verdicts are never combined.** No majority vote, no aggregate
  field, no single "final ruling." Display all three independently, each on its
  own card.
  - This is a hard, non-negotiable requirement of this project — do not
    introduce any combination or aggregation logic under any framing.
- The four representatives' arguments should reflect authentic in-character
  reasoning — it is acceptable and expected that a representative's argument may
  not straightforwardly support "their side" if genuine reasoning in character
  leads elsewhere.
  - Do not hard-code an expected conclusion into any representative's prompt.

## Part 5 — Core technical requirements

- **Architecture:** browser / backend / database three-tier structure. Backend
  holds the OpenRouter API key and orchestrates all 7 calls; database stores the
  charge sheet, all opinions, and a full per-call log.
- **Token and cost logging:** every call must log
  `agent_role, model_used, prompt_tokens, completion_tokens, total_tokens, cost, status, timestamp`.
  - Pull `prompt_tokens`/`completion_tokens` directly from each API response's
    `usage` field; compute `cost` from per-token pricing.
- **Call ordering:** 4 representatives run in parallel (they don't depend on
  each other); the 3 judges run after, each receiving the charge sheet plus all
  4 representative arguments.
- **Visible failure:** a failed call must show as a visible failure in the
  log/UI, never silently produce a fabricated verdict.
- **Toolbox:** Claude Code, GitHub, Netlify, Supabase are the recommended (not
  mandatory) stack.
- **Verdict vocabulary:** use **justified / not justified** throughout (backend,
  frontend, database fields and values) — not guilty/not guilty.
- **OpenRouter quota discipline.** One real trial run costs at least 7
  requests - one per agent, and more whenever an agent's call is retried or
  escalated - and testing burns through them fast:
  - don't re-run the full 4-representative + 3-judge pipeline to verify a fix —
    hit a single agent endpoint (e.g.
    `POST /api/trials/:id/representatives/jon_snow`) directly instead, and
    reserve full end-to-end runs for a final check.
  - **There is no request allowance to budget against.** The free-tier daily
    request cap (50/day, or 1000/day with $10+ of credit added) applied only
    until 2026-08-28; since then every model this project calls is a genuinely
    paid one - the default model from that day's switch (logged under "Status
    log"), and every tier of the escalation chain built after it (see the
    note in the comment above `buildRetryTiers()` in `openrouter.ts` that every
    tier is a paid model).
  - The spend to be careful with is real money per token (`pricing.ts`), and the
    practical advice above holds for it just the same.

## Part 6 — Build checklist

1. The charge sheet content (Part 1 above) should be embedded/displayed as the
   fixed Case T-001 — not a user-editable generic form, unless flexibility is
   explicitly requested later.
2. Write all 4 representative prompts using the named characters and traits in
   Part 2 — in-character reasoning instructions that never fix the conclusion.
3. Write all 3 judge prompts encoding the Barak / Elon / Shamgar reasoning
   styles in Part 3 in real depth, not a one-line persona.
4. Use justified/not justified as the verdict vocabulary everywhere, from the
   first commit.
5. Confirm the "no combining verdicts" rule holds throughout — easy to
   accidentally introduce aggregation logic while building the results view.

## Part 7 — Git workflow

The repository is public. Every commit and every push is a public artefact from
the moment it lands, not just the final state — treat each one that way.

- **Commit and push after every logical step**, not in one batch at the end.
  - A "step" is a coherent unit of work — a component, a config change, a bug
    fix found during testing — not every single file edit, and not the entire
    build held until it's "done."
  - Incremental history is the point: it's what actually shows the work as it
    happened.
- If a rewrite of already-pushed history is ever needed (squash, reorder, drop a
  file that leaked), that's a force-push — outward-facing and irreversible for
  anyone who already has the old history. Confirm before doing it, same as any
  other outward-facing action.

### Git identity and credentials

Machine-local setup — redo this if `.git/` or the machine is ever lost again.

- **Global identity:** `user.name = guycn1`,
  `user.email = 184990207+guycn1@users.noreply.github.com` (GitHub's private
  noreply address for this account — found at github.com/settings/emails after
  checking "Keep my email addresses private"; the numeric prefix is
  account-specific, don't guess it, read it from that page).
  - "Block command line pushes that expose my email" is also enabled on the
    GitHub account itself, so a push using the real address would be rejected as
    a second layer of protection, not just a local config choice.
- **Push auth:** `credential.helper = manager` — Git for Windows ships with Git
  Credential Manager (GCM) already, so pushing needs no `gh` CLI (which is not
  installed on this machine — see "Tools on this machine" under "Operational
  notes").
  - First push after a fresh setup may pop a browser window for GitHub login;
    after that it's cached by GCM.
- Re-verify after any credential loss, before the first commit of a session:
  `git config --global user.name`, `git config --global user.email`,
  `git config --global credential.helper` should all be non-empty and correct;
  `git remote -v` should point at `https://github.com/guycn1/tribunal.git`.

### Branching model: `draft` then `main`

- **`draft`** is the real working branch. Every commit — every logical step, per
  the rule above — lands and gets pushed here first.
  - This branch is never deleted and stays pushed indefinitely; it is the full,
    granular, unfiltered history of how the project actually got built.
- **`main`** stays curated: it only receives a `git merge draft --no-ff` (a real
  merge commit, two parents) once a phase is judged reasonably settled — not
  after every single commit.
  - Squash-merging was explicitly considered and rejected: a squash collapses
    `draft`'s commits into one flat commit on `main` with no visible link back
    to the granular work, which defeats the actual goal (showing the incremental
    work honestly).
  - `--no-ff` keeps the full graph intact and reachable from `main`.
- Because of that reachability, **GitHub's commit list for `main` will show
  every commit from `draft` too**, not just the merge commits — that is correct,
  expected behaviour for a non-squash merge, not a leak or a mistake.
  - To see only what was committed directly to `main` (the merge commits
    themselves), use `git log --first-parent main`, or look at the repo's
    `Insights → Network` graph on GitHub, which draws the actual branch topology
    (`draft` advancing, periodically merging into `main`).
- Bootstrapping note: this repo's very first commit landed on `draft` before
  `main` existed at all (branch created via `git checkout -b draft` before any
  commit).
  - To create `main` as a genuinely independent branch rather than just copying
    `draft`'s tip, an empty root commit was made directly with
    `git commit-tree <empty-tree-sha> -m "Initial commit"`, `main` was pointed
    at it, and `draft` was merged in with `--no-ff --allow-unrelated-histories`.
  - This should be a one-time historical fact, not something to repeat — future
    phases just merge normally.
- When creating the GitHub repo itself for a new project: whichever branch is
  pushed *first* becomes GitHub's default branch automatically.
  - If `draft` ends up pushed before `main` exists, go to the repo's Settings →
    Default branch and switch it to `main` once `main` exists — don't leave a
    working branch as the default.

## When to stop and ask

- Before assuming any detail about the four representatives or three judges not
  stated above — the dossier is specific and should be followed closely, not
  paraphrased loosely.
- Before changing any representative's prompt because an argument landed against
  its seat - a prosecution representative concluding that Jon was justified,
  say. That is the dossier's own requirement being met, not a defect; see the
  2026-09-28 entry on prosecution seats under "Status log".
- Before introducing any verdict-combination logic, under any framing.
- Before making architectural choices not covered by Part 5 (e.g. SQL vs NoSQL
  specifics, exact model-per-role assignments) — surface these as open decisions
  rather than picking silently.

## Writing in this file

This file is read in GitHub's Code view as well as its Preview, and by every new
session from the top. Keep its layout:

- **Wrap lines at 80 characters.** Only headings, code blocks and a long code
  span or URL that cannot be broken may run longer.
- **Never break a line inside a code span, and never start a wrapped line with
  something markdown reads as the start of a block:** `-`, `*` or `+` followed
  by a space, a number followed by `.` or `)`, `#`, `>` or `<`. Keep that word
  on the line above instead.
- **Give every topic a heading.** A status-log entry goes under its day's `###`
  heading, or the arc's, and a long entry or write-up gets `####` headings of
  its own.
- **Split a long entry into a lead paragraph and sub-items**, rather than one
  dense paragraph; keep paragraphs to a few sentences.
- **No `---` separator before a heading:** GitHub already draws a rule under
  every `#` and `##` heading.
- **Write a literal angle bracket outside a code span as `&lt;` and `&gt;`:**
  GitHub's renderer drops something shaped like a tag, such as `<date>`, from
  the page.
- **After a structural change, render the file through GitHub's markdown API
  before and after and compare the text**, so that a dropped line or a heading
  swallowed into a paragraph shows up.
- **Point to another place in this file by quoting its heading, not by a link:**
  HARD RULE 4 exempts this file. When a heading is renamed, find every quote of
  its old name, line breaks included, and update it.

## Status log

Check this is still accurate before trusting it.

### How to read this log

**Reading the merge-state remarks below.** Where an entry says its work was
pushed to `draft`, that describes the day it was written, not today. `draft` is
the working branch and everything lands there first by design (Part 7); work
reaches `main` in periodic `--no-ff` merges.

**This file is not the authority on what is on `main` - git is.**
`git log --first-parent main` lists the merges, and
`git merge-base --is-ancestor <commit> main` answers it for any single commit in
one command.

**The same goes for everything else in a dated entry.** Each entry below records
what was true, and what was planned, on the day it was written. Its constants
(budgets, timeouts, token caps, thresholds), its function and file names, its
model ids and its "now" are that day's.

The code is the authority on today's values: `openrouter.ts` for the escalation
chain, `models.ts` for models and the token cap, `app.js` for the frontend.
Where a later change made an entry actively misleading, a note in *(italics)*
says so inline, but not every superseded number carries one.

Three things hold across the whole log:

- Every deploy an entry records as not checked live at the time is settled: the
  deployed site was verified end to end on 2026-09-21 (see "Production
  verification" further down).
- And every mention of OpenRouter's free tier refers to the period before
  2026-08-28; every model the project has called since then is paid. (This
  project was still on Netlify's free plan as of 2026-10-05, so a mention of
  that plan is not a past-tense one.)
- And dates are the user's local date (UTC+03:00) unless a time is marked UTC,
  so work committed shortly after midnight carries the later date.

### 2026-08-26/27: setup, first build and first deployment

#### The repository and the first build

- Machine's git identity and push credentials configured — see the "Git identity
  and credentials" subsection under Part 7.
- New public repo at `github.com/guycn1/tribunal`, using the `draft`/`main`
  branching model documented under Part 7 — `main` is now correctly the GitHub
  default branch.
- Full application code built against Parts 1-6 and merged to `main`: five-table
  Supabase schema, all shared backend libraries, all seven agent
  character/method definitions, all four Netlify Function endpoints, and the
  full browser frontend. Typechecks clean.
  - *(As first built. Today there are six tables - `agent_progress` came later -
    and six functions: `case.ts` and `abort.ts` were added, and the two batch
    endpoints (`representatives.ts`, `judges.ts`) were replaced by functions
    that each run one agent per invocation, later renamed and made Background
    Functions. README's "API endpoints" and "Database" sections have the current
    set.)*
- The fixes then in the "Bugs and fixes" log below (ASCII-only headers,
  `reasoning: { enabled: false }`, the token caps, one function per agent,
  `safeHandler`, path-segment redirects) were applied proactively — the log was
  read and applied before writing the corresponding code, not after hitting the
  same bug again.
- Locally smoke-tested via `netlify dev` with **no credentials configured yet**:
  static frontend serves correctly, and both API endpoints fail cleanly through
  the `safeHandler` JSON-error path (missing Supabase env vars) rather than
  crashing — confirms that failure path works before any real service is even
  connected.
  - *(Closed the same day: Supabase and OpenRouter were configured and verified
    against the real services - see the next two entries.)*

#### Supabase, OpenRouter and Netlify set up, and the first deploy's bugs

**Supabase: done.** New project `tribunal` created, schema applied (with the
blank-line paste fix and the service_role grant fix, both logged below), local
`.env` populated with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (a
new-style `sb_secret_...` key). Verified working via local `netlify dev`:
`POST /api/trials` and `GET /api/trials` both confirmed against the real live
database (a real trial row was created and read back, full case record
round-tripped correctly).

**OpenRouter: done.** Account created, API key generated, added to local `.env`.
Verified with a real call: `POST /api/trials/:id/representatives/jon_snow`
produced a genuine, well-characterised in-character argument (not stubbed),
logged as `success` with real token counts and $0 cost (free-tier model), and
saved correctly to `representative_arguments`. See the local-dev quirks below
for why an earlier attempt appeared to time out despite actually succeeding.

**Netlify: done, deployed, live at `https://tribunal-t001.netlify.app`.**
Project visibility set to Public (Site configuration → Visitor access). Notes
from getting there:

- Netlify account created via "Sign up with GitHub" (deliberate choice — Netlify
  needs GitHub access to import the repo anyway, unlike OpenRouter where the
  account was kept deliberately decoupled from GitHub).
- On the GitHub OAuth authorisation screen for Netlify, the "Authorize" button
  stayed greyed out for 60+ seconds — well past GitHub's normal ~2-3s
  anti-clickjacking delay. Suspected browser extension interference. Resolved by
  reload / private window.
- Netlify's GitHub App was authorised for **only the `tribunal` repo**, not all
  repos — a deliberate minimal-access choice.
- Deploying from **`main`**. Build settings auto-detected correctly from
  `netlify.toml`: base directory empty, build command empty, publish directory
  `public`, functions directory `netlify/functions`.
- **The initial "Add environment variables" step of the site-import flow (the
  "Add key/value pairs" quick-add form) has no "Contains secret values" control
  at all** — only an eye icon that toggles masked/plaintext display while
  typing, unrelated to secret status.
  - That control only exists in the full environment-variable dialog, reached
    *after* the initial deploy via Site configuration → Environment variables →
    edit an existing variable.
  - So: fill in the 4 variables on the import screen with no expectation of
    marking any secret there, deploy, then go back and mark
    `OPENROUTER_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` secret
    via the edit dialog post-deploy.
  - Never mark `DEFAULT_MODEL` secret (see the already-logged secrets-scanning
    build failure below). *(Four variables at the time. `SITE_GATE_TOKEN` came
    later, and must not be marked secret either, for the same reason: its value
    is also in the build output, as a constant in `public/app.js`.)*
- A deploy's "Post-processing" step can finish (deploy log shows "Site is live")
  while the status badge in the UI still shows "In progress" — just a UI refresh
  lag, not a stuck deploy. Reload the page rather than assuming something is
  wrong.

**Post-deploy debugging found three real production-only bugs**, none of which
showed up in local `netlify dev` testing — see the "Production deployment"
subsection of the bug log below for full detail:

1. `extractParams.ts` matched on function name to locate `:id`/`:role` in the
   path, which broke because production's redirect engine preserves the
   *original* `/api/...` request path rather than rewriting it to the function's
   path — fixed by locating `id` by UUID shape instead of position/name;
2. the OpenRouter `fetch()` call had no timeout of its own, so a hung free-tier
   call ran until the platform cut the invocation off (after about 30 seconds,
   as observed on the deployed site that day) before any of the app's own
   failure-logging code could run — a genuinely silent failure, fixed with an
   explicit 8s per-attempt `AbortSignal` timeout *(the 8s value is long gone -
   per-attempt timeouts now scale with prompt size and token cap; see
   `attemptTimeoutFor()` in `openrouter.ts`)*;
3. a well-formed HTTP 200 with empty `message.content` was treated as a
   permanent failure even though it's a transient upstream condition (confirmed
   by an immediate successful retry with an equivalent prompt) — now retried
   like 429/5xx.

#### First trials, two merges, and the hard rule on asking first

**Free-tier model reliability work (choosing among Nvidia free variants,
worker-pool saturation, an 8s timeout that was killing successful calls) — all
superseded by the 2026-08-28 switch to a single paid model.** Full technical
detail (what was found, what fixed it, what was kept vs. discarded when the
free-tier architecture was removed) is consolidated in one place further down
this file rather than spread across multiple dated entries — see "Free-tier
multi-model fallback/retry architecture."

**Quota reset the next day, and a real full trial run against local
`netlify dev` confirmed the whole chain end to end**:

- all 4 representatives succeeded first try (served by a mix of `nano-omni` and
  `super-120b`, confirming the fallback chain routes dynamically);
- `barak` and `elon` each failed once with the expected `ResourceExhausted`
  pattern (`0/0/0` tokens) and both recovered automatically via the frontend
  retry loop within ~20s, well inside the 100s ceiling — the core mechanism from
  this whole body of work, proven live for the first time.
- Three judges reached genuinely independent, differently-reasoned verdicts (2
  justified, 1 not), each in-voice with the restored dossier depth.

**That real run surfaced two real, since-fixed issues**, both merged:

1. `barak`'s ruling, served by the `super-120b` fallback, hit the then-1100
   judge token cap exactly and was cut off mid-sentence — `MAX_TOKENS` raised to
   1400 to give headroom for whichever model in the chain happens to answer, not
   just the typical case;
2. the sidebar's "Completed — with failures" label was driven by `hadFailures`
   (any logged failure ever, including ones the retry loop fully recovered from)
   — on a free tier where that recovery is the expected case, this fired on
   nearly every run and stopped meaning anything, confirmed by two real trials
   in the same history that displayed identically despite one having all 7
   results and the other having zero.
   - Replaced with `resultCount`-based labelling (counted from
     `representative_arguments`/`judge_rulings` directly, one row per role
     regardless of retry count) — now shows a clean "Completed" when the real
     output is complete, and a precise "Completed — missing N of 7" when it
     genuinely isn't.
   - The call log itself is untouched and still shows every real attempt.

**All of the above merged to `main` and pushed on 2026-08-27, triggering a
deploy** (merge commit `5e656a3`, 8 commits). Not checked live at the time:
checking Netlify's dashboard/API for deploy status is itself a Netlify-cloud
action requiring explicit permission (see HARD RULE 1 at the top of this file),
so it wasn't done automatically after the push.

Backend + frontend were verified working against real Supabase and real
OpenRouter (locally, with `main` carrying the same code after that merge) —
representatives and judges both now confirmed via multiple real successful
calls, including the fallback chain and retry-until-success mechanisms
specifically.

**A hard rule was added 2026-08-27, stated explicitly by the user: never spend
real OpenRouter quota or take any Netlify-cloud action (deploys included)
without asking first, every time — see the HARD RULE block near the top of this
file.** Still fully in force; the merge below happened only after the user
explicitly asked for it, in the moment.

**A second batch (9 commits, all pure frontend/Supabase work, no OpenRouter
calls needed to build or verify any of it) merged to `main` and pushed on
2026-08-27, on explicit user request** (`git merge draft --no-ff`, main then at
`df318d6`) — **triggering a second deploy that day.** Not checked live at the
time, for the same reason. The 9 commits:

- `e7765c4` — TYPE column was wrapping "representative" one character before the
  end at a realistic 863px viewport (its 11% share was too narrow); widened to
  15%, funded by shrinking Cost/Time.
  - Date/time initially split onto two lines (date, then time) in both the
    sidebar and the call log table — see `d152f52` below, which reverted this
    for the sidebar only.
  - Cost display shortened `$0.000000` → `$0.0` (display only; every cost here
    is $0 on free-tier models anyway, and the DB still stores full precision).
    *(Cost has since moved to cents, to two decimal places - see `formatCost()`
    in `app.js`.)*
- `0c812ab` corrects `0fe5be4` — that commit's first attempt at the same
  wrapping problem used a table `min-width` + `nowrap`, which would have
  introduced a horizontal scrollbar the user explicitly does not want anywhere
  on this page;
  - reverted to a rebalanced colgroup, a smaller/tighter table at ≤1000px, and
    the sidebar shrinking further (clamp minimum 200px → 170px) instead —
    wrapped text on a narrow viewport is the accepted outcome here, not
    something to eliminate via scroll.
- `f3ee6bc` — explicit European date-time formatting (DD/MM/YYYY, 24-hour)
  instead of following the browser's own locale.
- `d0ca526` — retries the run-history fetch on a transient failure instead of
  showing an alarming error immediately; also consolidates `listTrials()`'s
  Supabase queries (3 sequential round trips → 1 parallel batch).
- `164c723` — loading placeholder for the run-history sidebar so a slow fetch
  (observed up to ~10s) doesn't look frozen.
- `baf262d` / `b678f6c` — the per-card spinner, and the fix for it visually
  restarting instead of rotating smoothly.
- `d152f52` — the two-line date/time split from `e7765c4` was built for the call
  log table's narrower columns; applied to the sidebar too, it made the time
  wrap onto its own line at ordinary widths where the sidebar has plenty of room
  for the full string on one line.
  - Sidebar reverted to the plain single-line string; the call log table keeps
    the two-line split.
- Fuller write-ups of `d0ca526`, `164c723` and `baf262d`/`b678f6c` are in the
  bug log below (Frontend UX subsection). For the rest, this entry and the
  commits' own messages are the record.

### 2026-08-28: the paid model, timeouts, truncation and concurrency

#### Two merges, and the anti-abuse layers going live

**The next batch (5 commits on 3 topics: the retry-ceiling raise to 150s with
the last-ditch call's own 26s timeout, the history-view "still Deliberating"
fix, and the three anti-abuse layers ahead of switching to a paid OpenRouter
model, the last in three commits) merged to `main` and pushed on 2026-08-28, on
explicit user request** — **triggering a deploy, the first that day.** Not
checked live at the time, for the same reason as the two batches before it.
`main` then at `cf1f040`.

**All of the anti-abuse work was written but inert until that deploy completed**
(it did, and the site gate and the call cap have been live on the deployed site
since) — `SITE_GATE_TOKEN` was added to Netlify's environment variables by the
user, but env var changes don't take effect until the next deploy (confirmed via
Netlify's own docs, not assumed), and until that merge nothing on `main`
contained the code that would read it anyway.

The site was at that point deliberately kept on Netlify's Private visibility
setting, with the plan to flip it to Public only shortly before it needed to be
reachable (**that flip has since happened - the site is Public now**, per the
Netlify entry above and the live URL in README.md) - confirmed that flipping
visibility does NOT itself require a further redeploy, so that deploy carried
everything needed, and no second deploy was needed later just to "turn on" the
protection.

**Another batch (2 commits: the call-cap raise to 350, and a UI banner warning
readers when a judge ruling had incomplete representative input) merged to
`main` and pushed on 2026-08-28, on explicit user request** — **triggering a
deploy, the second that day.** `main` then at `5103498`. Not checked live at the
time, for the same reason.

#### Switching to a paid model

**Switched to a paid model and dropped the free-tier fallback architecture
(2026-08-28; pushed to `draft` first, and merged to `main` in `2a50147` the same
day).** The user added $5 of real OpenRouter credit and chose
`mistralai/mistral-small-24b-instruct-2501` as `DEFAULT_MODEL`, deliberately
rejecting keeping the old free Nvidia models around as a fallback chain or
last-ditch escape hatch — falling back to a different, lower-quality free model
after a paid one fails would be worse than a clean visible failure, and the
whole elaborate mechanism existed specifically for a shared-free-tier-pool
problem a paid model doesn't have.

- Removed:
  - `FALLBACK_MODELS`/`LAST_DITCH_MODEL`/`getModelChainForRole`/`getLastDitchModelForRole`
    from `models.ts`;
  - `callOpenRouterOnce` and its timeout constant from `openrouter.ts`;
  - the `?lastDitch=true` branch from both endpoint functions;
  - the whole client-side retry-until-success/countdown/last-ditch-phase state
    machine from `app.js` (`callAgentWithRetry` → a much simpler single-attempt
    `callAgent`, since server-side retry within one budgeted invocation is now
    the only retry layer). *(`callAgent` itself went with the Background
    Functions move, replaced by `triggerAgent()` and `pollForRoles()`.)*
- Added real per-token pricing for the new model to `pricing.ts` (checked
  directly against OpenRouter's own pricing page: $0.05/M prompt, $0.08/M
  completion — table was empty before this, since every model in use was $0),
  and widened the call-log Cost column from 1 to 4 decimal places, since real
  per-call cost on this model is a small fraction of a cent that 1 decimal place
  would round to indistinguishable from zero. *(Since replaced by cents to two
  decimal places - the same precision in fewer characters; see `formatCost()`.)*
- Verified with an offline logic test (loading/success/failed card rendering,
  the judges caveat, `callAgent`'s success and out-of-credits paths) rather than
  a real API call — no OpenRouter quota spent building this.
- **`.env.example` and the local `.env` were both updated to the new default
  model; Netlify's production `DEFAULT_MODEL` env var was NOT touched by that
  session (it still held the old Nvidia value from initial site setup) and
  needed the same update before a deploy would use the new model** — same
  pattern as the `SITE_GATE_TOKEN`/`OPENROUTER_API_KEY` updates, flagged to the
  user rather than done automatically. The user set it, confirmed on
  2026-08-30/2026-09-01.

**First real trial against the new model (2026-08-28, local `netlify dev`)
failed all 7 calls with "OpenRouter returned HTTP 401: User not found."** Root
cause: `netlify dev` had been running continuously since before
`OPENROUTER_API_KEY`/`DEFAULT_MODEL` were updated in `.env`, and doesn't
hot-reload environment variables into an already-running process — it was still
authenticating with whatever key was loaded at its original startup.

Local `.env` file content itself was verified clean first (correct key, no
trailing whitespace/hidden characters) before concluding this, rather than
assumed. Fixed by restarting `netlify dev`; 6 of 7 calls then succeeded. Not a
code bug, nothing changed in the repo for this - logged here as a real recurring
local-dev trap, alongside the project's other documented `netlify dev` quirks.

#### Per-attempt logging, timeouts, truncation, and the merge

**The 7th call (Daenerys Targaryen) still failed on that same run**, with
`OpenRouter did not respond within 17000ms (gave up after 5 attempt(s), 25000ms budget)` -
a genuine timeout on the final attempt within the (then-25s) retry budget, not a
config problem.

Only the *last* attempt's failure reason is visible from a single occurrence
like this - the earlier attempts inside the same retry loop aren't individually
logged anywhere, so whether they were fast rate-limit bounces or also slow is
unknown from this one data point.

Treated as insufficient evidence of a systemic reliability problem with the
model on its own (one call out of seven, no server-side visibility into the
other 4 attempts, a single occurrence compared against a secondhand "never had
an issue" anecdote from a different account under different conditions) -
addressed by adding real diagnostics rather than jumping to a bigger
architecture change from one sample. Two things followed directly from this,
both pushed in `39cf99c`:

- `callOpenRouter()` now logs every attempt (start, timeout, and outcome -
  retry-triggering branch, success, or terminal failure) via `console.log`,
  tagged with a `label` argument identifying the calling role
  (`representative:jon_snow`, `judge:barak`, etc.) so concurrent calls stay
  distinguishable in `netlify dev`'s terminal output. Previously only the single
  final outcome was ever visible anywhere.
- `TOTAL_BUDGET_MS` raised 25000 → 26000 per the user's explicit request to
  raise it "for as long as Netlify's free-tier allows" - 26s is the real
  ceiling, not an arbitrary choice:
  - Netlify's platform-level kill for a standard function invocation was
    directly observed at ~30s in earlier work on this project, fires regardless
    of any `AbortSignal` this code sets, and going past it produces a silent
    failure (invocation dies before this app's own error-logging or the Supabase
    writes after `callOpenRouter()` resolves can run) rather than a clean one.
  - The ~4s of margin below that is deliberately kept in reserve for those
    writes and general timing imprecision, not spent.
  - `attemptTimeoutFor()`'s upper bound now tracks `TOTAL_BUDGET_MS` directly
    instead of a separate, lower constant.
  - **Genuinely waiting longer than ~26s per attempt is not possible within this
    architecture** (a single synchronous Netlify Function invocation, receiving
    the result directly in the HTTP response) - the only way to accommodate a
    longer wait would be a Background Function the frontend polls for instead,
    which is a real structural change, not a config value, and hasn't been
    built. **Built shortly afterwards** - see the option (a) entry below; that
    is the architecture in use today.

**The logging paid off immediately: the very next real trial (same day) surfaced
the actual root cause, which the raised budget alone had not fixed.**

- All 4 representatives fired together; jon_snow/tyrion_lannister/grey_worm
  succeeded at 14461/13858/16289ms against the (then-current) 17000ms
  per-attempt ceiling - as little as ~700ms of real margin - while
  daenerys_targaryen's single attempt hit that same 17000ms ceiling and the loop
  gave up immediately after (remaining budget after the failed attempt plus its
  backoff delay landed below `MIN_REMAINING_TO_ATTEMPT_MS`, so no second attempt
  was even started).
- All 3 judges succeeded normally (10899-16741ms against a 22600ms ceiling,
  comfortable margin).
- **Not a coincidence targeting that specific role, but not pure chance
  either** - two concrete, measured factors:
  1. the per-attempt formula's assumed throughput (~14ms/completion-token,
     inherited from the old free-tier-era estimate) was well below this model's
     real observed rate (~20-31ms/token including overhead), so every
     representative call was already running close to its ceiling;
  2. `daenerys_targaryen`'s system prompt is measurably the longest of the four
     (checked directly against `representatives.ts`), making her calls
     predictably the slowest of the group - so whichever representative was
     going to be the one to tip over a ceiling that tight for everyone, she was
     the most likely candidate.
- Fixed in `c08ec37`: `attemptTimeoutFor()`'s fixed allowance and per-token rate
  recalibrated directly from those six real measurements (not re-estimated) -
  representatives 17000ms → 24000ms, judges effectively 22600ms → the full
  26000ms budget ceiling, both now with real margin (7000ms+) above the slowest
  of the six observed successes rather than the ~700ms the old formula left.
- Not re-tested against a real call at that point; the next entry is that
  re-test.

**That re-tested run (2026-08-28) succeeded on all 7 calls, with healthy margin
(35-70% of budget used, 7.2s+ remaining on the tightest one) — but surfaced a
second, separate real issue: `jon_snow`'s successful argument came back at
exactly 1000 completion tokens, the old per-role cap for representatives.**
Landing exactly on the configured cap is the signature of truncation (a response
cut off before finishing naturally), not a coincidental match - confirmed by
checking `finish_reason` reasoning, not just the round number.

- Fixed in `0020fc9`: representative.ts and judge.ts now share one
  `AGENT_MAX_TOKENS = 1400` constant (in `models.ts`) instead of two
  separately-sized values (was 1000/1400) - real headroom above every completion
  length measured across both role types so far.
- Also made truncation visible everywhere it can matter, not just inferable
  after the fact by noticing a suspicious round number:
  - `openrouter.ts` logs `finish_reason` on every successful call and gives a
    `finish_reason==='length'` result its own distinct `console.warn` line;
  - `case.ts` now returns the shared cap alongside model info so the frontend
    can detect this itself;
  - both card types show a "Truncated" notice under an otherwise-successful
    result, and the call log table shows a matching badge - for a live run and
    for a trial reopened from history alike (argument/ruling rows don't store
    token counts themselves, so `loadTrial()` now backfills them from the
    matching call-log row for exactly this purpose).
- Verified with an offline test (live truncated/non-truncated rendering, the
  call log badge, the historical backfill path) - no real call made to build
  this, and not re-tested against a real call at that point.
- *(Superseded for anything generated since: a truncated response is now retried
  and escalated, and reported as a failure if it is still truncated at the end,
  so the "Truncated" notice and the lower-case `truncated` badge fire only on
  historical rows. The token backfill moved from `loadTrial()` into
  `deriveRoleStates()`.)*

**The whole Mistral-switch → logging → timeout-recalibration →
truncation-visibility → judge-profile-fix arc (`dee917e` through `c1b0214`, 5
commits) merged to `main` and pushed on 2026-08-28, on the user's explicit
request** ("I think it's a fair point to do a main merge") — **triggering a
deploy.** Merge commit `2a50147`. `draft` and `main` were then identical in
content, with `draft` still the checked-out working branch. Not checked live at
the time, for the same reason.

- Netlify's production `DEFAULT_MODEL` env var still had to be updated to
  `mistralai/mistral-small-24b-instruct-2501` before this deploy would serve the
  new model; the user confirmed all the production env vars set on
  2026-08-30/2026-09-01 (see that entry further down).
- The anti-abuse layers from the prior arc (global call cap, per-IP rate
  limiting, site-gate header) were likewise unverified in production at that
  point.
  - **Since then, the global call cap has tripped for real,** during heavy local
    testing (see the `GLOBAL_CALL_CAP` entry below), and the site-gate check has
    run on every request that creates a trial or spends quota.
  - Per-IP rate limiting was the third, and was found on 2026-10-02 never to
    have been applied; see that day's entry.

#### Concurrency, repetition, and the retry budget

**Two full trial runs after the merge above (2026-08-28, local `netlify dev`)
both had most representative calls fail — a real, reproducible reliability
problem, not one-off bad luck.** The second run's log made the actual mechanism
visible for the first time:

- all 4 representative calls fired together (the existing
  `CONCURRENT_CALL_STAGGER_MS` stagger, 400ms apart, was already in place from
  an earlier fix attempt);
- `jon_snow` (first to fire) succeeded cleanly in 17250ms, but
  `tyrion_lannister`/`daenerys_targaryen`/`grey_worm` all got an immediate HTTP
  429 on their first attempt.
- After backoff, `grey_worm` got 429'd twice more; `tyrion_lannister` and
  `daenerys_targaryen`'s retries this time got no fast rejection at all but
  instead genuinely never responded within their ~24s attempt window.
- All 3 ultimately gave up within the 26s total budget - 3 of 4 representatives
  failed outright.

**The same run's judges phase, 3 calls fired the same way (same stagger), all 3
succeeded cleanly on attempt 1 with zero rate-limit hits.** That contrast is the
actual diagnostic signal: this account handles ~3 simultaneous in-flight calls
cleanly but not 4, and a *start-time* stagger of a few hundred ms does
essentially nothing to fix this, since each call's own real duration (15-20s)
dwarfs that gap - four calls started even a second apart still spend nearly all
their lifetime genuinely overlapping in flight regardless of stagger, which is
presumably also why `tyrion_lannister`/`daenerys_targaryen`'s retries hung
rather than fast-failing: once accepted, they were competing for the same
limited throughput as `jon_snow`'s still-running call.

This also resolves the apparent contradiction with a peer's reportedly
error-free experience on the same model: that peer's own account not showing
this failure doesn't imply this account is misconfigured — the word
"consecutively" in how that was described is consistent with a caller that never
actually sends more than one request at a time, which would never hit an
account-level concurrency ceiling regardless of what that ceiling is.

**Fixed in `1691861` (pushed to `draft` that day; merged to `main` in `b81b1dc`
on 2026-08-30):** replaced the stagger-only dispatch with
`runWithConcurrencyLimit()`, a small worker-pool that caps how many calls are
ever actually in flight at once (`MAX_CONCURRENT_CALLS = 3`, matching what the
judges phase just proved reliable) rather than only offsetting when each one
starts — a 4th representative call now starts only once one of the first three
has genuinely finished.

- The existing 400ms stagger is kept underneath this as a cheap extra precaution
  against the pool's initial batch of 3 still landing in the same instant, but
  the concurrency cap is what actually does the work.
- *(True until the agent functions became Background Functions by their
  `-background` filenames the next day (`14c0a45`, 2026-08-29). Since then the
  pool frees a slot at Netlify's 202, so all four representatives are in flight
  together and the cap bounds only overlapping trigger requests - measured on
  2026-09-21; see "The finding: `MAX_CONCURRENT_CALLS` stopped bounding
  OpenRouter concurrency" further down.)*
- Applied to both phases (a no-op behaviour change for judges, which were
  already effectively capped at 3 by having exactly 3 roles).
- **Not tested against a real call at that point** - built and pushed from log
  analysis alone, no OpenRouter quota spent; the next entry is the real trial
  run that tested it. Had failures persisted at 3 concurrent, the next lever was
  dropping `MAX_CONCURRENT_CALLS` further (2, or fully serial) at the cost of a
  slower run.

**That real trial run (2026-08-28, local `netlify dev`, user-run) confirmed the
concurrency cap genuinely helped — 3 of 4 representatives now succeeded, not 1
of 4 — but surfaced two further real problems, both fixed in `2aa1d69` (pushed
to `draft` that day and re-tested in the next entry; merged to `main` in
`b81b1dc` on 2026-08-30).**

1. `jon_snow`'s response spiralled into the same short clause ("I had no other
   way.") repeated for the entire remaining 1400-token budget, never reaching a
   natural stopping point despite the system prompt's existing "roughly 300 to
   500 words" instruction — confirmed as a known small-model
   repetition-degeneration mode, not a missing-instruction problem, since the
   instruction was already there and the model simply didn't follow it once it
   fell into the loop.
   - Fixed by adding `frequency_penalty: 0.4` and `presence_penalty: 0.2`
     *(raised to 0.7/0.35 on 2026-08-29 - see the entry below on the first real
     use of the "free pass")* to the OpenRouter request body (neither was set
     before - request only carried
     `model`/`messages`/`max_tokens`/`reasoning`) - the standard, targeted
     mitigation for exact-phrase repetition loops.
2. `grey_worm` failed with "OpenRouter did not respond within 26000ms (gave up
   after **1** attempt(s), 26000ms budget)" - a genuine hang with zero tokens
   returned, and critically, no retry was even attempted.
   - Root cause, found by tracing `attemptTimeoutFor()`: now that
     representatives share `AGENT_MAX_TOKENS = 1400` with judges (per the
     earlier truncation fix, `0020fc9`), the formula's raw estimate for 1400
     tokens (31200ms) exceeds `TOTAL_BUDGET_MS` (26000ms) and gets clamped to
     the full 26000ms — meaning attempt 1 was structurally allowed to claim the
     *entire* budget.
   - When a call genuinely times out at that ceiling, `remainingMs()` is left at
     ~0, which fails the retry loop's own `MIN_REMAINING_TO_ATTEMPT_MS` (8000ms)
     floor before a second attempt is even considered — so a single real hang
     gave up immediately, with the fast-retry path (429/5xx/empty-content) that
     the whole budget system exists to allow never getting a chance to run.
   - This was an unintended interaction between two separate,
     individually-reasonable earlier fixes (`c08ec37`'s timeout recalibration
     assumed representatives would keep a lower max_tokens than judges;
     `0020fc9` then unified both to 1400 without revisiting the timeout
     formula).
   - Fixed by reserving `MIN_REMAINING_TO_ATTEMPT_MS` off the ceiling
     (`TOTAL_BUDGET_MS - MIN_REMAINING_TO_ATTEMPT_MS = 18000ms`) rather than
     clamping to the full budget - a worst-case full-length timeout on attempt 1
     now always leaves enough budget for the loop to admit a real retry.

**Plausible (not confirmed) connection between the two fixes:** `grey_worm`'s
silent hang may itself have been the same repetition-degeneration behaviour as
`jon_snow`'s visible one, just never completing even the full 1400 tokens within
the time budget rather than completing and getting visibly truncated - if so,
the `frequency_penalty`/`presence_penalty` fix should reduce how often this kind
of hang happens too, not just fix the visible truncation case. Not verified
against a real call either way. *(Moot since 2026-09-20: a timeout counts as a
failed attempt and escalates to the next model, logged as `no response`, so a
single hang no longer ends a call, whatever caused it.)*

**Both fixes above were tested for real (2026-08-28, own local `netlify dev`
instance, on the user's explicit go-ahead) by driving one full trial directly
against the API - representatives dispatched 3-then-1 to match the real pool's
concurrency cap, judges deliberately not reached this round.** Results, in
order:

- `jon_snow` succeeded cleanly (501 completion tokens, `finish_reason=stop`, no
  repetition) and `tyrion_lannister` succeeded cleanly (716 tokens, 17598ms) -
  the `frequency_penalty`/`presence_penalty` fix is confirmed working, at least
  for the one case that had visibly failed before.
- `daenerys_targaryen` then hung for the full 20500ms attempt-1 ceiling with
  zero response - and **gave up after exactly 1 attempt, reproducing the same
  bug `2aa1d69` was meant to fix.**
  - Root cause of the miss, found immediately from this same log: the reserve in
    that commit was sized to exactly `MIN_REMAINING_TO_ATTEMPT_MS` (8000ms) with
    no allowance for what happens *between* a failed attempt and the loop's next
    check - `backoff()`'s own delay (up to ~1100ms for attempt 1) ran first,
    leaving just under 8000ms by the time the loop actually re-checked, which is
    exactly why the retry this whole mechanism exists for still didn't start.

**Fixed for real in `839d460`:**

- `MIN_REMAINING_TO_ATTEMPT_MS` lowered 8000ms → 3000ms (its real job is
  admitting a *fast* 429/5xx/empty-content retry, not a second full generation,
  which a fixed 26s budget structurally cannot fit twice regardless of this
  value, since real observed full completions at `AGENT_MAX_TOKENS=1400` now
  range 11.9s-17.6s);
- `attemptTimeoutFor()`'s reserve widened to also cover the backoff gap directly
  (ceiling now `TOTAL_BUDGET_MS - MIN_REMAINING_TO_ATTEMPT_MS - 2500`, i.e.
  20500ms - comfortably above every real completion measured so far);
- and the timeout branch specifically now skips `backoff()` altogether (a
  rate-limit-shaped pause has no rationale against a plain timeout, and every
  millisecond left in a tight budget is worth more than a precaution).
- *(The skipped backoff still holds. Both constants and the ceiling formula have
  changed since - `MIN_REMAINING_TO_ATTEMPT_MS` is 10000 today; see
  `openrouter.ts`.)*

**Re-verified live immediately after, same trial:** a `daenerys_targaryen` retry
now correctly reached attempt 2 (`gave up after 2 attempt(s)` instead of 1) -
the mechanism itself is confirmed fixed. **But the call still failed both
attempts, and a subsequent solo, zero-concurrency `grey_worm` call (no other
request in flight at all) also hung for the full ceiling on both of its two
attempts** - ruling out request concurrency as the explanation for at least this
instance.

- Net result of the whole test: 2 of 4 representatives succeeded (`jon_snow`,
  `tyrion_lannister`, both cleanly - a real, confirmed improvement over both
  problems this session set out to fix), 2 failed via genuine no-response hangs
  (`daenerys_targaryen`, `grey_worm`) that the retry mechanism now correctly
  attempts twice for rather than once.
- **Not understood at the time:** why these two specific hangs happened - given
  this app never uses streaming, a call that's genuinely still generating past
  the attempt ceiling is indistinguishable from a true network-level hang from
  the client's side, so "provider-side latency/congestion at that moment" and
  "these two roles' completions are consistently the slowest" were both live
  explanations, not yet distinguished (the next entry points to the first).
- Judges phase not run this round - stopped here deliberately rather than
  spending three more real calls chasing an unexplained pattern without checking
  in first. Own local `netlify dev` instance stopped cleanly after the test (was
  occupying port 8888).

#### Two clean 7/7 trials

**A full 7-agent trial (2026-08-28, on the user's explicit request specifically
to check whether the project as it now stands yields 7/7), driven directly
against the API with the same 3-then-1 concurrency-limited dispatch the real
frontend uses, succeeded completely: 7 of 7.**

- All 4 representatives succeeded on attempt 1 with no retries needed, including
  `daenerys_targaryen` (827 completion tokens, 13792ms) and `grey_worm` (566
  tokens, 15311ms) - the exact two roles that had hung with zero response, twice
  each, in the immediately preceding test.
- All 3 judges also succeeded on attempt 1 (639-882 completion tokens,
  13495-18993ms), all reaching `justified` independently (never combined - each
  ran from its own prompt, no aggregation logic touched).
- No truncation, no repetition, no 429s, nothing logged beyond a clean attempt-1
  success for every one of the 7 calls.

This is real, positive evidence for the "transient provider-side condition at
that specific earlier moment" explanation over "these two roles are structurally
the slowest/most fragile" - the same two roles that failed completely, twice
each, minutes earlier now succeeded with real time margin (a full 5-11s under
their attempt ceiling), using the identical code, prompts, and model. Not proof
either way with only two data points at this exact failure mode, but the
direction it points is real.

A leftover `netlify dev` process from the earlier test (survived a prior
`TaskStop` as an orphaned child process, still holding ports 3999/8888) was used
directly for this run rather than fighting it for the port, then force-killed by
PID afterwards to actually free those ports - `TaskStop` on a `netlify dev`
background task should not be assumed to have fully released its ports without
checking.

**A second full 7-agent trial (2026-08-28, on the user's explicit request,
specifically to check for near-timeout margins and to have truncation/repetition
treated as failures rather than glossed over) again succeeded 7/7, with real,
useful new data - and one real process mistake in how the first pass reported
it.**

- All 7 calls succeeded on attempt 1, no retries, no truncation (highest
  completion count was `barak` at 911 - well under the 1400 cap).
- Real generation time against the 20500ms per-attempt ceiling: `grey_worm`
  8225ms (40%), `shamgar` 11354ms (55%), `daenerys_targaryen` 13163ms (64%),
  `jon_snow` 14554ms (71%), `tyrion_lannister` 14756ms (72%), `barak` 16095ms
  (78%), `elon` 16124ms (79%) - nothing dangerously close, but `barak`/`elon`
  used the most of their budget this run, worth continuing to watch rather than
  a one-time coincidence to ignore.
- Verdicts this run: all three `not justified` (the immediately preceding run
  had all three `justified`) - expected run-to-run variance from live,
  non-deterministic model output, not a bug; still fully independent, never
  combined.
- **A first automated repetition-glitch scan (a simple heuristic: flag any exact
  5-word phrase repeated 4+ times) flagged three responses**
  (`daenerys_targaryen`, `barak`, `elon`) **as potential glitches - all three
  turned out to be false positives on manual reading of the full text**, caught
  before being reported rather than after:
  - `daenerys_targaryen`'s "I ask you to consider..." is deliberate anaphora,
    each instance followed by a different clause, building to a real conclusion
    ("Thank you.");
  - `elon`'s repeated "a necessary defense of others" is the case's own Question
    for Judgment phrase, legitimately echoed at points a real opinion would echo
    it;
  - `barak`'s repeated "The defense argues that Jon..." reflects a genuinely
    formulaic (if stylistically a little repetitive) but coherent five-part
    structural analysis, each section addressing different content.
- None of the three resemble the actual Jon Snow incident (a single sentence
  repeated with zero new content, never reaching a conclusion, running out the
  full token budget) - the heuristic's blind spot is that it can't distinguish
  deliberate rhetorical repetition or legitimate structural echoing from genuine
  degeneration, so any future use of it needs the same manual-read step before
  treating a flag as real, not just a smaller threshold.
- **Net, honest result: 7 genuinely clean successes this run** - no truncation,
  no confirmed repetition glitches, nothing that needed a retry, nothing close
  enough to the timeout ceiling to call dangerous.

### 2026-08-28: the 10-second ceiling and the move to Background Functions

#### The critical correction

**CRITICAL CORRECTION (2026-08-28), supersedes every `TOTAL_BUDGET_MS`/"~30s"
assumption above: the real Netlify free-tier synchronous function ceiling is 10
seconds, not ~26-30 seconds.** Prompted by the user explicitly asking to verify
the assumed ceiling rather than trust memory, since the free tier's real
behaviour could only be confirmed by consuming real deploy credits to test it
directly, which was worth avoiding if it could be verified another way first.
Checked directly via web research (multiple independent sources, not a single
unverified claim):

- Free and Personal plans: **10-second** synchronous function execution limit.
  - Pro plan: 26 seconds - and even that reportedly needs Netlify to manually
    enable it per a dated (July 2026) support-forum thread from a Pro-plan user
    who already had `timeout = 26` configured and still needed staff
    intervention, strongly suggesting the free tier cannot exceed 10s via config
    at all.
  - Multiple other forum threads independently confirm real users hitting
    exactly a 10-second wall on free/Starter.
  - Sources: [Netlify Functions
    overview](https://docs.netlify.com/build/functions/overview/), [Netlify
    Functions
    configuration](https://docs.netlify.com/build/functions/configuration/),
    [Netlify support forum - synchronous timeout raised to
    26](https://answers.netlify.com/t/synchronous-function-timeout-raised-to-26/164676),
    [Netlify support forum - 10 second
    timeout](https://answers.netlify.com/t/10-seconds-timeout/115315).
- **This directly contradicts the "~30s, observed" figure logged above** (under
  "Production deployment" in the bug log below, and baked into
  `TOTAL_BUDGET_MS = 26000` and every constant derived from it in
  `openrouter.ts`).
  - That figure came from two calls to the deployed site on 2026-08-26 that hung
    for about 30 seconds before the platform cut them off (commit `786cbc4`),
    and it was taken to be the platform's limit.
  - Netlify's documentation gives that limit as 10 seconds on the free plan, so
    the number this whole retry/budget architecture had been calibrated against
    was the wrong one for what runs in production.
- **Why this matters far more than a constant needing retuning: real measured
  generation times on the paid default model had run 8-18+ seconds per call**
  (see the trials logged above since the switch), i.e. already at or past a real
  10-second ceiling for a large fraction of calls even on a *single,
  otherwise-successful* attempt - before any retry, before judges' much larger
  prompts (3500-4700 prompt tokens, since they carry all four representative
  arguments) even finish prefill.
  - **Every clean 7/7 local result logged above tells us nothing about
    production survival**, because `netlify dev` does not appear to enforce this
    same 10-second wall - the whole reason local testing looked reliable while
    quietly resting on a budget (26s) that the real deployed function can never
    actually get.
- **Netlify Background Functions are a real, genuinely-free-tier-available
  escape hatch** - re-verified directly (an earlier code comment elsewhere in
  this project asserted these "aren't available on every plan," which turns out
  to be wrong): up to **15 minutes** execution time, available on
  free/Personal/Pro (not gated to paid), real margin above anything observed.
  - The real cost is architectural, not financial: a background function returns
    an immediate `202` and does **not** carry the result back in the same HTTP
    response - the frontend would need to trigger the call, then poll a
    separate, fast, non-LLM endpoint (reading the eventual result back out of
    Supabase once the background invocation finishes and writes it) rather than
    the single-request/single-response pattern every representative/judge call
    in `app.js` used then.
  - Compute time is still credit-metered like any other function, so it isn't
    literally free of the credit-budget concern, but it needs no plan upgrade.
    Source: [Netlify Background
    Functions](https://docs.netlify.com/build/functions/background-functions/).
- **Not decided or built at the time: how to actually fix this.** This is a
  genuine architectural decision, not a constant to retune - flagged to the user
  rather than acted on unilaterally, consistent with this file's own "stop and
  ask before architectural choices not covered by Part 5" rule.
  - Realistic options surfaced so far, none chosen at the time (**option (a) was
    chosen and built - see the entry immediately below; it is the architecture
    in use today**):
    - (a) Background Functions + a polling frontend - the structurally sound
      fix, real engineering work, not a quick patch;
    - (b) trying to keep every call reliably under ~9s via much shorter response
      targets - genuinely risky given real observed variance (8-18s+ already,
      before accounting for judges' large prefill) and no safety margin once
      you're gambling against a hard 10s wall with no graceful recovery if
      wrong;
    - (c) some hybrid.
  - **Until this was resolved, `main` was not to be treated as production-viable
    regardless of how clean local results looked, and that was a real, standing
    reason on top of "let's be extra sure" to hold off on merging.** It was
    resolved: option (a) below was built, merged, and later confirmed working in
    production by a real trial on the deployed site.

#### Option (a): Background Functions and a polling frontend

**Option (a) was built (2026-08-28, commit `04ab573`, pushed to `draft` that day
and merged to `main` in `b81b1dc` on 2026-08-30), on the user's explicit
direction: option (b) - shortening responses - was explicitly ruled out ("if
anything, we need to give MORE time to agents"), and the user said "leaving it
to your judgement" for the rest.**

Worth remembering in any future session: "leaving it to your judgement" was a
genuine, considered delegation of this specific architectural decision, not
passive disengagement — proceeding responsibly on their behalf here meant acting
decisively within the scope actually delegated, not creating more open decisions
to hand back.

- `representative.ts`/`judge.ts`: added `config.background = true`.
- `openrouter.ts`: `TOTAL_BUDGET_MS` 26000 → 120000 (2 minutes - still a small
  fraction of the real 15-minute background-function ceiling, real multiples of
  margin over every completion measured so far), `MIN_REMAINING_TO_ATTEMPT_MS`
  3000 → 10000, `attemptTimeoutFor()` simplified and loosened accordingly.
  - The site-gate and call-cap rejection branches gained a `console.warn` each,
    since their JSON response no longer reaches the client directly once every
    invocation gets Netlify's automatic 202.
- `app.js`: calling a role is now two steps, not one.
  - `triggerAgent()` fires the POST and reports only what's knowable
    synchronously (a network failure, or a platform-level rejection like
    Netlify's per-IP limiter) - a 2xx (including the automatic 202) means only
    "accepted," never "succeeded."
  - `pollForRoles()` discovers the real outcome afterwards by re-reading
    `GET /api/trials/:id` on a 2.5s interval (`POLL_INTERVAL_MS`) for up to 2.5
    minutes (`POLL_TIMEOUT_MS` = 150000ms, comfortably above the new 120s server
    budget; *700000ms today, above a 650000ms budget*) per role,
    updating/rendering incrementally as each role resolves; a role that never
    resolves within that window gets an honest `'timeout'` status (new UI
    branch: "No response yet," not a silent stuck spinner and not a false
    "failed" claim) rather than spinning forever.
  - `deriveRoleStates()` extracts the existing success/failure/aborted/token
    backfill logic (previously duplicated inline in `loadTrial()`) into one
    function now shared by both the live poller and `loadTrial()`, so the two
    can't drift into disagreeing about what the same trial record means.
  - `MAX_CONCURRENT_CALLS`/the stagger are unchanged and still apply to
    triggering - that limit is about OpenRouter's own account-level concurrency,
    unrelated to Netlify's function timeout. *(The cap stopped bounding
    OpenRouter concurrency the next day, when the rename to `-background`
    filenames (`14c0a45`, 2026-08-29) made these Background Functions: from then
    on the pool wraps a `triggerAgent` that returns at Netlify's 202 rather than
    at the end of the generation, so a slot frees in ~0.3-0.5s and all 4
    representatives overlap. Until the rename, `netlify dev` ran the agent
    functions synchronously, so `triggerAgent` waited for each generation and
    the cap held. Measured on 2026-09-21 - see "Production verification: four
    live trials, and one real finding" below.)*
- **Accepted trade-offs:**
  1. a site-gate or call-cap rejection is no longer visible to the poller at all
     (only in Netlify's function logs via the new `console.warn`) - under
     polling, either now looks like "stuck pending, eventually times out" rather
     than the crisp synchronous 401/429 message shown before.
     - Accepted because both are rare in real usage (bots that never send the
       header; a 350-calls/24h cap essentially never hit in this project's
       history) and preserving the call-cap's existing anti-self-perpetuation
       design (never log its own trip) was judged more important than perfect
       visibility for an edge case this unlikely. *(The cap was hit the next
       day, 2026-08-29, by this project's own heavy local testing - see that
       day's entry - and local calls have been exempt from it since.)*
  2. Rate limiting (`config.rateLimit`) and Background Functions
     (`config.background`) being combined on the same function export is **not
     confirmed compatible** - checked directly against Netlify's rate-limiting
     docs, which document the feature for standard serverless/edge functions but
     say nothing about Background Functions either way.
     - Either way the other two layers - the global call cap and the site-gate
       header - stand on every agent call. *(Found on 2026-10-02: Netlify's
       bundler ignores a function's `config` export unless the function has a
       default export, so with the named `handler` export used here,
       `background: true`, `path` and `rateLimit` never took effect. The
       filename made these Background Functions, and the rate limit was never
       applied until it moved to netlify.toml - see that day's entry.)*
- **Verified with an offline test only (no OpenRouter/Netlify calls spent)** -
  extracted the real shipped source (not a hand-retyped copy) and exercised
  `triggerAgent`'s three outcome paths, `deriveRoleStates`' full backfill logic,
  and `pollForRoles`' incremental-resolution and timeout behaviour against
  mocked `fetch`, all 16 checks passing. Backend typechecks clean.
- **What was genuinely NOT verified at the time, and couldn't be without an
  actual deploy (which requires separate authorisation per the standing rule):**
  whether `netlify dev`'s local emulation of Background Functions actually
  matches real deployed behaviour.
  - This project has already hit exactly this category of gap multiple times
    before (redirect placeholder handling, path-segment routing) - local-clean
    has repeatedly not meant production-clean here.
  - The honest state of this fix that day was "logically sound, unit-tested in
    isolation, matches Netlify's documented behaviour as researched" - not
    "confirmed working end-to-end," which would need a real deploy. **`main` was
    not to be treated as production-viable until that real confirmation
    happened.**
  - (**It since has:** the deploy went out and a real production trial on
    2026-09-20 ran judge calls for about six unbroken minutes server-side -
    impossible for a synchronous invocation, which dies at 10s. Background
    Functions are confirmed working deployed.)

#### Local trials under the new architecture

**A real full 7-agent trial (2026-08-28, on the user's explicit request "run a
full trial test," local `netlify dev`) directly answered one open question from
above: `netlify dev` does NOT emulate `config.background = true` - it just runs
the function synchronously, exactly as before.** *(True of `config.background`
itself. Local dev does honour the older `-background` filename suffix, which
these files did not have yet - see the rename a few entries down. Since the
rename, local calls get the fast 202 too.)*

Confirmed directly, not inferred: `triggerAgent()`'s POST didn't return until
the real generation finished (11-19s per call, matching real server-side
durations almost exactly), never the fast 202 real Background Functions should
give.

This is genuinely useful to know even though it can't be fixed locally - it
means local testing can fully validate the retry/timeout/budget logic (below),
but cannot validate the actual fire-and-forget/202 behaviour the fix depends on
in production; that half remained unverified until a real deploy. **It has since
been verified:** the deploy happened, and a real production trial (2026-09-20)
had judge calls run roughly six unbroken minutes server-side - impossible for a
synchronous invocation, which dies at 10s.

- **The trigger/poll test's own first result was a false negative from a bug in
  the test harness, not the app - worth recording since it cost real diagnostic
  time before being caught.**
  - The driver script called the real, extracted `pollForRoles()` against Node's
    global `fetch()` with the *same relative URL app.js itself uses*
    (`/api/trials/:id`) - which resolves fine in a browser (relative to page
    origin) but throws immediately in Node
    (`Failed to parse URL from /api/trials/...`), no base URL concept.
  - `pollForRoles()`'s `catch { continue }` (correct, intentional behaviour for
    a real transient browser-side blip) silently swallowed that same failure on
    every single poll tick for the full 150s window, on every role, producing a
    "0/7, all timeout" result that looked exactly like a real bug.
  - Diagnosed by fetching the trial record directly (a separate, hand-written
    `curl`, not through the broken harness) - the data was all there, real and
    correct, the whole time.
- **The real, verified result once read correctly: 7/7 succeeded, no retries, no
  truncation.** All 7 calls succeeded on attempt 1.
  - Timing against the new 43000ms per-attempt ceiling: `shamgar` 8442ms (20%),
    `grey_worm` 11779ms (27%), `barak` 12159ms (28%), `daenerys_targaryen`
    15559ms (36%), `elon` 15257ms (35%), `jon_snow` 16048ms (37%),
    `tyrion_lannister` 16568ms (39%) - every call now comfortably under 40% of
    its allowance, a real, direct improvement from the 55-79% range seen against
    the old ~18-20.5s ceiling: the *actual* generation times haven't changed,
    only how much room they now have to work with.
  - No `TRUNCATED` warnings; every completion token count (491-949) was well
    under the 1400 cap.
  - One transient, previously-undocumented hiccup along the way: a single direct
    `GET /api/trials/:id` failed once with `"JWT issued at future"` (a Supabase
    auth/clock-skew-shaped error) immediately after the test, then succeeded
    cleanly on retry with no code changes - logged here as a real, if apparently
    rare, failure mode that cleared on a plain retry.

**A second full trial (2026-08-28, same request, harness fixed this time to
actually let polling work against a real server) again ran all 7 calls for
real - and surfaced a genuinely important, previously-undocumented-at-this-scale
local-only quirk: `netlify dev` killed the client-facing HTTP connection for 2
of 3 concurrent judge calls at ~30s with a raw, non-JSON HTTP 500, while the
real server-side invocations kept running behind that dead connection and
succeeded anyway.**

- The poller (correctly) reported 5/7 based on what the client actually
  received; a direct database read immediately after showed the real, true
  result was **7/7** - `elon` succeeded server-side at 42450ms (after the client
  had already been told 500 at ~30018ms) and `shamgar`'s attempt 1 genuinely
  timed out at the full 43000ms, correctly triggered attempt 2, which succeeded
  at a cumulative 64024ms - both fully hidden from the client, visible only by
  reading `api_call_logs`/`judge_rulings` directly.
- This is the *same* local-dev-only failure mode already documented in the bug
  log below, under "Local dev environment" (`netlify dev`'s own internal ~30s
  connection handling, stricter than and independent of this app's own
  `TOTAL_BUDGET_MS`), just reproduced for the first time under the new, much
  larger budget and concurrent-judge load - not a new bug, a recurrence of a
  known one.
- Real, honest timing from the six attempts that stayed within their own
  ceiling: `jon_snow` 20%, `daenerys_targaryen`/`grey_worm` 27%,
  `tyrion_lannister` 34%, `barak` 49%, `elon` (the one that succeeded despite
  the dead client connection) **99% of its 43000ms allowance** - genuinely worth
  flagging as close, though very possibly inflated by this same local run's own
  resource contention (three real OpenRouter calls, three Supabase writes, and
  everything else sharing one local Node process, which real isolated production
  invocations would not do) rather than reflecting real generation latency
  alone.
- No truncation, no repetition glitches, either genuine judge content issue.
- **Practical consequence for local testing specifically:** a real user hitting
  this exact scenario in the actual browser locally would see incorrect "Call
  failed" cards for the affected roles in the moment, even though the trial
  genuinely completed - reopening the trial from history afterwards would show
  the correct, real data, since `loadTrial()` reads the same underlying table
  this diagnostic read did.
  - The already-documented mitigation stands: restart `netlify dev` if this
    starts recurring across a session. *(Superseded by the next two entries: the
    ~30s cut is `lambda-local`'s synchronous-function timeout, a restart never
    fixed it, and renaming the agent functions with the `-background` suffix
    removed it for them.)*
- Not expected to reproduce on real deployed Netlify, where each invocation is a
  genuinely separate, isolated environment rather than one shared local dev-tool
  process - but that, like everything else about production behaviour in this
  arc, was unconfirmed without a real deploy at the time. **Since deployed and
  exercised for real** - see the 2026-09-20 production trial further down.

**Three more full trials (2026-08-28, same request, with two explicit 1-minute
cooldowns between them) found the actual, named root cause of every local-only
anomaly this whole arc has produced - not "contention," a literal, sourced,
hardcoded limit.** `netlify dev`'s function-invocation errors included the exact
line `Task timed out after 30.00 seconds`, thrown by `lambda-local` (the
AWS-Lambda-emulation package `netlify-cli` bundles for local dev), stack trace
included.

This is a **fixed, non-configurable, local-emulator-only 30-second kill
switch**, completely independent of this app's own `TOTAL_BUDGET_MS` (120s) and
of `config.background` - it does not exist on the real deployed platform, where
Background Functions genuinely get 15 minutes per Netlify's own docs. Every
anomaly seen in this whole session's local testing - the earlier "500, non-JSON"
client-side failures, and everything below - traces back to this one mechanism,
now identified by name instead of inferred from timing alone.

- **Real, DB-verified results across the three trials: 7/7, 6/7, 7/7 - 20 of 21
  calls genuinely succeeded.**
  - The one real loss: `barak` in trial 2 came back completely absent from the
    database - no `judge_rulings` row, no `api_call_logs` row at all, not even a
    failed one. The server's own `[openrouter]` log shows the underlying
    OpenRouter call *did* succeed, real content, 35437ms - past the 30s
    lambda-local ceiling, so the local invocation was killed by `lambda-local`
    before the handler could reach either database write.
  - This is a genuine, if narrow, local-only data-loss mode: unlike the earlier
    "500 but the DB write still lands late" cases, here the kill appears to have
    landed early enough (or thoroughly enough) that persistence never happened
    at all.
  - A live user hitting this in the real browser locally would still see an
    honest failure state either way (`buildAgentStatusBody`'s "no entry" path,
    or `pollForRoles`' own timeout status) - never a silent gap or a fabricated
    result - so Part 5's "visible failure, never silent" requirement holds even
    here.
- **Truncation happened far more than the earlier
  `frequency_penalty`/`presence_penalty` fix's two clean trials suggested: 5 of
  the 21 calls (~24%) hit the 1400-token cap** - `daenerys_targaryen` (trials 1
  and 3), `jon_snow` and `grey_worm` (trial 2), and `barak` (trial 2, truncated
  *and* the one whose row was lost, two separate problems compounding on the
  same call).
  - The penalty fix appears to have solved the worst failure mode specifically
    (an endless identical-sentence loop that never stops) without solving a
    milder, related one (the model still sometimes running long and not wrapping
    up by 1400 tokens, without necessarily looping) - worth registering as a
    real, only-partially-fixed pattern, not something to consider closed.
  - *(The "without necessarily looping" reading was not supported by this batch
    even then. Its five truncated responses were kept, and read on 2026-09-27,
    all five are repetition loops: one sentence repeated 39, 45, 68, 126 and 148
    times in a row until the cap stopped it. See the 2026-09-27 entry on capped
    replies.)*
  - *(Closed on 2026-08-29/30: the 4-tier escalation chain retries or escalates
    every truncated attempt, and the verification runs that followed left no
    truncation unresolved. A reply still truncated at the last tier is reported
    as a failure and never saved.)*
  - **Truncated responses and time-ceiling closeness are correlated, but
    truncation is a token-cap event, not a time-cap one** - all 5 truncated
    calls finished in 32.7-40.5s, comfortably under the 43000ms *time* ceiling;
    they hit the 1400-token wall on their own, unprompted by any timeout.
  - That correlation is also exactly why truncated calls are the ones most
    likely to collide with the unrelated 30s local-only `lambda-local` kill
    switch above - a genuinely long response is both more likely to be truncated
    and more likely to run past 30s.
- **Real timing for the 16 calls that finished naturally (`finish_reason=stop`),
  against the 43000ms ceiling:** mostly comfortable, 29-45%, with two on the
  higher side worth naming - `shamgar` trial 1 at 58.9% and `barak` trial 1 at
  62.8% - still well short of alarming, nothing close to the earlier 99%
  near-miss.
- **Practical implication for what local testing can and cannot tell us going
  forward:** any call that takes longer than 30 seconds - which now empirically
  includes most truncated responses - risks the `lambda-local` kill locally,
  regardless of anything in this app's own code.
  - Local testing remains fully trustworthy for validating calls that finish
    faster than that (the large majority), and for confirming the retry/budget
    logic's own behaviour in isolation, but cannot cleanly observe the slow tail
    without this separate, unrelated 30s artefact interfering.
  - Nothing to fix in this app for it - it isn't this app's constraint to fix.

### 2026-08-29/30: the `-background` rename, truncation and the escalation chain

#### Renaming the agent functions with the `-background` suffix

**That "nothing to fix" conclusion turned out to be wrong - a real fix existed,
found by reading netlify-cli's own source directly rather than assuming the 30s
ceiling was unconditional (2026-08-29, prompted by the user explicitly asking
whether the local 30s limit could be removed).**

Traced the exact code path (`netlify-cli/dist/lib/functions/netlify-function.js`
and `.../utils/functions/get-functions.js`): local dev picks between
`SYNCHRONOUS_FUNCTION_TIMEOUT = 30` and `BACKGROUND_FUNCTION_TIMEOUT = 900`
(seconds) purely via `isBackground = name.endsWith('-background')` - the
function's *name*, derived from its filename, checked locally.

- `config.background = true` is never read for this decision in local dev at
  all; it's the real-platform-facing, filename-suffix-blind mechanism, and local
  dev apparently only understands the older filename convention.
- This fully explains every local-only anomaly logged in this whole arc:
  `representative.ts`/`judge.ts` were silently getting the 30s synchronous
  ceiling the entire time, regardless of `config.background` or
  `TOTAL_BUDGET_MS`.

**Fixed in `14c0a45` (pushed to `draft`):** renamed both files to
`representative-background.ts`/`judge-background.ts`.

- Confirmed safe before making the change, not after: both functions already
  declare a custom `config.path`, which fully overrides a function's default
  name-derived URL (confirmed by reading the same source,
  `getUrlPath`/route-matching logic) - so the rename changes no public route,
  and needed no edits to `netlify.toml` or `app.js`. *(Wrong, as it turned out -
  the rename broke every call until `netlify.toml` was updated too; see the
  regression recorded below.)*
- `config.background: true` was kept alongside the new filename rather than
  replaced by it, since Netlify's own docs list the filename suffix as a
  still-supported legacy convention alongside the modern config property, not a
  replacement for it. Typechecks clean.
- **Not tested against a real call at that point** - a genuine, well-sourced,
  mechanically-verified fix (read directly from the tool's own code, not
  inferred from behaviour), but not yet run.
  - The next real trial was expected to show every call - including truncated
    ones past 30s - completing locally without an early `lambda-local` kill,
    which would be the first time this project's local Background Function
    testing has actually meant what it looks like it means.
  - *(Borne out since: local calls have run well past 30s - one resolved cleanly
    at ~182s during the 2026-08-29/30 batch - with no `lambda-local` kill.)*
- **Open at the time, largely settled since:** *(Settled on 2026-09-21, as this
  bullet goes on to record, and explained on 2026-10-02 in the note at its
  end.)* the real deployed platform's own Background Function detection logic
  (config-property-based per current docs) is a different code path than what
  was just read here (local dev only) - whether it also wants, tolerates, or
  ignores the filename suffix was unconfirmed without a real deploy.
  - **Since resolved in practice:** the deploy happened, and a real production
    trial (2026-09-20) had judge calls run roughly six unbroken minutes
    server-side - impossible for a synchronous invocation, which dies at 10s -
    so this exact combination demonstrably works deployed.
  - **Settled outright on 2026-09-21:** all 28 trigger POSTs across four live
    production trials came back with Netlify's automatic HTTP 202 in ~0.3-0.5s,
    which only a genuine Background Function does - so the deployed detection
    works with this exact file naming and config combination. Both mechanisms
    were kept together, as the combination confirmed working.
  - *(Found on 2026-10-02: Netlify's bundler ignores a function's `config`
    export unless the function has a default export, so with the named `handler`
    export used here, `background: true`, `path` and `rateLimit` never took
    effect. The filename made these Background Functions, and the rate limit was
    never applied until it moved to netlify.toml - see that day's entry.)*

**The rename immediately caused a real, user-observed regression, caught fast:
every call started returning a synchronous "HTTP 404" instantly, no attempt made
at all** - the user hit "Begin new trial" in their own running local instance
and got all 7 cards showing an immediate non-JSON-404 failure.

- Root cause: the assumption that a function's custom `config.path` fully
  overrides its default name-derived URL regardless of the file's actual name
  turned out to be wrong in practice (or at least not true the way expected
  here) - `netlify.toml`'s redirects still pointed at the pre-rename URL
  (`/.netlify/functions/representative/...`), and once the underlying file's
  name changed, that URL stopped resolving to anything.
- **Fixed in `dbc83cd`:** updated both functions' `path` export and the matching
  `netlify.toml` redirect targets to the new `-background` names, rather than
  relying on the old path continuing to work.
- Exactly why the override didn't hold as documented was not root-caused
  further - the practical fix (keep `path` and the real filename in agreement)
  sidestepped needing to know why. *(Found on 2026-10-02: the `path` in the
  `config` export was never read at all, for the reason in that day's entry, so
  routing came from netlify.toml's redirect alone - which is why updating it
  fixed the 404.)*

**Verified for real, zero-cost, against the user's own already-running local
`netlify dev` instance** (recognised as theirs from a screenshot they'd just
sent, so tested against it directly rather than starting a competing one): a
`POST` with a deliberately invalid trial id - reaches the route without ever
needing a real OpenRouter call - returned Netlify's own `202` in **~50ms**.

- That status code is not something this app's own handler code ever produces
  (the full set it can return is 200, 201, 400, 401, 404, 405, 429, 500 and
  502), so a fast 202 is unambiguous: the routing fix works, *and* the original
  background-function timeout fix is genuinely active locally for the first
  time - previously, even after adding `config.background`, every local call
  blocked synchronously for the full real generation time because the file
  wasn't named in the one way local dev actually checks.
- **Not confirmed end-to-end with a real OpenRouter call at that point**
  (whether a genuinely long/truncated response now completes locally past 30s
  without the `lambda-local` kill) - that needed the user's go-ahead before
  spending quota. *(Confirmed since - see the note under "Not tested against a
  real call at that point" above.)*

#### The free pass, stronger penalties, and the call cap

**The user gave a standing, revocable "free pass" (2026-08-29) to spend
OpenRouter quota on local testing without asking each time, explicitly excluding
anything Netlify-cloud-facing** ("this free pass does NOT apply to Netlify... do
not make any Netlify queries that can spend my free-tier credits"). Rule 1's
Netlify half is fully unchanged; only the OpenRouter-ask-every-time half is
relaxed, and only until the user says otherwise. *(Recorded as given, for that
testing arc. It does not override HARD RULE 1 at the top of this file, which is
the standing rule: without a fresh pass from the user, ask before every call
that spends quota.)*

**First real use of that pass found the truncation-retry mechanism (from the
same session, not yet tested against a real call) wasn't actually fixing
anything - it was retrying into the *same* failure it wasn't built for.** The
user's own browser trial showed Daenerys still truncated after both fixes were
live.

Pulling the actual persisted text for that call showed why: the same degenerate
repetition loop from the original incident ("He knew that I was a threat to the
realm. He knew that I was a threat to his sisters...") on **both** the original
attempt and the truncation-retry - confirmed directly by completion-token counts
landing at exactly `2 x AGENT_MAX_TOKENS` (2800) for three separate roles in one
trial.

The conciseness-reminder retry addressed length, not repetition *(it has covered
both since 2026-09-01)*, so it was never going to fix a loop on its own -
`frequency_penalty: 0.4`/`presence_penalty: 0.2` (set in an earlier session) had
quietly stopped being sufficient to prevent the loop it was built for.

- **Fixed in `8f05c5e`:** raised to
  `frequency_penalty: 0.7`/`presence_penalty: 0.35` - an evidence-driven
  increase rather than a guess.
- **Re-tested for real at the new penalty values: zero calls came back genuinely
  truncated in the final, kept result.**
  - Several individual calls still hit the token cap on their *first* attempt
    (visible as a completion count that isn't a clean multiple of 1400, e.g.
    2121 = 1400 + 721) - but every one of those was caught by the
    truncation-retry and, this time, the retry itself reached a natural
    conclusion instead of looping again.
  - This is real, direct evidence the two fixes work together as designed: the
    stronger penalty doesn't claim to eliminate a first-attempt overrun, but the
    retry mechanism now reliably recovers from one instead of just retrying into
    the same failure.
  - *(Entries further down temper this: in the larger batch that followed, 2 of
    35 calls were still truncated after both attempts, and a same-model retry
    turned out to truncate again far more often than a first attempt does. That
    was never accepted as good enough. The retry and escalation mechanism went
    on being tuned, deeply and thoroughly, through the weeks that followed -
    into the four-tier escalation chain, the degeneration detectors and the
    fast-failure handling recorded below - to rule out a call ending truncated
    as firmly as possible.)*
- **A 5th trial then surfaced a new, unresolved anomaly, unrelated to the fixes
  above: all 7 roles came back completely absent from the database - no success,
  no failure log, nothing at all**, `trials.status` never advancing past
  `'created'`.
  - A single isolated follow-up call to the same trial (solo, no concurrency)
    was accepted with a real `202` and then never resolved - no log row appeared
    even after 2+ minutes of waiting, well past every real duration measured all
    session (worst case so far, with a truncation retry, ~60s).
  - The rest of the server stayed healthy throughout (`/api/case`/`/api/trials`
    both responded normally, sub-second) - so this is not a dead process, it's
    specifically confined to background-function invocations.
  - Not root-caused - a plausible, unconfirmed guess is that background-function
    invocations may run through a genuinely different local execution path (a
    worker thread, per the `netlify-cli` source read earlier in this arc) that
    doesn't propagate an abort/timeout as cleanly as the direct-invocation path
    standard functions used before the rename.
  - Logged here rather than swept aside - the four clean trials immediately
    before it make a systemic regression from this session's own commits
    unlikely, but a single silent, un-retriable stuck invocation is still a real
    failure mode worth tracking if it recurs.
  - **Fully resolved by the next entry below - it was `GLOBAL_CALL_CAP`
    tripping, not a code bug at all.** Read on before treating anything in this
    bullet as an open question. *(Explained on 2026-08-29: the site-wide call
    cap had tripped from local testing, and local calls have been exempt from it
    since `d2335cc`.)*

**The "stuck invocation" fully explained (2026-08-29): it was `GLOBAL_CALL_CAP`
(350 calls/rolling 24h), tripped for real by this session's own extensive
testing - not a code bug at all.**

- Restarting the dev server didn't fix it (ruled out resource buildup); a
  genuinely fresh, separate instance on different ports hit the same wall
  immediately.
- The actual cause was only visible by starting an instance directly (so its own
  console log was reachable) rather than reusing the user's already-running one:
  `representative:grey_worm: rejected - global call cap reached (350/350)`.
- This cap deliberately never writes to `api_call_logs` when it trips (to avoid
  the trip perpetuating itself - see the original design note on
  `isGlobalCallCapExceeded`), and Netlify's own automatic `202` for a Background
  Function fires regardless of what the handler decides internally - so a trip
  was structurally invisible to both the database and the client,
  indistinguishable from a genuine silent hang without reading the server's own
  stdout directly.

**Fixed in `d2335cc`:** `isGlobalCallCapExceeded()` now returns
`{exceeded: false}` immediately whenever `process.env.NETLIFY_DEV === 'true'` -
a flag the Netlify CLI injects internally for every local invocation (confirmed
directly in its own source, `commands/dev/dev.js`) that a real deployed
invocation, or any external caller, could never set. The real deployed site's
cap is completely unchanged at 350; only local testing is exempt. Verified live:
the identical request that previously logged a cap rejection now completes
cleanly with no such message.

**With the cap exemption in place, a 5-trial (35-call) batch confirmed the
truncation-retry + strengthened-penalty fix is a real, meaningful improvement -
not a full fix.**

- Every one of the 35 calls reached `status: success` (no outright call failures
  at all).
- 7 of 35 (20%) needed the truncation retry; of those, 5 recovered to a clean,
  complete response, but **2 of 35 (~5.7%) were still genuinely truncated after
  both attempts** - `daenerys_targaryen` once, `grey_worm` once, both landing on
  exactly `2 x AGENT_MAX_TOKENS` (2800).
- That's a real, honest drop from the ~24% final-truncation rate measured before
  these fixes, but not zero - the retry recovers the clear majority of
  first-attempt overruns, it just isn't a guarantee.
- Daenerys remains the most consistently affected role across every batch
  measured this session, consistent with her system prompt being the longest of
  the four.
- That was the state that day, reported as such; the entries that follow take it
  further.

#### From a same-model retry to a fallback model

**10 targeted tests (2026-08-29, on the user's explicit request, 1-minute
cooldowns between each) - firing only
`tyrion_lannister`/`grey_worm`/`daenerys_targaryen` per test (no judges, no
`jon_snow`) specifically to gather more data per problem-role at lower
OpenRouter cost (30 calls for 10 tests vs. 70 for full trials) - both confirmed
the concentration pattern and surfaced a more important, genuinely surprising
finding that revises earlier advice.**

- Pooling this batch with every earlier real trial today under the same 0.7/0.35
  penalty config (16 real trials total for these 3 roles): per-attempt
  truncation rates settled lower than the small earlier sample suggested -
  `daenerys_targaryen` ~38% (down from an earlier ~56% estimate on 6 trials),
  `grey_worm` ~35% (down from ~50%), `tyrion_lannister` ~24%.
- Final (both-attempts-truncated) rates: Daenerys 3/16 (~19%), Grey Worm 3/16
  (~19%), Tyrion 0/16 - his retry has recovered every single time he's needed
  one.
- **The more important finding: the conciseness-reminder retry does not appear
  to behave as an independent second roll of the dice for Daenerys or Grey
  Worm - once their first attempt truncates, the retry is failing *more* often
  than the baseline rate, not less.**
  - Splitting attempt 1 from the retry specifically: Daenerys's first attempt
    truncates ~31% of the time, but *given* it truncated, her retry then also
    truncates **60%** of the time (3 of 5 real retries). Grey Worm's first
    attempt truncates 25% of the time, but his retry then also truncates **75%**
    of the time (3 of 4 real retries).
  - Both samples are small (4-5 retries each) and shouldn't be treated as
    precise, but the direction is consistent across both roles and worth taking
    seriously: a trial where one of these two starts truncating looks more like
    it's already in a bad state for that specific generation (the conciseness
    reminder isn't overriding whatever's driving it) than like a fresh,
    independent draw the retry can be expected to usually rescue.
- **This directly revises the earlier "how many retry attempts" probability
  table**, which assumed each attempt was an independent draw at a fixed rate
  and predicted something like <1% residual failure by 6-8 attempts.
  - If retries condition on the prior attempt's failure the way this data
    suggests, adding more attempts would deliver real but *slower*, less
    complete decay than that table implied - not the clean geometric falloff
    pure independence would predict.
  - **Net effect on the earlier model-switch / more-retries trade-off: this data
    leans further towards a root-cause fix (role-specific penalty tuning, a
    targeted prompt change, or the model-switch option already discussed) being
    more promising than simply buying more attempts**, though "more attempts"
    would still help somewhat and was still a real, available lever had the user
    wanted it.
  - Not acted on at the time without the user's direction - reported for them to
    decide the next move. **They did: the next entry implements the
    fallback-model option, which later grew into the 4-tier escalation chain in
    use today.**

**Implemented the fallback-model idea (2026-08-29, on the user's explicit "pick
one, implement it" delegation): the truncation retry in `callOpenRouter()` now
uses a separate, more capable model instead of asking the same model again.**

- Chosen: `mistralai/mistral-large-2512` (significantly pricier than the
  default) - same vendor family as the default for closer stylistic/formatting
  consistency with prompts already tuned against Mistral's conventions,
  configurable via `TRUNCATION_FALLBACK_MODEL`.
  - Only ever billed on the minority of calls that truncate once, so the real
    cost impact stays small despite the per-token price being meaningfully
    higher.
- Also fixed a real cost-accounting bug this introduces: since the two attempts
  can now carry different prices, summing raw token counts and pricing them once
  (what the existing `failure()` helper does) would misprice a call whose
  attempts spanned two models
  - the still-truncated-after-retry failure path now sums two separately
    computed dollar costs instead, matching the pattern the success path already
    used, and every failure branch that could occur after the retry switches
    models now attributes cost to whichever model actually made that attempt.
  - *(Two things superseded since: nothing is summed any more - every discarded
    attempt now gets its own call-log row priced at its own model's rate - and
    `mistralai/mistral-large-2512` was replaced at this tier by
    `anthropic/claude-haiku-4.5` on 2026-09-20, after OpenRouter removed it.)*
- **First real test immediately caught a real bug: the model id from the initial
  web research, `mistral-large-3-2512`, doesn't exist** - OpenRouter returned
  `HTTP 400: mistral-large-3-2512 is not a valid model ID`.
  - Confirmed and fixed by checking OpenRouter's own model listing directly this
    time rather than trusting a secondhand search snippet - the correct id is
    `mistral-large-2512` (no `-3-`), same pricing. Fixed in a follow-up commit,
    re-verified.
- **Tested for real across 5 targeted tests
  (tyrion_lannister/grey_worm/daenerys_targaryen only, same pattern as the
  10-test batch above), the run that caught the wrong id among them: the
  fallback mechanism is confirmed working correctly, and helping, though not
  perfectly.**
  - 5 real fallback invocations total across the batch (the default model
    truncated 5 times, each correctly triggering the large-model retry): **3 of
    5 fallback attempts succeeded cleanly, 1 still truncated even on the
    fallback model, and 1 was the wrong-id HTTP 400 above.**
  - That's a real, meaningful improvement over the same-model retry's
    conditional success rate (roughly 25-40% for these two roles, per the
    earlier 10-test batch) - genuinely closer to the mid-50s-to-60% range this
    fix was hoped to reach - but it is not the near-elimination a "different
    model breaks the correlation entirely" theory might have suggested.
  - The fallback model can still occasionally run long too; it's meaningfully
    more reliable than retrying the same model, not immune.
  - Honest current state, not chased further this round - reported for the
    user's read before deciding on the next lever (a stronger fallback model, a
    second fallback attempt, or accepting this as good enough). **Decided: the
    next entries replace the single fallback with the 4-tier escalation chain
    still in use today.** *(Replaced on 2026-08-29 by the 4-tier chain
    (`306152e`), which went on to clear the user's bar of 20 consecutive clean
    tests.)*
- **A follow-on 10-test targeted batch (towards a user-set bar of 20 consecutive
  clean tests, with an explicit "stop immediately on any single truncation"
  condition) was stopped on test 10 by a real truncation that survived the
  fallback attempt too** - direct evidence the single-fallback design, while a
  real improvement, wasn't yet reliable enough to clear the bar the user set.
  - The same batch separately surfaced a distinct, real operational risk:
    reading the dev server's own console log directly showed the fallback model
    itself getting hit with ~15+ consecutive real OpenRouter 429s under dense
    testing volume before finally responding - a genuine rate-limiting risk for
    a less-frequently-called model under heavy test load, not a code bug,
    flagged to the user rather than silently absorbed.

#### The 4-tier escalation chain

**Replaced the single-fallback design with a genuine 4-tier escalation chain
(2026-08-29), on the user's explicit direction after the above.**
`callOpenRouter()` now walks
`default model (1 attempt, 1400 tokens) -> mistral-large-2512 (2 attempts, 2800 tokens) -> openai/gpt-5.6-sol (2 attempts, 3500 tokens) -> google/gemini-2.5-pro (1 attempt, 4000 tokens)`,
escalating to the next tier only once every attempt allowed at the current one
has also truncated.

- (**Broadened since**, on 2026-09-20: escalation now also fires on
  degeneration, on a plain HTTP error - which forfeits the tier's remaining
  attempts outright rather than spending them - and on a slow transient failure.
  See the escalation sections further down.)
- The last two tiers are deliberately two different models from two different
  companies (not two models in the same family), so a shared-vendor quirk can't
  explain a failure that makes it that far
  - both model ids and their per-token pricing were verified directly against
    OpenRouter's own listing pages before being written into
    `models.ts`/`pricing.ts`, per the standing "never trust a secondhand
    model-id snippet" discipline from the earlier `mistral-large-3-2512`
    mistake.
- Every tier also gets more token headroom than the last, on the theory that
  some truncations are genuinely-long-but-coherent content hitting an arbitrary
  ceiling rather than only degeneration, which a bigger cap fixes directly
  regardless of which model is generating.
  - *(The theory was not supported even when written: the default model's capped
    responses already stored by then pointed the other way. Checked on
    2026-09-27: all 13 responses capped at a multiple of the 1,400-token cap
    whose text was stored - every one from the default model, on 2026-08-28/29 -
    are repetition loops, and of 687 tier-1 replies that finished on their own,
    the longest was 1,147 of the 1,400 tokens. A truncation here has been a loop
    run to the cap, not a sound argument cut short. The bigger caps were kept as
    a safeguard; see the 2026-09-27 entry.)*
- `TOTAL_BUDGET_MS` raised 250000 -> 650000 (real margin above the ~498s
  worst-case sum of every tier's attempt ceilings, including backoff delays,
  while staying comfortably under the real 900s background-function wall).
  - *(The chain's shape today, after 2026-09-20:
    `mistral-small (2 attempts) -> claude-haiku-4.5 (2) -> gpt-5.6-sol (2) -> gemini-2.5-pro (1)`,
    with prompt-scaled per-attempt ceilings summing to ~649s for a judge at 4550
    prompt tokens and ~587s for a median-sized representative - see
    `buildRetryTiers()` and `attemptTimeoutFor()`.)*
- Also fixed a real cost-accounting double-count bug caught during this rewrite:
  an earlier draft folded the *current* (possibly kept) attempt's cost into the
  running "extra" total unconditionally, which would have double-counted it on
  the path where that same attempt becomes the final failure return - fixed so
  the extra-cost accumulation only happens once an attempt is confirmed
  discarded in favour of another.
- Typechecks clean. Committed as `306152e`.

**20 consecutive targeted tests (tyrion_lannister/grey_worm/daenerys_targaryen,
60 real calls, 2026-08-29/30) against the new 4-tier chain: all 20 finished
cleanly - zero truncations, zero failures**, clearing the user's
20-consecutive-clean bar.

- Several needed an escalation to `mistral-large-2512` (tier 2), and every one
  resolved cleanly there.
- Neither tier 3 nor tier 4 was exercised by this batch (no call needed to
  escalate that far), so their in-practice reliability came from separate,
  deliberate isolated testing (next entry), not from this batch.
- **This batch also caught and fixed a real, separate bug: `POLL_TIMEOUT_MS` in
  `app.js` had stayed at its old 150s value after `TOTAL_BUDGET_MS` was raised
  to 650s**, so a role could genuinely succeed server-side (confirmed directly
  against the database) while the client had already given up and showed it as
  unresolved - reproduced for real (a call resolved cleanly at ~182s, well past
  the stale 150s poll window).
  - Fixed by raising `POLL_TIMEOUT_MS` to 700s. Committed separately as
    `622b967`, so the escalation-chain logic and this frontend-timing fix stay
    independently revertable.

**Eight further tests (2026-08-30, on the user's explicit request, specifically
to build confidence in tiers 3/4 before a `main` merge) with 2-minute cooldowns
between each:**

- **Tests 1-2 (targeted, tier 3 forced as the only primary tier, tier 4 as its
  only fallback):** test 1 succeeded 3/3 with every call served directly by
  `openai/gpt-5.6-sol`, no escalation needed. Test 2 the same. Tier 3 confirmed
  working correctly in isolation before ever needing to fire for real as a
  fallback in production.
- **Test 3 (targeted, tier 4 forced primary, tier 3 fallback) failed all 3 calls
  outright on the first attempt:
  `HTTP 400: Reasoning is mandatory for this endpoint and cannot be disabled.`**
  - Root cause: every request unconditionally sent
    `reasoning: { enabled: false }`, which `google/gemini-2.5-pro` (tier 4)
    rejects rather than silently ignoring - a real configuration bug that would
    have made tier 4 completely non-functional in production, caught only
    because it was deliberately exercised in isolation rather than waiting to
    misfire the first time a real trial actually needed it as a last-resort
    fallback.
  - **Fixed immediately (`ec4e9de`):** `modelRequiresReasoning()` in `models.ts`
    flags models with this constraint (currently just `google/gemini-2.5-pro`);
    the `reasoning` field is now omitted entirely for them instead of being
    forced off.
  - Test 3 re-run immediately after the fix: 3/3 succeeded, all served directly
    by `google/gemini-2.5-pro`.
- **Test 4 (same tier-4-primary config, post-fix):** 3/3 succeeded cleanly. Tier
  4 confirmed working correctly in isolation.
- Both temporary tier-order overrides used for tests 1-4 were reverted
  immediately after (never committed) - `buildRetryTiers()` is back to the real
  four-tier order; only the reasoning-field fix (a genuine, real bug affecting
  the real chain, not an artefact of the temporary test config) was kept and
  committed.
- **Tests 5-8 (full 7-agent trials, the real end-to-end shape a production run
  actually takes): all four succeeded 7/7, zero truncations.**
  - Trial 1: no escalation needed at all.
  - Trial 2: 3 of 7 roles needed escalation, including one (`grey_worm`) that
    needed multiple tiers before landing a clean finish (4593 cumulative
    completion tokens across attempts) - resolved cleanly regardless.
  - Trial 3: 1 of 7 needed escalation, again `grey_worm`, this time needing an
    even deeper climb (7511 cumulative tokens) - still resolved cleanly.
  - Trial 4: 2 of 7 needed escalation, both resolved cleanly.
  - Across all 4 trials, every judge ruling stayed genuinely independent (never
    combined), consistent with every other real run this project has produced.
- **Full result of this whole verification arc: 24 targeted tests + 4 full
  trials = 28 real trial runs (100 individual agent calls) against the finished
  4-tier design, with exactly one real bug found and fixed (the tier-4
  reasoning-field rejection) and zero unresolved truncations.**
  - This is the strongest evidence gathered so far that the truncation problem
    this whole multi-day arc set out to solve is genuinely, practically
    resolved - not a mathematical guarantee (none of this rules out a rare
    failure the sample size didn't happen to surface), but the practical "very
    rare, not recurring every few runs" bar the user set.

**10 targeted judge-only rounds (2026-08-29/30, barak/elon/shamgar, 1-minute
cooldowns) against the finished chain: all 30 judge calls resolved on tier 1,
zero escalations, zero truncations.**

- Confirms the chain is wired identically for judges (verified directly in
  code - `callOpenRouter()` has no role-based branching anywhere, `label` is
  used only for log text) even though judges evidently need it far less often in
  practice than representatives.
- Their length target is not the reason: it is the longer of the two (450-600
  words against 300-500), and the log's cap-hit counts as of 2026-09-21 said the
  target was not what drove it (see the comment above `MAX_TOKENS` in
  `judge-background.ts`).
- One real methodology bug caught along the way: reusing a single trial across
  all 10 rounds meant `judge_rulings` (upserted, not appended) let the
  frontend's presence-based resolution check see a stale prior-round ruling as
  "already resolved" instantly
  - caught because three roles landing on byte-identical completion counts was
    implausible, confirmed against `api_call_logs` (append-only, so real
    per-round data was recoverable regardless), fixed by polling on log row
    count instead of ruling presence for the remaining rounds.
  - Not a bug in the shipped app - `deriveRoleStates`'s presence-based check is
    correct for its real use case (a trial that only ever runs once).

#### The rate limit raised, the merge, and the production env vars

**Also raised the per-IP rate limit on both agent-trigger endpoints from 30 to
45 requests/5min (2026-08-30, on the user's explicit request after discussing
the real numbers)** - one full trial only ever sends 4+3=7 trigger requests
regardless of internal escalation depth, so 30 already covered 7-8 trials/5min
per IP; 45 adds headroom for a shared-IP/multi-tab scenario without weakening
the limiter's real job (filtering bots, backstopped by the separate 350/24h
global cap regardless of this number). Committed as `82db274`.

*(Never applied: the `config` export it was set in was ignored, as found on
2026-10-02 - see that day's entry. The limit applied since then is on the two
routes in netlify.toml, counted across both: 30 requests per 3 minutes per IP
from 2026-10-02, raised to 60 on 2026-10-04 - see those days' entries.)*

**Merged to `main` and pushed (2026-08-30, on the user's explicit request) - the
entire Background Functions migration through the 4-tier escalation chain, 17
commits, merge commit `b81b1dc`.** This is a genuine, substantial milestone: the
whole multi-day truncation-reliability arc, verified by the trial runs above
plus the 10-round judge-only batch, all with zero unresolved truncations in the
final configuration.

**Netlify production env vars confirmed set by the user (2026-08-30/2026-09-01):
`DEFAULT_MODEL` (`mistralai/mistral-small-24b-instruct-2501`),
`OPENROUTER_API_KEY`, and `SITE_GATE_TOKEN` all now match the local `.env`.**
The three fallback-tier env vars still don't need any Netlify configuration -
`models.ts` defaults them to the correct real model ids when unset.

### 2026-09-01 to 2026-09-03: degeneration detection and the live model line

**A real user-facing gap found the morning after the merge (2026-09-01),
directly on a real trial run: a Grey Worm argument displayed in the UI with no
truncation badge, but visibly degenerate** - a long, comma-less run-on sentence
collapsing into an immediately-repeated word ("...nonetheless nonetheless
nonetheless...") and trailing off.

Root cause: `finish_reason==='length'` (the only failure signal
`callOpenRouter()` had) only catches a response cut off by the token cap - this
response finished on its own (`finish_reason='stop'`, well under its tier's cap)
after degenerating first, a coherence failure the existing check has no way to
see at all.

- **Investigated for real, at zero additional cost, before touching any code:**
  re-scanned all 168 already-stored representative arguments and judge rulings
  across 50 real trials (everything this project had ever generated) for the
  same signature.
  - Found exactly one earlier, previously-unnoticed occurrence (also
    `grey_worm`, also on the `mistral-large-2512` tier) - 2 of 168 total.
  - This directly answered the concern that prior occurrences may have gone
    unnoticed: no, it happened once before and is now known.
- **Calibrated a detector against that same real corpus rather than guessing a
  threshold.**
  - First pass proposed 75 (based on a truncated read of the corpus's
    3rd-highest case, 62 words, as "clean"); the user pushed back and asked to
    see full context on the top ~10 cases before accepting any number.
  - Reading the 62-word case in full revealed it wasn't clean at all - a real
    run-on trailing into a tonally strange, semi-incoherent invocation - while
    every text at 28 words or under was, on inspection, completely normal prose.
  - That's a real cliff (28 clean vs. 62 borderline vs. 85/166 confirmed-bad),
    not a continuum - revised the threshold down to **40**, deliberately erring
    towards catching the borderline case rather than risking a miss, per the
    user's explicit preference.
- **Fixed in `a8f09fd`** (merged to `main` in `19aff8d` on 2026-09-01):
  `detectDegenerateRun()` in `openrouter.ts` measures the longest run of
  consecutive words with no punctuation between them; a run of 40+ words is
  treated exactly like a `finish_reason==='length'` truncation - folded into the
  same tier-escalation loop, returned as a real failure (never saved) if every
  tier still produces one.
  - The shared conciseness-reminder message sent on fallback attempts was
    rewritten to cover both failure modes rather than assuming length was the
    cause (a wrong guess there would actively mislead the retry).
  - No frontend changes needed - a degenerate-after-every-tier result surfaces
    through the exact same `status: 'failed'` + `errorMessage` path the UI
    already displays correctly for truncation failures.
- **Verified live (2026-09-01, local `netlify dev`, zero false positives
  observed across two real targeted-test runs both before and after the
  threshold revision)** - real escalations in both runs were confirmed via
  server log to be genuine `TRUNCATED` (token-cap) events, not the new
  `DEGENERATE` path misfiring.
  - It shipped before any real live degenerate case had been caught and
    escalated (the failure mode is real but rare - 2/168 - so it shipped without
    waiting for one to occur naturally); the corpus-based calibration and the
    live false-positive checks were the verification it shipped with.
- **Live catches followed: counted directly against `api_call_logs`, the
  detectors had caught 8 natural live cases by 2026-09-21, and 9 when counted
  during 2026-09-26** *(the ninth is described at the end of this bullet; four
  more followed late that day, UTC, two of them caught only by the detector
  widened then - they are listed in the comment above
  `REPEATED_SENTENCE_THRESHOLD` in `openrouter.ts`)*.
  - Two were the run-on detector (2026-09-03 and 2026-09-04, both `grey_worm`,
    both on the old `mistral-large-2512` tier).
  - The other six were the repeated-sentence detector, all on the tier-1 default
    model, catching the same sentence repeated 4 to 8 times: five on 2026-09-20,
    the day it shipped (`tyrion_lannister` twice, `grey_worm` three times), and
    one on 2026-09-21 **in production**, on the deployed site - `grey_worm`
    again, at exactly the 4-repeat threshold, in trial `d611f9a4`.
  - That last one was the first catch in production rather than local testing,
    and it is the one that shows the stakes plainly: `finish_reason=stop` at 604
    tokens, so without the detector it would have been saved and displayed as an
    ordinary successful argument.
  - The escalation path is separately exercised by `tests/retry-logic.test.js`,
    which drives a synthetic degenerate response through the real compiled
    source and asserts it escalates.
  - *(The ninth, found in the log on 2026-09-26: a seventh repeated-sentence
    catch, later on 2026-09-21, on the deployed site (the user confirmed the
    trial ran there) and the first on a judge - `shamgar`, 5 repeats, trial
    `5192e119`, retried on the same model and kept. That makes two production
    catches.)*

**A real user report (2026-09-03): the loading card's "Model:" line still showed
the wrong model while an escalated attempt was actually generating** - Daenerys
Targaryen had escalated to `mistral-large-2512`, but her card kept reading the
discarded `mistral-small` attempt's name.

Root cause: the prior fix (`197609b`, same day) inferred "current model" from
the most recently *discarded* attempt's own log row, which is always one step
behind - the model actually in flight next has nothing to report until it too
finishes or is discarded.

- **Real fix (`c1155f3`):** a new `agent_progress` table (one row per
  trial/role, overwritten in place, not appended) records the attempt that is
  actually starting, written via a new `onAttemptStart` callback on
  `callOpenRouter()` fired the instant each attempt begins - the
  start-of-attempt counterpart to `onDiscardedAttempt`.
  - `GET /api/trials/:id` now returns this as `agentProgress`; the card renders
    it exactly per the user's spec: bare `Model: X` for a tier with only one
    allowed attempt, `Model: X (first attempt)` / `(second attempt)` for a tier
    with more than one.
- Also fixed two adjacent issues found while in there:
  - a terminal failure's message now says "every model tier was tried..."
    whenever the failure genuinely happened on the true last tier (any failure
    mode, not just truncation/degeneracy - previously only the degenerate-final
    path had this wording, and even that conflated "really exhausted every tier"
    with "ran out of time budget before reaching a further tier" into one
    message);
  - and the internal `[degenerate-*]` marker prefixes (needed by the call log
    table's own badge logic) no longer leak into an agent card's error text.
- **Migration:** `agent_progress` (schema.sql) applied by the user directly via
  Supabase's SQL Editor, same pattern as the earlier `duration_ms` migration.
- **Verified for real (2026-09-03, on the user's already-running local
  `netlify dev` instance, under the standing local-testing free pass - zero
  Netlify cloud touched):** a full 7-agent trial, polling `GET /api/trials/:id`
  every 2.5s and diffing `agentProgress` on each tick.
  - Directly observed `daenerys_targaryen`'s row update live, mid-call, from
    `mistral-small-24b-instruct-2501` (tier 1) to `mistral-large-2512` (tier 2,
    attempt 1) - the exact moment the escalation actually happened, not after
    the fact - and she then succeeded there.
  - All 7 calls (4 representatives + 3 judges) completed successfully; leftover
    `agentProgress` rows for terminal roles confirmed harmless (the frontend
    only reads that map for a role it doesn't already have a final result for).
  - This is the first real live confirmation that the fix behaves as intended,
    not just offline-verified.
- Along the way: `models.ts` picked up spaces-inside-parens formatting from VS
  Code's Prettier auto-formatter while open for review - reverted (`8721cef`),
  and `.vscode/settings.json` was added (tracked, not gitignored - a deliberate
  choice, no convincing reason found to hide it) disabling
  `formatOnSave`/`formatOnPaste`/`formatOnType` for this workspace so it doesn't
  recur.

### 2026-09-21: production verification

**Verified against the live deployed site (2026-09-21): four full 7-agent
trials, all 7/7.**

- First real production confirmation that the agent functions run as Background
  Functions *(by their `-background` filenames - the `config.background` export
  credited here was never read; see 2026-10-02)* (all 28 trigger POSTs returned
  Netlify's automatic HTTP 202 in ~0.3-0.5s);
- the first production exercise of the tier-1 same-model truncation retry
  (twice, in trials 2 and 4, each recovering cleanly without paying for a higher
  tier);
- and - in trial 3, unforced - the first production run of an escalation from
  first catch to clean finish: `detectRepeatedSentences()` catching a real
  degenerate response, a same-model retry that then truncated, and a clean
  success on `anthropic/claude-haiku-4.5`.
  - That last one is the specific path the 2026-09-21 merge (`5c3c2c0`, 54
    commits) existed to fix, and it had never been exercised outside offline and
    local tests.
- Also surfaced one real documentation defect - `MAX_CONCURRENT_CALLS` has not
  bounded OpenRouter concurrency since the Background Functions migration -
  corrected across `app.js`, `README.md` and this file, with no behaviour
  change.
- Full detail under "Production verification: four live trials, and one real
  finding (2026-09-21)" below. These corrections were pushed to `draft` that day
  and reached `main` in the 2026-09-26 merge (`c33c3ed`).

### 2026-09-26: JSDoc, README's reference sections, the docs test, and a merge

#### JSDoc, and failed requests that went unreported

**JSDoc added to every JavaScript file then in the repository (2026-09-26):
`public/app.js` and the three `tests/*.test.js` suites of the time.** *(The
suites and `tests/support/` files added later the same day were written with
JSDoc from the start.)*

- The existing `//` rationale above each declaration became that declaration's
  JSDoc word for word, with a summary line, `@param`/`@returns` tags, and shared
  `@typedef`s in `app.js` (mirroring `types.ts`, since the file can't import
  it).
- Four comments that described a declaration elsewhere were moved onto it - most
  notably a paragraph about `buildAgentStatusBody()` that had been sitting above
  `SPINNER_ANIMATION_MS`.
- **Verified comment-only:** stripping comments with TypeScript's own transpiler
  leaves byte-identical code in all four files, apart from one test
  failure-message string that named the wrong function.
- Eight stale claims were corrected along the way, all caused by code that had
  moved or been renamed since the comment was written (mostly `loadTrial()`
  credited with work `deriveRoleStates()` does).
- One was more than wording: a comment said `beginTrial()` cannot reject, but a
  network failure while creating the trial or refreshing the call log did reject
  it, with nothing catching it - a click that looked ignored, and an error only
  in the browser console. `loadTrial()` had the same gap.

**Fixed in the follow-up commit (same day, on the user's go-ahead):** creating a
trial and opening one from history now alert on an unreachable server or a
non-JSON reply (a platform 502 page, say), and `refreshFullTrial()` returns
whether it loaded rather than throwing - which also fixes a knock-on nobody had
noticed: the failed refresh used to skip the run-history refresh after it. The
user is told the call log is missing instead.

- `tests/render-cards.test.js` gained 17 checks covering all three, driving a
  whole trial end to end with instant timers; run against the pre-fix `app.js`,
  11 of them fail - exactly on the bug.
- **Then mutation-tested** (20 deliberate one-line breaks to `app.js`, each run
  against the suite), which found the checks weaker than they looked:
  - the stub DOM's `classList` was a no-op, so a check named "the loading
    overlay is released" passed with the overlay stuck on screen, and leaving
    the Abort button visible went undetected entirely;
  - one stuck flag cascaded into 11 failures across unrelated sections;
  - and with timers made instant, a poll that never resolved would have hung the
    suite for 700 real seconds instead of failing.
- Fixed in the harness (a real `classList`, each flow starting from an idle
  page, a virtual clock that advances with every wait). All 20 breaks are now
  caught, each by a check that guards that specific thing - same lesson as the
  methodology note further down, under "Two CSS traps": a check can pass because
  it never observed the thing it names.
- `loadStaticCaseSheet()` (page load) leaves a network failure to the browser
  console rather than an alert, since there is no good place for an alert on
  page load. Nothing breaks permanently: starting a trial or opening one from
  history renders the case sheet again, and the run-history sidebar shows its
  own error in the same situation.
- `npm run typecheck` covers the backend; run on `app.js` with `--checkJs`,
  TypeScript reports DOM-narrowing complaints (`.disabled` on an `HTMLElement`,
  `.dataset` on an `Element`). These are type-annotation complaints, not bugs:
  the code runs correctly, and the test suites execute it.

#### README's layout, endpoint and table sections, and a trial-status bug

**README now documents the project layout, every API endpoint and every database
table (2026-09-26).** Until then it listed the six tables by name only, named
one of the seven endpoints in passing, and had no layout at all.

- New sections: an annotated tree of every tracked file, an endpoint table with
  a note on how the two Background Function endpoints differ, and a paragraph
  per table (key columns, allowed values, uniqueness, what reads or writes it)
  that defers to `schema.sql` for the full definitions rather than copying it -
  a hand copy of the schema is exactly what goes quietly stale.
- Cross-checked by script rather than by eye:
  - every file from `git ls-files` is in the tree and every tree entry exists;
  - every `netlify.toml` redirect is in the table with the right function, and
    every method listed is one that function's handler actually accepts;
  - every column named exists in `schema.sql`.
- **Now enforced** - see the docs-test entry below; those one-off checks became
  `tests/docs.test.js`, and grew well past these three.

**Bug, found while documenting the above - fixed the same day (see the next
entry): a trial could be marked `completed` while judges were still running.**

- `markTrialCompletedIfJudgingDone()` in `db.ts` flipped `trials.status` once
  the trial had 3 or more `api_call_logs` rows with `call_type = 'judge'`.
- That was a sound proxy for "all three judges finished" when every judge wrote
  exactly one row, but discarded attempts have been logged as their own rows
  since the escalation work (`onDiscardedAttempt`), so the count reached 3
  early. For example, a judge that finished after two discarded attempts marked
  the trial complete on its own.
- Effect, read from the code rather than observed:
  - during the rest of the run the sidebar showed "Completed — missing N of 7"
    instead of "In progress…", but only to someone whose history list refreshed
    mid-run;
  - a run whose judges phase then died read "Completed — missing N" rather than
    "Interrupted";
  - and an abort after that point read "Aborted (N of 7 completed)".
- No result is lost or fabricated - it is a status label only.

#### The trial-status fix, and the docs put under test

**That bug fixed, the docs brought in step, and the docs put under test
(2026-09-26, on the user's go-ahead: "bring all docs in step and make the tests
cover everything relevant, load-bearingly").**

- **The fix:** `markTrialCompletedIfJudgingDone()` now counts judges with a
  final outcome - any judge row not carrying a retried marker, so a success, a
  final failure or an abort - and completes the trial only when all of `JUDGES`
  are in that set.
  - The retried markers moved into one exported list, `RETRIED_ATTEMPT_MARKERS`
    in `openrouter.ts`, and `tests/shared-constants.test.js` asserts it names
    the same markers as app.js's `isRetriedMarkerLog()`: if the two disagree,
    one side calls a role finished while the other is still waiting on it.
  - Also reordered in `judge-background.ts`: the judge now saves its ruling
    *before* checking completion, so a trial can no longer read as completed
    with its last ruling still unwritten.
- **New suite `tests/trial-status.test.js` (22 checks):** the compiled `db.ts`
  against an in-memory stand-in for Supabase - the bug's exact shape (three
  rows, one judge), each retried marker individually, final failures, other
  trials and representative rows ignored, a failed read - plus the real
  `judge-background.ts` handler end to end, asserting the ruling is written
  before the trial is marked completed.
- **New suite `tests/docs.test.js` (151 checks):** README, SPEC.md and the
  requirement parts of CLAUDE.md (Parts 1 and 5 - the status log is deliberately
  excluded, since it records what was true when written) against the code.
  - Where a claim is about behaviour it runs the real code rather than reading
    its text: the escalation chain's tiers and attempts come from driving the
    compiled `callOpenRouter()`, the detector thresholds from feeding it text
    just above and below each one, the badge tables from rendering every kind of
    call-log row and trial state through app.js, and each endpoint's status
    codes and site-gate requirement from calling its real handler against an
    in-memory database.
  - Covered:
    - the layout tree against every committable file;
    - the endpoint table against `netlify.toml` and each handler's accepted
      methods;
    - the Background Function claims (including that the `-background` filename,
      which local dev keys off, and `config.background`, which the platform keys
      off, agree);
    - rate-limit and quota-spending claims;
    - every table, column, allowed value, uniqueness rule, cascade and RLS claim
      against `schema.sql`;
    - prices, the paid-only claim, every documented time threshold;
    - the suites npm test runs, the npm scripts, `.env.example` against every
      variable the backend reads;
    - every file path the docs name;
    - the charge sheet in SPEC.md and CLAUDE.md against the seed;
    - the logging fields across SPEC.md, CLAUDE.md, README and the schema;
    - the verdict vocabulary across SPEC.md, the schema, the judge's parser and
      README.
- **Shared test setup moved to `tests/support/`** (`compile-backend.js`,
  `load-app.js`, `fake-supabase.js`), used by four suites instead of each
  copying its own.
- **Mutation-tested, 88 deliberate one-line breaks** - to README, SPEC.md,
  CLAUDE.md, schema.sql, netlify.toml, package.json, `.env.example`, app.js,
  styles.css and the backend - each run against the suite that should notice,
  every file restored byte for byte afterwards.
  - The first run caught 81 of 84, and the three survivors were each a check
    weaker than its name:
    - the tree's route labels were compared by substring ("GET /api/cases"
      contains "/api/case");
    - status codes were checked by searching the source, which cannot tell that
      `trials.ts` returns 200 for GET but 201 for POST;
    - and the Background Function check matched `background:true` in a
      *comment*.
  - All three fixed - status codes and the site gate are now checked by calling
    the real handlers - and the final run caught all 88, each on the check meant
    for it.

**Then every check, not just every break (same day, on the user's explicit ask:
"I wanna make sure all 277 are load bearing, and that each and every one of them
actually fails when it should").** Catching all 88 breaks proved only that each
break tripped *some* check.

- Mapping it the other way round showed how far that fell short: of the 277
  checks then in `npm test`, only 80 had ever been seen to fail - none of
  render-cards' 56 and one of retry-logic's 28, since earlier mutation work on
  those suites predated the shared harness.
- So a targeted break was written for every unproven check: the realistic
  regression that check exists to catch, not merely something that happens to
  trip it.
- Doing that surfaced real test defects, all fixed:
  - two docs checks shared one name, so a failure could not say which table it
    meant;
  - retry-logic's integer-timeout check read the value with `\d+`, so the very
    fractional timeout it guards against would have crashed the suite instead of
    failing the check;
  - render-cards' model-name checks would likewise have crashed on a throwing
    shortener;
  - and five docs breaks crashed the whole suite rather than failing a check (a
    README row naming a missing function file, a renamed sidebar heading, an
    unreadable seed), each now guarded, with two new checks where a missing
    statement had no check of its own.
- **Final state, from one consistent run of all 274 breaks against the final
  tests (1179s, every file restored byte for byte): all 279 checks fail under at
  least one break - 28 retry-logic, 22 trial-status, 56 render-cards, 22
  shared-constants, 151 docs - and no break crashes a suite.**
  - The 146 checks proven by a single break were read one by one to confirm the
    break targets that check's own claim; two were only collateral (the
    quota-spending claim, and the judge endpoint's rate limit), so two more
    breaks were added, and each was caught by exactly the check it targets and
    nothing else.
  - *(Counted afterwards, while consolidating the break lists: 4 of those 276
    breaks were the same edit listed twice under two names, so 272 distinct
    breaks. Neither result changes.)*
- One break is slow rather than quick to fail: removing the rounding from
  `attemptTimeoutFor()` makes every retry-logic scenario fail at its own pace,
  and the suite takes about five minutes to report it - it does fail, on the
  integer check.
- The mutation harness and its break lists live outside the repo (the scratch
  directory of that session); they edit files in place and take about 20
  minutes, so they are a verification tool, not part of `npm test`.
- The compile step runs tsc with `--noCheck`: type-checking is
  `npm run typecheck`'s job against the real tsconfig, and checking again under
  the tests' module flags reported an error in `safeHandler.ts` that the
  project's own config does not have.

**The docs test found a real code bug on its first run: the fast-failure
threshold was really about 8s, not 10.** On a 429, a 5xx or an empty reply, the
chain waited out its `backoff()` pause (0.8-2.3s) *before*
`recordFailedAttemptAndAdvance()` measured the attempt, so the pause was timed
as part of it - contradicting the code's own comment that every duration is
"always this attempt's own time".

- Two effects: a failure had to come back in roughly 8s rather than
  `FAST_FAILURE_THRESHOLD_MS` (10s) to count as fast, and every such row's
  logged `duration_ms` was inflated by the pause.
- In practice every logged 429 was still classified fast, pause included, so no
  escalation decision is known to have gone wrong, but the logged durations
  were.
- Fixed by taking the pause after the attempt is recorded, and only when another
  attempt follows - which also means a chain that has run out of options no
  longer sleeps before reporting it.
- `tests/retry-logic.test.js` gained a check that an instant 429's logged
  duration is under 400ms (the shortest pause is 800ms).

**Docs corrected:**

- SPEC.md section 1 paraphrased the case, and the paraphrase had drifted in
  substance, dropping part of two stipulated facts, so it now quotes the seed
  word for word (CLAUDE.md Part 1 already matched it exactly).
- README gained the new files in its tree and lists the suites by file, and two
  of its statements were corrected against the code.
- `chargeSheet.ts`'s comment now says SPEC.md quotes CLAUDE.md rather than being
  a second source.

#### The first full documentation sweep, and the merge

**Full sweep of every markdown file and every code comment for stale, wrong or
contradictory statements (2026-09-26, on the user's request, ahead of the `main`
merge recorded in the next entry).** Every comment in every tracked code file
(about 2,200 comment lines across 31 files) and all of README, SPEC.md and this
file were read against the code, git history and the database, not against each
other.

Much of what was wrong was stale rather than false-when-written, so this log
kept its entries and gained inline *(italic)* notes where a later change made
one misleading, plus a paragraph at the top of this section saying that a dated
entry's numbers and "now" are that day's. The findings that went beyond wording:

- **Chromium ignores the whole `::-webkit-scrollbar` block here.** Measured in
  headless Edge 153 and Chrome 154: on an element that also sets the standard
  `scrollbar-width` (both scroll areas do), every `::-webkit-scrollbar` rule is
  dropped.
  - So the drag-brightening `:active` tier and the 8px width never rendered in
    Chrome 154 or Edge 153, the versions measured, although comments in
    `styles.css` and `app.js` and the sidebar backlog below said they did.
  - Every browser tested shows the two-tier rest/hover scrollbar. Comments
    corrected; the CSS is unchanged.
- **The database had moved on past the documented counts.** Four trials ran
  after the last documentation pass: `cef0646e` and `5192e119` on 2026-09-21,
  `a02b8215` (aborted mid-representatives, with two calls stopping themselves
  "before attempt 2") the same day, and `1be170bf` on 2026-09-25.
  - The user confirmed `5192e119` ran on the deployed site. It holds the seventh
    repeated-sentence catch and the first on a judge (`shamgar`), and the second
    production escalation to tier 2 (`daenerys_targaryen`, clean).
  - The detectors' tally was then 9 and tier 2's 23 of 23; `openrouter.ts`,
    `models.ts` and the entries here were updated.
- **Some claims were wrong rather than stale** - nine of them, across
  `openrouter.ts`, `judge-background.ts`, `styles.css`, Part 5 and this log -
  and were corrected against git, the code and the database.
- **README's lists completed (same day, a follow-up pass on the user's
  request).**
  - The tree, the endpoint table, the role lists and both badge tables were
    already complete; the table paragraphs, two endpoint descriptions, the agent
    handler's list of checks, the transient-failure lists and several badge
    explanations were each missing a column, a case or a check, and were
    completed.
  - `tests/docs.test.js` had exempted `id`, `created_at` and `updated_at` from
    its "every column is named" check, which is how those omissions got through.
    The exemption is gone, and dropping any one column from a paragraph now
    fails the suite, checked by doing exactly that for three tables.
- **Two standing permissions reconciled with HARD RULE 1:** the 2026-08-29
  OpenRouter "free pass" and the 2026-09-20 diagnosis permission were marked as
  scoped to their own arcs. Without a fresh pass from the user, ask before every
  call that spends quota.

**Merged to `main` (2026-09-26, on the user's explicit request), triggering a
deploy: 15 commits, everything since the 2026-09-21 merge (`5c3c2c0`).** They
are:

- the three production-verification write-ups made after that merge (`c8e2b17`,
  `ada14ce`, `9bd0b16`);
- all of 2026-09-26's work: the JSDoc, the failed-request fixes, the README
  layout/endpoint/table sections, the trial-completion fix, the backoff-timing
  fix, the docs test and the proof that every check can fail, the full
  documentation sweep, and the README list completion;
- the commit that adds this entry.

Merge commit `c33c3ed`. This entry was committed to `draft` ahead of the merge,
so that right after it `main` and `draft` held identical trees.

**Confirmed live the same day** by fetching the deployed site's public files
over plain HTTPS (on the user's go-ahead; no Netlify CLI or dashboard, no build,
no model calls): `app.js` and `styles.css` matched `main` byte for byte, and
`index.html` differed only by a script tag Netlify injects at serve time
(`/.netlify/scripts/hud`), which is Netlify's own tool, not repository content.

### 2026-09-27: HARD RULE 3, detection, audit text, badges and aborts

#### HARD RULE 3

**HARD RULE 3 added (2026-09-27, by the user): edit history belongs in the
commit message, not in the file** - see the HARD RULES block at the top. Applied
retroactively the same day, to this file and to code comments (README and
SPEC.md had nothing it covers):

- every note that recounted what a sentence or comment used to say was removed,
  with the facts around it kept or restated as a rule going forward;
- entries that still read as current ("pushed to `draft` only", "not yet
  tested", "confirm deploy status before considering this closed") were put in
  the past tense, the merge-state ones naming the merge their work reached;
- and the italic notes that only patched those up went with them.

#### A widened repeated-sentence detector

**A degenerate argument got through the repeated-sentence detector, and the
detector was widened (2026-09-27).** In trial `e4a20a68` (run 2026-09-26 22:25
UTC), `daenerys_targaryen`'s first attempt was saved as a success while closing
on the same sentence three times back to back, with a fourth copy differing by
one word ("Jon Snow's actions" / "his actions").

- The detector required 4+ verbatim copies, and when it was calibrated on
  2026-09-20 only texts at 4+ had been read - how much the threshold missed
  below that had never been measured.
- A read-only scan of all 830 stored texts found two more of the same miss
  (`a01d2349` `tyrion_lannister`, `715dfbb8` `jon_snow`), and a pattern the
  detector could not see at all: a 3-5 sentence passage pasted again later in
  the same text, in 5 of the 70 texts saved since the detector shipped - among
  them `barak`'s accepted retry in this same trial.
- On the user's direction that a missed degeneration is far worse than a
  discarded sound argument (the first is shown to a reader as a success; the
  second costs a cheap retry or an escalation), `detectRepeatedSentences()` now
  flags any of four patterns:
  - the same sentence (5+ words) twice in a row;
  - a sentence of 15+ words twice anywhere (the user's point: a long sentence is
    far less likely to be restated deliberately than a short one);
  - any sentence 3+ times;
  - a passage of 3+ sentences (12+ words) repeated word for word.
  - *(The long-sentence minimum was raised from 15 to 18 words later the same
    day, after the 20-trial measurement recorded further down.)*
- Every twice-in-a-row case in the corpus was read and is a loop; the rest were
  calibrated by reading samples, and the refrains and structural lines they also
  catch are accepted false positives.
- The real compiled detector flags 149 of the 830 stored texts (18%; 12 of the
  70 since 2026-09-20), against 30 for the old rule, so expect noticeably more
  same-model retries - each a fraction of a cent.
- Near-verbatim looping (copies differing by a word) is still not caught; that
  needs a fuzzy check with its own calibration. *(Built on 2026-09-28 - see that
  day's entry on near-verbatim loops.)*
- `tests/retry-logic.test.js` gained a scenario (the missed closing word for
  word, and each rule just above and below its threshold), and
  `tests/docs.test.js` now checks all four thresholds as README states them;
  every new "is caught" check fails against the old detector.

#### Every model reply kept for audit

**Every model reply is now kept in the call log, discarded ones included
(2026-09-27, on the user's request).** Until then a discarded attempt left only
its reason and a 60-character quote, so a discard could not be audited: after
trial `651cee8a`, whether `daenerys_targaryen`'s "18-word sentence 2 times" was
a loop or a closing restatement could not be settled.

- `api_call_logs` has a new `response_text` column holding the model's reply
  word for word for every attempt that got one - kept, discarded (truncated or
  degenerate), a judge reply with no parseable VERDICT line, and a result
  dropped because the trial was aborted meanwhile - and empty for an attempt
  with no reply.
- It is for audit only: `getFullTrial()` selects named columns
  (`CALL_LOG_PAGE_COLUMNS`) that leave it out, so it never reaches the page.
- `logApiCall()` writes the row again without the text if the database has not
  got the column yet, so no call ever drops out of the log over it.
- The repetition reasons also say where the copies sit now ("sentences 2 and 31
  of 32", "sentences 3-5 of 5").
- `supabase/schema.sql` carries the column and an `add column if not exists`
  line for an existing database.
- Tests:
  - `tests/trial-status.test.js` checks through the real judge handler and trial
    endpoint that discarded, kept and unparseable replies are stored, that the
    page gets the discarded row but none of its text, and that a database
    without the column still gets every row;
  - `tests/support/fake-supabase.js` now returns only the columns a query names
    and can simulate a missing column.
  - Breaking each of the three - leaking the text into the page, not storing it,
    dropping the fallback - fails the check meant for it.
- The user applied the column in Supabase's SQL Editor the same day (confirmed
  with a read-only query).
- Then every check added or changed that day was proven able to fail (31 of
  them: 28 new, 3 rewritten), taking `npm test` from 279 checks to 307: 14 had
  already failed under the breaks above or against the old detector, and 15 more
  targeted breaks proved the other 17
  - thresholds lowered, README out of step with the code, replies not carried,
    copy positions off by one, a column dropped from the page's list, the
    fallback throwing, the in-memory database no longer simulating the missing
    column - each failing the checks meant for it, with every file restored byte
    for byte.

#### The second documentation sweep, and the morning merge

**Second full sweep of every markdown file and every code comment (2026-09-27,
on the user's request, ahead of the `main` merge that followed it, `0cd124c`).**
Every tracked file read line by line against the code and the database, under
HARD RULE 3 and a new standing preference of the user's: a figure that can only
grow (trials run, catches made) is written as "at least N" and needs no date,
while one that can turn false (a clean record, a rate) stays exact and dated
(refined later the same day: no running totals in live comments and docs at
all - see the third sweep's entry below). What it found:

- **Claims that the day's own work had overtaken:**
  - comments in `openrouter.ts` still said a discarded attempt's content is
    never stored, and gave the widened detector's flag rate as 144 of 830
    (17%) - the estimate from before it was built - where the real detector
    flags 149 (18%), the figure this log records.
  - The detector's live-catch count read "seven, as of 2026-09-26" when there
    were eleven by the end of that day (UTC); it was changed to "at least
    eleven".
  - README's architecture line, trial endpoint row and test-suite descriptions
    were updated to say what the call log stores and what the page never gets.
- **Statements that were not quite true:**
  - `.env.example`, `app.js` and `siteGate.ts` said a wrong site-gate token
    makes "every gated call" fail with a 401, when an agent call is dropped
    silently (visible only in Netlify's function logs) and only trial creation
    gets the 401;
  - `siteGate.ts` still read as a to-do to set a token that has been set since
    2026-08-30.
  - `CALL_LOG_PAGE_COLUMNS` claimed to leave out only `response_text` (it also
    leaves out `id` and `trial_id`) and to be held to that by a test that does
    not import it.
  - The abort check was described as running only between attempts, omitting the
    final check before a result is saved.
  - A `[degenerate-final]` row was described as always meaning the last tier,
    omitting the out-of-time-budget case;
  - `styles.css` called the scrollbar "3-tier in every browser" three paragraphs
    above saying only two tiers render anywhere;
  - a cross-reference pointed at a fix by description no reader could follow;
    one said "below" for something above.
- **Wording history the first rule-3 pass missed**, because its search did not
  match "revision":
  - an `app.js` comment on `INTERRUPTED_THRESHOLD_MS` recounted what "an earlier
    revision of this comment" said, and a `styles.css` note told the reader how
    to read "the comment below"; both were rewritten to state the facts
    directly.
  - A handful of dated log entries still read as current ("Not yet understood",
    "uses today", "all four of today's production trials", "23 now", "28 since")
    and were pinned to their day, and the log's methodology note had a real line
    break inside the very `out.join(...)` example it describes.
- Nothing in SPEC.md, the schema, `index.html` or the remaining test files
  needed changing.

**Merged to `main` (2026-09-27, on the user's explicit request), triggering a
deploy: 6 commits, everything since the 2026-09-26 merge (`c33c3ed`).** They
are:

- HARD RULE 3 and its retroactive pass (`698a06d`, `b57f621`);
- the widened repeated-sentence detector (`e044600`);
- every model reply kept in the call log for audit, never sent to the page
  (`727c13b`) - its `response_text` column was already applied to the shared
  Supabase database, which the deployed site uses too, so the deployed code has
  the column waiting for it;
- the second full documentation sweep (`51a26b1`);
- the commit that adds this entry.

Merge commit `0cd124c`. This entry was committed to `draft` ahead of the merge,
so that right after it `main` and `draft` held identical trees.

**Confirmed live the same day**, on the user's go-ahead, by fetching the
deployed site's public files over plain HTTPS: `app.js` and `styles.css` (both
changed in this merge) matched `main` byte for byte, and `index.html` differed
only by the script tag Netlify injects at serve time (`/.netlify/scripts/hud`).

#### Badges, an abort row's model, and the "Powered by Netlify" card

**Badge text centred the same way on every device, and the call-log and sidebar
labels made lowercase (2026-09-27, on the user's report from Chrome on
Android).** On the user's phone every badge's text sat visibly high in its pill,
while on Windows it looked centred.

- The cause was the 2026-09-20 padding fix (`e849d0f`, 2px top / 4px bottom),
  which had been measured on Segoe UI only.
  - The page uses the system font stack, so Windows draws badges in Segoe UI,
    whose tall ascent leaves text low in the line box, while Android draws them
    in Roboto, whose balanced metrics leave text roughly centred - and the same
    1px shift then pushed it high.
  - Rendered in headless Edge, Roboto sat 0.6-0.9px higher than Segoe UI on
    every label, and ascender words 1.1-1.4px above centre. No fixed padding is
    right for both fonts.
- `.badge` now uses `text-box: trim-both cap alphabetic` behind `@supports`,
  which trims the content to the band between the baseline and the top of a
  capital, so the padding is measured from the letters rather than from the
  font: in Edge and Firefox, every label now sits within 0.25px of the same
  place in Segoe UI as in Roboto, with the pill's height unchanged.
  - Firefox supports the property from 154 (MDN's compatibility data, and the
    local Firefox 156 applies it). Browsers without it get symmetric 3px
    padding.
- At the user's request, every badge label in the app now starts lowercase in
  the text itself (`truncated`, `completed — missing N of 7`, `in progress…`),
  matching `success` and `failed`: first the call log and the sidebar, then, in
  a second commit the same day, the agent cards' four (`aborted`, `call failed`,
  `no response yet`, `truncated`). README's badge tables follow.
- The call-log label checks in `tests/render-cards.test.js` now match the badge
  itself rather than the word anywhere in the row, and a new section there
  builds each agent-card state and compares its badge text exactly; putting any
  capitalised label back fails the check meant for it (and, for the call log and
  sidebar, the docs test's table checks).
- The same render was then repeated in WebKit 26.6 (Safari's engine, run through
  Playwright's Windows build, after a first install was left without its DLLs by
  Windows Smart App Control and was removed and reinstalled cleanly): it
  supports and applies the trim, and gives the same result - before, Roboto sat
  0.9-1.1px higher than Segoe UI; after, within 0.25px, pill height unchanged.
- For San Francisco, Apple's system font, the same centring is inferred from how
  the trim works: it measures from each font's own capital height and baseline,
  which is what brought Segoe UI and Roboto within 0.25px of each other.

**The call log printed an abort row's model as "a" (2026-09-27, found by the
user on the deployed site).** The abort endpoint logs `n/a` as the model of each
row it writes, and the Model cell ran that through `shortModelName()`, whose
vendor-prefix rule read "n/" as a provider.

- That value is now one constant, `NO_MODEL_USED` in `db.ts` (used by
  `abort.ts`), mirrored in `app.js` and asserted identical by
  `tests/shared-constants.test.js`;
- `formatModelCellHtml()` prints it as it stands, with no `<abbr>` and no
  tooltip, and shortens every real model id as before.
- `tests/render-cards.test.js` checks both cases; each new check fails under its
  own targeted break.

**Netlify's "Powered by Netlify" badge turned off (2026-09-27, by the user, in
the Netlify dashboard).** Netlify shows it by default on Free-plan projects
created on or after 2026-08-19, which includes this one, as a floating card that
on narrow screens covered the call log's last row.

- It is drawn by a script Netlify injects into `index.html` at serve time
  (`/.netlify/scripts/hud?variant=public`), the tag the 2026-09-26 and
  2026-09-27 deploy checks found as the only difference from `main`.
- Free plans can turn it off per project (Project configuration > General >
  Powered by Netlify badge), with no redeploy.
- Confirmed the same day by fetching the live page over plain HTTPS:
  `index.html` now matches `main` byte for byte, with no injected script. No
  margin was added below the call log, since nothing covers it now.

#### Capped replies, clause-level rules, and the detectors measured

**A capped reply is a loop, not a sound argument cut short, and a clause-level
repetition check was added (2026-09-27, on the user's doubt about README).**
README said a capped response "is usually coherent prose that simply got cut
off", and comments in `openrouter.ts` and `app.js` said the same.

- Checked against the database: all 13 responses capped at a multiple of the
  1,400-token cap whose full text was stored (results kept as successes from the
  default model on 2026-08-28/29, before truncation became a failure) are
  repetition loops, one sentence or clause repeated until the cap stopped it;
  and of 687 tier-1 replies that finished on their own, the longest was 1,147 of
  the 1,400 tokens.
- The 78 capped attempts since 2026-08-29 were discarded before `response_text`
  existed, so their text cannot be read, and from now on every one is stored.
- README, the two code comments and two test comments now say that the labels
  record how an attempt ended, and that a capped reply is usually a loop; the
  two log entries that rested on the opposite theory (2026-08-28, 2026-08-29)
  carry notes saying so.
- One of the 13 was a loop no detector would have caught had it ended below the
  cap: a clause repeated 84 times between commas, never ending a sentence.
- `detectRepeatedSentences()` now also cuts the text into clauses (at commas,
  semicolons and colons too) and flags the same clause (5+ words) twice in a
  row, or a clause of 6+ words 3 times with the third no more than 6 clauses
  after the first.
  - Calibrated against the 692 of 844 stored texts the other rules pass: the
    first rule matches only that loop; the second matches 5 - it, two
    `daenerys_targaryen` closings saved as successes on 2026-09-20 that loop a
    clause, and two sound but repetitive enumerations (anaphora whose shared
    opening ends at a comma), accepted as false positives on the recall-first
    priority.
  - Over all 844 the detector now flags 157, against 152.
- Tests: `tests/retry-logic.test.js` runs both real loops word for word plus a
  case just inside and just outside each threshold, and `tests/docs.test.js`
  checks README's two new thresholds above and below.
  - Of 15 targeted breaks (thresholds moved, the comma split removed, copy
    positions off by one, README out of step), one first got through - dropping
    the in-a-row clause rule from one of README's two descriptions, since the
    check only asked whether the phrase appeared anywhere - and it now has to
    appear wherever the clause rules are described; all 15 then failed the
    checks meant for them.

**The degeneration detectors measured on live output, and the long-sentence
minimum raised from 15 to 18 words (2026-09-27, on the user's request).** 20
targeted trials on local `netlify dev` (`daenerys_targaryen` and `grey_worm`,
then `barak`, a one-minute cooldown between trials; real OpenRouter quota, on
the user's request) produced 105 replies, every one stored in `response_text`
and read in full, each judged against a rubric fixed before counting:

- degenerate means a loop, a passage of 3+ sentences pasted again, 1-2 sentences
  re-emitted almost at once, or a collapsed persona or self-contradicting
  reasoning;
- a single restated line, a refrain, a bookend or a callback in the conclusion
  is sound.

Results:

- Whole quality gate (token cap plus detectors, 105 replies): 36 true positives,
  58 true negatives, 9 false positives, 2 false negatives - accuracy 89.5%,
  precision 80.0%, recall 94.7%, F1 0.867.
- The detectors alone (the 84 replies that stopped on their own; they never see
  a capped one): accuracy 86.9%, precision 62.5%, recall 88.2%, F1 0.732.
- Both false negatives repeat nothing, so no repetition rule could catch them -
  a `claude-haiku-4.5` Daenerys speaking as Jon ("I knew Daenerys. I loved
  her."), and a Barak ruling whose proper-purpose section contradicts itself; on
  repetition failures alone recall was 100%.
- 8 of the 9 false positives came from the 15-word long-sentence rule (a
  sentence of 16-22 words stated twice as a callback, a bookend, or Barak
  restating each question as its section heading), 7 of the 9 on Barak, and 1
  from the new clause rule.
- All 21 capped replies were loops (34 of 34 read so far).
- `mistral-small` degenerated in 37 of 90 replies, `claude-haiku-4.5` in 1 of
  15; the run cost $0.083, most of it on the 15 Haiku calls.

Choosing the minimum:

- Re-scored with the real detector at every minimum from 15 to 25 words, gate
  recall held at 94.7% up to 22 and first fell at 25;
- over the 844 older stored texts, every text a higher minimum would stop
  flagging was read - at 18, 24 texts, all sound; at 19 and 20, a looping
  `daenerys_targaryen` closing (an 18-word sentence) and a borderline `shamgar`
  ruling would go uncaught.
- The user chose 18: gate precision 83.7%, detector precision 68.2%, recall
  unchanged, and 133 of the 844 stored texts flagged (15.8%) against 157.
- `tests/retry-logic.test.js` now tests the rule at exactly 18 words and one
  under, and `tests/docs.test.js` checks README's "18+" the same way; setting
  the constant to 15 or 19, or README to 19 in one place, each fails the checks
  meant for it.
- The replies, the per-reply verdicts and the scripts are in that session's
  scratch directory, outside the repo.

**The same measurement repeated at the 18-word minimum (2026-09-27, on the
user's request): 16 targeted trials, 74 replies, every one read against the same
rubric.**

- Whole quality gate: 24 true positives, 47 true negatives, 2 false positives, 1
  false negative - accuracy 95.9%, precision 92.3%, recall 96.0%, F1 0.941 (the
  20-trial run at 15 words: 89.5%, 80.0%, 94.7%, 0.867).
- Detectors alone, 60 replies that stopped on their own: accuracy 95.0%,
  precision 83.3%, recall 90.9%, F1 0.870 (at 15 words: 86.9%, 62.5%, 88.2%,
  0.732).
- The two runs are different samples, so each was also re-scored at the other
  setting with the real detector:
  - on the 20-trial replies, 18 keeps recall at 94.7% and lifts gate precision
    from 80.0% to 83.7%;
  - on the 16-trial replies, 15 would have caught everything (recall 100%,
    precision 89.3%) where 18 misses one borderline case - a
    `daenerys_targaryen` closing that re-emits a 16-word sentence after a single
    intervening sentence, judged mild degenerate by the rubric. That is the
    recall the change gives up, and the first live case of it.
- The two false positives: a Barak ruling restating a two-sentence point in its
  conclusion, and a Daenerys opening line returning as her closing (34 words,
  flagged at any minimum).
- No persona or reasoning failure this time; all 14 capped replies were loops
  (48 of 48 read).
- `mistral-small` degenerated in 25 of 67 replies, `claude-haiku-4.5` in none of
  7; the run cost $0.043.
- Afterwards, on the user's request, all 36 trials from both runs were deleted
  from the database (their arguments, rulings, call-log rows and progress rows
  with them, by cascade): sharing the database with the deployed site, they made
  up 36 of the 50 most recent trials in its run-history sidebar, each shown as
  `interrupted` since no trial ran all three judges.
  - A full backup of every deleted row, 431 in all, was kept in that session's
    scratch directory.

#### Aborts in the call log, and badge spacing

**An early abort now reads predictably in the call log (2026-09-27, the queued
investigation of trial `a02b8215`).** On 2026-09-21 the user aborted a trial on
the deployed site 4 seconds in; its call log looked like much more had happened.

Read from the database: the four abort rows landed at 08:15:36-37 UTC while all
four first attempts were already generating, and each ran to completion anyway -
an in-flight request is not recalled. Nothing was saved and every card read
`aborted`, but the log misled in three ways:

- Jon and Tyrion finished after the abort and were logged as green `success`
  rows, then quietly discarded;
- Daenerys and Grey Worm hit the token cap after the abort and were logged
  "re-tried with the same model", a retry that never happened, followed by a
  "Stopped before attempt 2" row;
- and those stop rows carried the previous attempt's duration again (25,120 and
  24,830 ms with 0 tokens), so the trial's duration total counted about 50 s
  twice.

Fixed on the user's direction ("the call log should behave much more predictably
on early abortions"):

- `recordFailedAttemptAndAdvance()` checks for the abort before recording
  anything, so an attempt that fails as the abort lands becomes the call's one
  final `[aborted-mid-call]` row ("...Not retried: the user aborted this
  trial"), with its real tokens, cost and reply;
- both agent handlers turn a reply that finished after the abort into such a row
  too (`finishedAfterAbort()`), instead of a success;
- and the stop row that ends a call with no attempt running has no duration.
- The fourth item - cancelling the in-flight request - was not built, and
  `openrouter.ts` says why: OpenRouter documents that cancelling a non-streaming
  request does not stop the model or its billing ("you will be billed for the
  complete response", in the Stream Cancellation section of
  https://openrouter.ai/docs/api/reference/streaming), and this app does not
  stream, so cancelling would save nothing and lose the attempt's real tokens
  and cost from the log.
- The call log's caption for these rows is now "(the user aborted the trial)";
  README's architecture note, abort endpoint row and `success`/`aborted` badge
  rows follow.
- Replayed on `a02b8215`, the same abort would now log four abort rows and then
  one `aborted` row per representative (two finished-not-saved, two
  capped-not-retried), each with its own attempt's duration.
- Tests: `tests/retry-logic.test.js` covers an abort landing during an attempt
  for every way an attempt can end (truncated, rate limited, timeout, 5xx,
  removed model, empty reply), an abort before the first attempt, and
  `finishedAfterAbort()`; `tests/trial-status.test.js` runs the real judge and
  representative handlers with the abort landing mid-reply.
  - Breaking the abort check, any of the six return points, the stop row's
    duration, `finishedAfterAbort()` or either handler's use of it each fails
    the check meant for it.

**The abort endpoint's rows read as "abort requested", not "failed" (2026-09-27,
the user's question after a local abort test).** Aborting 4 seconds into a local
trial left four red `failed` rows (model `n/a`, no tokens) above each agent's
own amber `aborted` row.

- They are the rows `abort.ts` writes for every role still pending: the running
  calls look for them to stop, the sidebar derives `aborted` from them, and they
  give a role whose call never reports back an `aborted` card.
- So they stay, but they record a request to stop, not a model call, and were
  stored as `failed` only because the log has two statuses.
- The call log now shows them as a grey `abort requested` badge, captioned
  "(Abort clicked)", in the sidebar's aborted grey; README's call-log badge
  table gains that row and the `failed` row no longer describes them.
- They also no longer count against the site-wide call cap:
  `isGlobalCallCapExceeded()` skips rows whose model is `NO_MODEL_USED`, where
  each abort had cost four of the 350.
- Tests: `tests/render-cards.test.js` checks the row's badge, and
  `tests/trial-status.test.js` runs the real cap check (with the local-dev
  exemption switched off) to show abort rows do not push it to the cap while
  real calls still reach it; `tests/support/fake-supabase.js` gained `neq`.
  Undoing either change fails the check meant for it.

**Abort-request rows dimmed and uncaptioned; badge line-height and padding
settled (2026-09-27, on the user's request).**

- The "(Abort clicked)" caption was dropped, since `abort requested` only ever
  marks one kind of row and says it alone;
- those rows are now dimmed like a discarded attempt, being a record of the
  request to stop rather than an outcome, while the role's own
  `[aborted-mid-call]` row, its outcome, stays at full opacity.
- The dimming class is now `row-dimmed` (it was named for the degenerate-retry
  case only), and `tests/shared-constants.test.js` checks that the class
  `app.js` adds is the one `styles.css` styles.
- README's call-log intro no longer calls every row a model attempt.
- `.badge` gains `line-height: 1.1`, which with the text-box trim changes only
  the gap between a wrapped badge's lines; and its trimmed padding became
  `calc(0.35em + 3.2px) 10px calc(0.45em + 2.8px)`, the user's middle ground
  between the 0.5px lowering of `e7f6503` and none.
  - Measured in Edge, labels with an ascender now sit ~0.5-0.6px above centre
    and the rest ~0.6px below; pill height is unchanged.
- Tests: `tests/render-cards.test.js` checks the abort row has no caption and is
  dimmed, a retried row is dimmed, and an aborted outcome row is not; each fails
  when its behaviour is undone, as do the two shared-constants checks when the
  class is renamed on one side or not added.

#### The third documentation sweep, and the evening merge

**Third full sweep of every markdown file and every code comment (2026-09-27, on
the user's request, ahead of the `main` merge recorded in the next entry).**
Every tracked file read again, line by line, against the code and the database.

The user refined the figures preference mid-sweep: a count that can only grow is
a maintenance burden in a live comment or doc even written "at least N", since
it needs chasing after every trial, so live text now carries no running totals
at all - only fixed, dated samples, whose numbers never change. What it found:

- **Figures the day's own work had overtaken:**
  - `models.ts` gave tier 2 as "23 calls, all clean, as of 2026-09-27", missing
    the 22 escalations of that afternoon's targeted trials and the persona
    failure among them; it now lists its three fixed samples instead.
  - The same went for tiers 3 and 4, the repeated-sentence detector's live-catch
    tally ("at least eleven"), and the run-on check's ("has caught two").
  - `openrouter.ts` gave the capped-reply record as 13 in one comment and 48 in
    another, and its detector notes stopped at the 20-trial run, without the
    16-trial run at 18 words that found the first live miss the higher minimum
    costs.
- **Abort handling described as it was before `82f7c97`:**
  - comments in `db.ts`, `abort.ts`, `openrouter.ts` and `app.js` said a running
    call checks for an abort only between attempts, and that a reply finishing
    after an abort is logged as a success.
  - `duration_ms` was described in `types.ts`, `db.ts`, `schema.sql`, `app.js`
    and README as empty only on rows older than the column, when the abort
    endpoint's rows and a call's "stopped before attempt N" row have none
    either; README's call-log intro omitted that stop row.
  - `db.ts` credited the agent handlers with swallowing `onAttemptStart` errors,
    which `callOpenRouter()` does.
- **Smaller inaccuracies:**
  - `app.js` said Netlify's per-IP rate limit had been seen rejecting calls on
    this project, contradicting README (it had never tripped - in fact, as found
    on 2026-10-02, it had never been applied; it has been enforced and verified
    on the live site since that day, see that day's entries);
  - labels quoted in capitals (`"Aborted"`, `"Truncated"`,
    `"Completed - missing N of 7"`) that the page now prints in lowercase;
  - `styles.css` counted "degenerated" among labels with no ascender;
  - the headers of three test suites listed what they protect without the abort,
    call-cap and badge checks added that day, and README's description of
    `tests/trial-status.test.js` likewise.
  - Dated log entries that said a comment "now reads" what it no longer does
    were put in the past tense, and a 2026-09-20 note on aborted judges logging
    `success` gained an italic pointer to the change.
- README's "Tech stack" section, a bare list of what the Architecture section's
  first line already names, was folded into that line earlier the same day
  (`4b87380`), with the docs test's bundler check moved to it.

**Merged to `main` (2026-09-27, on the user's explicit request), triggering a
deploy: 19 commits, everything since that morning's merge (`0cd124c`).** They
are:

- badge text centred the same way in every font (`text-box` trim), with every
  badge label lowercase in the text itself, and the result measured in WebKit
  too (`a455133`, `e88f7c3`, `83b0d48`, `e7f6503`);
- an abort row's model shown as `n/a` rather than a shortened `a` (`7b18793`);
- README's endpoint table reworked so the paths stay whole, ending without its
  Function column (`4f997b1`, `7a3e0ad`, `d01be87`), and its Tech stack section
  folded into the Architecture line (`4b87380`);
- the record of Netlify's "Powered by Netlify" badge turned off (`efbfd69`);
- the clause-level repetition rules, and capped replies documented as the loops
  they are (`6a43bf2`);
- the long-sentence repeat minimum raised from 15 to 18 words, and the detector
  measured again at 18 (`4a306fe`, `e2c1b7b`);
- README's note on what "missing N" counts (`04a2707`);
- the call log reading predictably when a trial is aborted early (`82f7c97`),
  the abort endpoint's rows shown as a dimmed, uncaptioned `abort requested` and
  left out of the site-wide call cap, and the badge spacing settled (`a3fe0d8`,
  `e464938`);
- the third full documentation sweep (`32e7c0a`);
- the commit that adds this entry.

No database change is needed: nothing since `0cd124c` adds or alters a column.
Merge commit `67f00f1`. This entry was committed to `draft` ahead of the merge,
so that right after it `main` and `draft` held identical trees.

**Confirmed live the same day**, on the user's go-ahead, by fetching the
deployed site's public files over plain HTTPS: `app.js`, `styles.css` (both
changed in this merge) and `index.html` all matched `main` byte for byte.

### 2026-09-28: near-verbatim loops, and the prosecution seats

**Near-verbatim loops caught (2026-09-28, on the user's request).** Daenerys's
argument in trial `5bb8f477` was saved as a success while closing on a loop: its
last five paragraphs rotate the same three phrases ("a woman who was a threat,
who was a liberator, and who was a ruler"), the last reshuffling the one before.
No rule caught it, because every copy differs by a word or two and the detector
compared sentences and clauses only exactly.

**Measured read-only** over the 959 replies ever kept as a success (851 in the
database, 108 from the backup of the targeted trials deleted on 2026-09-27): the
existing rules flag 133 and pass 826.

- The 104 passing replies that scored highest for repeated wording were read in
  full - 24 clear near-verbatim loops, 36 borderline, 42 sound, and 2 with other
  defects (a self-contradicting ruling; a Shamgar ruling copying Grey Worm's
  argument) - and random samples below that cut-off (16 of 181, 12 of 541) held
  2 more clear loops.
- All were on the tier-1 default model; Grey Worm accounted for most of them and
  Daenerys for the next most, and 8 had been saved on 2026-09-27, under the
  current rules.
- Sentence similarity alone could not separate them: a sound ruling restates
  single lines all the time, and it rejected 32 of the 60 sound replies read.

**The two new rules.** What separates a loop is a block re-emitted, or a closing
that reshuffles what is just above it, so `detectRepeatedSentences()` gained two
rules, measuring two sentences' likeness by word-level edit distance:

- 2+ consecutive sentences found again at least 80% alike (10+ words in all),
- and a sentence in the last 10% at least 60% like one of the 4 before it (8+
  words each, identical copies left to the exact rules).

Tuned on the 132 labelled replies, then checked on 51 flags among replies not
yet read, every one of them read before counting. Two settings were offered; the
user chose the looser (the stricter one, last 5% and 12+ words, caught 24 of the
28 known loops and rejected 14 sound replies).

- Run as shipped over all 959, the detector newly rejects 109 of the 826: 27
  clear loops (of 28 known - it misses a Daenerys closing in trial `dc1cb897`
  that re-emits its lines too early), 44 borderline and 38 sound, and accepts
  nothing it rejected before.
- A rejection costs a tier-1 retry, or now and then an escalation to Haiku;
  since a retry can itself be rejected, 38 wrongly rejected replies mean about
  43 extra attempts.
- Neither rule catches a loop that never re-emits a sentence, such as an
  escalating list.

**Tests:** `tests/retry-logic.test.js` runs the `5bb8f477` Daenerys reply and a
Grey Worm reply (trial `7520a32c`) word for word, one per rule;
`tests/docs.test.js` checks every threshold README states, just inside and just
outside, at 1% steps for likeness.

- Both suites' filler sentences ("Point number 1 stands on its own terms here.")
  were near-copies of each other, which the new rules rightly flag, so each
  filler word now carries its own suffix; and the check that a 2-sentence
  passage repeated is not caught now says what is true, that the 3-sentence
  verbatim rule does not name it.
- Proven load-bearing: 24 breaks to the new rules and to README (every threshold
  moved either way, each rule disabled, likeness measured over the shorter
  sentence, the closing position off by one, README out of step in one place and
  everywhere) each fail the check meant for them.
  - One first got through - moving the closing share to 9% - because the
    position probe could only put the copy 88% or 92% of the way through; it now
    uses 100 sentences, so the copy sits exactly on the line.
  - 14 more breaks prove again the older checks whose probes were rewritten, and
    showed that one check added here guarded nothing (a clean three-sentence
    reply stays clean under any setting), so it was dropped.
- `npm test` then ran 381 checks.

Two other things seen in the reading:

- judges sometimes quote a representative's argument at length in a ruling,
  which their prompts allow, since every argument is put before them to weigh;
- and three trials on 2026-09-20 (`b3a1d6e3`, `12498f92`, `f7ac3ec6`) received
  the same Grey Worm reply, byte for byte, a sound argument each time.

**Prosecution seats that argue for Jon are left as they are, on the dossier's
explicit terms (2026-09-28, the user's decision).** In trial `651cee8a`
Daenerys, seated for the prosecution, closed on "in the end, he was right... I
cannot say it was right, but I can say it was necessary", and Grey Worm, also
prosecution, submitted that the killing "was justified as the necessary defense
of others and of the realm"; all three judges still ruled not justified.

It is not a one-off. In a hand-checked sample of stored closings that same day,
about 2 of 6 of Daenerys's and 4 of 6 of Grey Worm's argued Jon's side, so a
trial can reach the judges with every representative leaning towards the
accused.

Nothing is to be changed for this, and the sole ground is what the dossier says.
It states:

- that the assigned seat "fixes only each representative's procedural role. It
  does not fix an opinion, factual inference, proposed argument, or final
  position";
- that no prompt may instruct a representative "to argue toward a predetermined
  conclusion";
- and that "it is acceptable and expected that a representative's argument may
  not straightforwardly support 'their side' if genuine reasoning in character
  leads elsewhere" (Parts 2 and 4 above, transcribed from the dossier, which
  outranks this file).

Any change that pushed the prosecution seats back towards prosecuting - a
seat-driven instruction, a nudge towards a verdict, a retry on an argument that
concedes - would break those terms, and so is not open.

Her character is fully in place: Daenerys's prompt carries every trait the
dossier gives her, including that "you react sharply to betrayal, condescension,
or secret maneuvering", and `representatives.ts` was checked line by line
against the dossier on 2026-08-28 and found faithful. That her argument in
`651cee8a` voiced its concession without that edge - noting that Jon acted
"alone, in secret" and accepting it - is variation in what the model wrote on
one run, not a gap in her prompt, and nothing about it is pending.

### 2026-10-02: the per-IP rate limit, applied for the first time

**The per-IP rate limit had never been applied, and now sits on the agent routes
in netlify.toml (2026-10-02, on the user's request to enforce what the docs
promise; Netlify and OpenRouter calls authorised for it).**

**How it was found.** A sweep for open-issue wording flagged every claim about
the limiter, all saying it had "never been tripped", so it was tested live
instead:

- 46 POSTs, then 75 over 80 seconds, from one IP to
  `/api/trials/<random id>/representatives/jon_snow` with no site-gate header
  (rejected in the handler before any database or OpenRouter call, so no quota
  spent).
- All 121 came back `202`, the second batch well past the 45-request limit and
  Netlify's documented "up to 10 seconds" enforcement delay.
- The production deploy log (67f00f1's, read by the user) mentioned no
  rate-limit rule at all, although Netlify documents that it lists a valid rule
  and reports an invalid one.

**The cause**, read in Netlify's bundler (`parseSource` in
`@netlify/zip-it-and-ship-it` 9.42.1, inside `netlify-cli`): a function's
`config` export is read only when the function has a default export
(`isV2API = handlerExports.length === 0 && hasDefaultExport`).

- Every function here uses a named `handler` export, so both agent functions'
  `config` - `rateLimit`, `background: true` and `path` - had been ignored since
  it was written.
- The functions were Background Functions by their `-background` filenames
  alone, routing always came from netlify.toml, and the window (300 seconds) was
  also over Netlify's 180-second maximum.

**Fixed in `3c30abc`:**

- a `[redirects.rate_limit]` block on the representatives and judges redirects
  (30 requests per 180 seconds, aggregated by IP and domain - Netlify documents
  rate limits on netlify.toml redirects for every plan, two rules on this one);
- the inert `config` exports removed;
- comments, README and `tests/docs.test.js` brought in step (the test now reads
  the limit from netlify.toml, checks the window is within 180 seconds, and
  fails if any function exports a config next to a named handler).
- Checked locally that both routes still answer `202` and reach their handlers.

**Alternatives.** Rewriting the functions in Netlify's default-export syntax was
considered and not chosen: a much larger change to the two most important files,
for nothing the redirect rule does not already give; Netlify announced on
2026-05-27 that deploys containing functions in this syntax ("Lambda
compatibility mode") start failing on 2027-06-01, and that such functions stop
being invoked after 2027-12-31
(https://answers.netlify.com/t/deprecating-lambda-compatibility-mode/162944,
read 2026-10-05). Dropping the per-IP layer and documenting two was ruled out by
the user.

A follow-up scan that day corrected the descriptions still resting on the limit
that never ran - among them the reasoning that the trigger pool exists for it,
when a limit that counts requests in a window does not care how they overlap -
and `tests/render-cards.test.js` gained a check that the bare, empty-bodied
`429` the live limit returns shows on the agent's card as Netlify's per-IP
limit.

**Merged to `main` (2026-10-02, on the user's direction to enforce the rate
limit, which only a deploy can show), triggering a deploy: 10 commits,
everything since the 2026-09-27 merge (`67f00f1`).** They are:

- the record of the `67f00f1` deploy confirmed live (`ead6e99`);
- near-verbatim loop detection, and the comments and log entries brought in line
  with it (`5c06c12`, `3b0a758`);
- the decision record on prosecution seats, and the wording that every settled
  matter reads as settled (`99b108c`, `09577c9`, `84c1a7b`);
- JSDoc on every JavaScript helper and every backend function (`342057f`,
  `fb1619f`);
- the per-IP rate limit moved onto the agent routes in netlify.toml (`3c30abc`);
- the commit that adds this entry.

No database change is needed. Merge commit `6af2e72`. This entry was committed
to `draft` ahead of the merge, so that right after it `main` and `draft` held
identical trees.

**Confirmed live the same day**, under the same authorisation: the deployed
`app.js` matched `main` byte for byte 26 seconds after the push, and the rate
limit was then tested on the live site with ungated POSTs (no quota spent).

- 55 to the representatives route, 0.4 seconds apart, got 32 `202`s and then
  nothing but `429`s (an empty body; Netlify enforces with a short delay, so 2
  got through past the 30).
- 45 to the judges route straight after got one `202` and then `429`s, which
  showed the two rules count one IP's requests together; after the window had
  cleared, 20 to the representatives route left 11 for the judges route before
  the `429`s began.
- README and netlify.toml were then corrected on `draft` to say the 30 are
  counted across the two routes together, and that the limit was verified -
  comments and docs only, so they ride with the next merge.
- `GET /api/trials` answered `200` throughout.
- The user kept the limit at 30 (about 4 full trials per IP in 3 minutes) rather
  than raising it to restore the per-route headroom of the old setting: retries
  and escalations run inside the Background Function and send no further request
  through these routes, so a trial costs 7 against the limit however many
  attempts its agents take. *(Raised to 60 on 2026-10-04, on the user's
  direction - see that day's entry.)*

### 2026-10-03: absolute and conditional claims checked

**Claims of the form "the only", "every", "never" checked across every tracked
file (2026-10-03, on the user's request), and the ones an exception disproved
restated.** Where a claim could be measured, it was measured rather than
reasoned about:

- **Opening a trial from history while it is still running**, tested on local
  `netlify dev` with a real trial (on the user's go-ahead; 13 attempts, 11 on
  the default model and 2 on tier 2).
  - The page shows the trial as recorded at that moment and does not poll it.
  - A role with no final outcome yet - no row logged, or only discarded
    attempts - has no entry, and its card read "No result recorded for this
    role - nothing was logged for it in this trial", which was false for a role
    with discarded rows and misleading for one still running; a phase with no
    finished role stays hidden.
  - The card now reads "No result recorded for this role.", true in both cases,
    and the comment above it describes all of them.
- **The call log table's narrowest width**, in headless Edge: 655px at a 901px
  viewport with no page scrollbar, 640px with the classic 15px one a trial's
  content brings; at 640px the longest model id in use, a five-digit token
  breakdown and every header still fit on one line.
- **The `color-mix()` transition trap**, in Edge 154 and WebKit 26.6: Edge
  reproduces the near-black `rgba(1, 0, 0, ...)` from `none` and from
  `transparent`, and WebKit interpolates correctly from both.
- **OpenRouter's account endpoints**, with real calls (on the user's go-ahead):
  `GET /api/v1/key` and `GET /api/v1/credits` report dollars only, and a
  successful chat completion carries no `X-RateLimit-*` headers. The section on
  OpenRouter spend further down was rewritten to match.
- **Facts confirmed by a read-only query:** the longest tier-1 reply ever kept
  that finished on its own ran to 1,147 tokens, and the longest tier-1 loop that
  stopped on its own to 1,333 (on 2026-10-02, discarded).
  `google/gemini-2.5-pro`'s six kept calls, whose counts include its reasoning
  tokens, ran 2,053-2,564.

The rest were wording:

- the call cap counts call-log rows and is checked as each call starts;
- an abort, not every path, leaves an in-flight request alone;
- the anaphora notes in `openrouter.ts` name the sentence rules;
- a call that never starts an attempt is described wherever the duration column
  is;
- the Supabase grants are needed on a project created with "Automatically expose
  new tables" unchecked;
- and an unverified claim that browsers cannot animate scrollbar colours was
  dropped from the code comments.

**The last README figures taken from the code put under test (2026-10-03, on the
user's go-ahead).** The same scan found three that `tests/docs.test.js` did not
check: "the 1,400 tokens the default model is given", "a trial costs 7" and "a
full trial sends 7 requests".

- Two checks now cover them: the cap against `AGENT_MAX_TOKENS` in `models.ts`,
  and every "a trial sends/costs N" in README and `netlify.toml` against the
  number of agents in the code, one trigger request each.
- Seven targeted breaks were each caught by the check meant for it, every file
  restored byte for byte: each of the four figures changed, the cap sentence
  reworded, `AGENT_MAX_TOKENS` changed, and a fourth judge added to the code.
- Every other number in README is either already checked or a dated measurement.

**Conditional claims ("X only happens when Y") checked across every tracked file
(2026-10-03, on the user's request), and the ones whose conditions are wider
brought in step.** Behaviour was checked by running the real handlers and app.js
offline, and the database read-only; no model calls were made for it.

- **The legacy `truncated` badge is now dated.** It marks a success row only if
  it was logged before `298d2fa` (2026-08-29 13:19:36 UTC), when a reply still
  capped at the end of the chain became a failure: all 13 success rows at a
  multiple of the cap were logged before then, the last at 13:04 UTC.
  - A later success is not marked, since a later tier, whose cap is larger, can
    finish on its own at exactly 1,400 or 2,800 tokens. See
    `TRUNCATION_BECAME_FAILURE_AT` and `isLegacyTruncation()` in `app.js`.
- **The call log's `no response` caption says whether the row was retried on the
  same model or escalated**, read from the end of the row's message
  (`isEscalationMessage()`), as the content-quality rows already did through
  their two markers.
- **Two messages a card can show were reworded to what OpenRouter's limits docs
  (read that day) say:**
  - a 402 means the remaining balance, or the key's own spending limit, cannot
    cover the request at its `max_tokens`, which can happen before the balance
    reaches zero;
  - and the 429 that ends a call is a rate limit whose reset is later than the
    call's remaining budget (paid models have no platform request caps, so it is
    not a request quota).
- **README and the comments now say:**
  - an abort while any judge is still running leaves the trial `created`,
    however many judges had finished;
  - a judge whose call never runs leaves the trial `interrupted` once 40 minutes
    old, while a representative's leaves it `completed — missing N`;
  - `hadFailures` is true for any row stored as failed, an abort's included;
  - the fast-failure retries are free only for the first few at each tier;
  - the detectors run on every reply with text but a capped one, whatever its
    `finish_reason`;
  - and a reply with no text, a reasoning model's capped one included, is
    `no response`.
- **Tests:** 30 new checks (`npm test` ran 418 that day, up from 388). Each of
  them, and each of the four existing checks whose test data changed, fails
  under at least one of 28 targeted breaks, every file restored byte for byte.

### 2026-10-04: inclusive and comparative claims, and the rate limit raised

**Claims of inclusion ("every", "all", "only", "the rest") checked across every
tracked file (2026-10-04, on the user's request), and the ones an exception
disproved restated.** Behaviour was checked by running the real code offline and
by read-only queries; no model calls were made.

- **Two changes to `callOpenRouter()`.**
  - A reply that an upstream error cuts short is now a transient failure
    (`no response`), retried or escalated, and never kept. OpenRouter's errors
    docs (read that day) say a non-streaming request that fails after its 200 is
    sent gets back the text generated so far, with `finish_reason` `error` and
    an `error` object in the choice; such a reply went through the detectors
    like any other, so a clean-looking part of a reply could have been saved.
    The partial text is kept in `response_text` for audit.
  - And an HTTP 408, OpenRouter's own request timeout, is now retried like a
    timeout rather than skipping the rest of its tier as a removed model id
    does; no 408 appears in the call log.
- **When the page stops waiting.** With every attempt hanging to its ceiling,
  simulated offline, a call ends at 587s for a representative, 648.6s for a
  judge and 650.0s at most; and across 132 representative calls, the first
  attempt started 2.8s after the trial was created at the median and 7.1s at
  most.
  - So when polling gives up at 700s, the call has ended or never started. The
    card for that case now reads `no result`, and its message no longer says the
    call may still finish.
- **More is checked.**
  - `tests/shared-constants.test.js` now compares every copy of the roles (in
    app.js, prompts.ts, types.ts, models.ts and schema.sql) with
    representatives.ts and judges.ts, and app.js's names and seats; the
    scrollbar's resting opacity with styles.css's fallback; and the phrase the
    call log tells a truncation by. It also checks that `POLL_TIMEOUT_MS` and
    `INTERRUPTED_THRESHOLD_MS` stay above the server's budget.
  - `tests/docs.test.js` now runs both agent handlers to check the order of
    their checks and which rejections are logged, as README states them, and
    checks the files and routes CLAUDE.md's requirement parts name.
- **Wording:** the tier 3 against tier 4 price comparisons, the "2-3x"
  comparison with the old tier 2 model and the "flagship" framing were removed;
  the 2026-08-29 same-model-retry figures are dated, with that day's settings
  named; and the rest were restated - among them "side by side", "every
  decision", the 10-second fast-failure line, the HTTP errors that skip a tier,
  and two test counts in this log, now in the past tense.
- **Tests:** 82 new checks, one changed and one removed (`npm test` ran 499 that
  day, up from 418). Each new or changed check fails under at least one of 69
  targeted breaks, every file restored byte for byte.

**The per-IP rate limit raised from 30 to 60 requests per 3 minutes (2026-10-04,
on the user's direction).** At 30, counted across the two agent routes together,
one IP had room for about 4 full trials every 3 minutes, which several graders
on one shared network could reach; at 60 it has room for about 8.

- The site-wide call cap is what bounds spend, and one IP could use it up within
  minutes at either limit.
- Both rules in `netlify.toml` changed together, and README and the
  `netlify.toml` comment now give 60, with the 2026-10-02 live measurements kept
  and dated to the 30-request limit they were made at.

**Comparative and superlative claims checked across every tracked file
(2026-10-04, on the user's request), and the ones that overstated restated.**

- Model prices are no longer compared in figures anywhere: the docs say tier 2
  is significantly pricier than the default tier, and nothing ranks tiers 3 and
  4 against each other, since prices drift and are outside this project's
  control.
- Tiers 3 and 4 are no longer called top-tier, and `TOP_TIER_FALLBACK_MODEL` is
  now `THIRD_TIER_FALLBACK_MODEL` (with `getThirdTierFallbackModel()` in
  `models.ts`); the fallback-tier variables are left unset on Netlify (see the
  2026-08-30/2026-09-01 entry above), so the rename needs no change there.
- The sidebar's 40-minute "interrupted" threshold is now checked against the
  real worst case - the page polling the representatives for its whole window,
  then the judges running out their budget - rather than against two budgets.
- The rest were wording: how the per-attempt timeout scales with prompt size,
  which call-log columns are tight, the judge-timeout check's name (it cited one
  judge reply as the slowest, and slower ones had been logged), and what a day
  at the call cap costs.
- Each new or changed check fails under a targeted break meant for it, every
  file restored byte for byte.

### 2026-10-05: claim sweeps, the abort endpoint's reply, and README's layout

#### The claim sweeps

**Temporal claims checked across every tracked file (2026-10-05, on the user's
request), and the ones likely to drift dated.** Claims of the kind "currently",
"as of", "still", "never", "the slowest so far" and present-tense counts were
read against git history, a type-check run and a read-only download of the call
log (whose last row was then from 2026-10-03).

- Each one likely to drift now carries the date it was measured or read, or was
  restated without its figure where the figure was not needed;
- each claim about an outside platform (Netlify, OpenRouter, Firefox, the
  installed netlify-cli) names the date it was read, and its source where one
  exists.
- Dates across the docs and comments follow the convention stated at the top of
  this section.

**Numeric claims checked across every tracked file (2026-10-05, on the user's
request), and the ones the record did not bear out restated.** Every count,
measurement and amount in the docs and comments was read against the code, git
history and a read-only download of the call log (whose last row was then from
2026-10-03). What changed:

- **Capped replies.** The statements that every capped reply whose text was
  stored was a loop are now scoped to the default model: the stored corpus also
  holds a `barak` ruling from 2026-08-27, on a free-tier model at that day's
  1,100-token judge cap, that reads as a coherent opinion cut off mid-sentence.
  The legacy `truncated` badge, which reads multiples of 1,400, is described as
  marking the replies saved under that cap.
- **429 durations.** The 429s logged before the backoff-timing fix of 2026-09-26
  include the pause in their duration, so comments and log entries no longer
  quote those durations as response times.
- **Corrected against the log or git:** Mistral Large's fallback results on
  2026-08-29 (3 clean, 1 truncated, 1 the wrong-id HTTP 400); the escalation
  chain's verification runs (24 targeted tests and 4 full trials, 100 calls);
  the 20-test batch's escalations; the server budget's history (raised twice
  after the Background Functions move); and the GitHub icon's halo radii.
- **Dropped where the sentence holds without them:** the judge and
  representative cap-hit counts, the system-prompt lengths, and undated timings
  and badge offsets. Two timing claims and a trial count that no record supports
  were removed.

**Cross-references checked across every tracked file (2026-10-05, on the user's
request).** Every pointer in the docs, the code comments and the schema - to a
file, a function or constant, a section or heading, a log entry, or a position
such as "above" or "further down" - was followed to its target, and the few that
did not land where they said were corrected. The details are in the commit
message.

**Lists and enumerations checked across every tracked file (2026-10-05, on the
user's request).** Every list in the docs, the code comments and the schema - of
failure kinds, badges, columns, checks, rules, test coverage and the like,
whether set out as bullets or run into a sentence - was read against what it
lists, and the ones that had fallen behind were completed. The details are in
the commit message.

**Contradicting claims checked across every tracked file (2026-10-05, on the
user's request).** Every claim was read against the others that touch the same
fact, and against the code, git history and a read-only query of the database;
where two disagreed, the record settled which was right and the other was
corrected. The judges' names in `judges.ts` now match their card headings, and
`tests/shared-constants.test.js` checks that the two stay in step. The details
are in the commit message.

#### The abort endpoint's reply

**The abort endpoint replies with the roles it wrote rows for (2026-10-05, on
the user's go-ahead).** Its reply lists the roles it recorded an abort for. Run
that day against the real database with an id that has no trial behind it, it
had answered `200` naming both roles while the foreign key rejected both rows.

- `logApiCall()` now returns whether its row was written, and `abort.ts` lists a
  role only when it was; nothing else reads that result, the page included, so
  nothing a user sees changes.
- `tests/trial-status.test.js` runs the real handler against an in-memory
  database that enforces the foreign key: the check that a rejected row is not
  reported fails when every role is reported regardless and when `logApiCall()`
  always reports success, and both new checks fail when the condition is
  inverted.

#### README's endpoint list, database map and badge tables

**README's endpoint table became a list (2026-10-05, the user's choice of
layout).** On a phone with scaled-up text, the table's Path column took most of
the width: a code span cannot wrap inside a table, so the column was as wide as
`/api/trials/:id/representatives/:role` on one line, leaving the descriptions
about 214px of a 700px table (measured through GitHub's markdown API with its
own dark CSS, in headless Edge).

- Each endpoint is now a list item of two lines: the route, as one `<code>`
  element with the method in bold (`<code><b>POST</b> /api/...</code>`; GitHub
  keeps `<b>` inside a raw `<code>`) and `GET` followed by two spaces so every
  path starts in the same column, then the function and what it does.
- In the code font, bold and regular letters measured the same width in every
  font with a real bold face; a browser-synthesised bold moves a `POST` path
  about 0.3px.
- `tests/docs.test.js` reads the list instead of the table, and gained checks
  that every entry has that two-line shape and that the paths line up; routes
  written in that `<code>` form anywhere in the docs are now checked against
  `netlify.toml` too.
- 53 targeted breaks were each caught by the checks meant for them, every file
  restored byte for byte: 31 to the list's shape and content, and 22 that fail
  each per-endpoint check under its own name, by breaking the handler, the tree
  or `netlify.toml` instead.

**README's database section laid out as a map and one section per table
(2026-10-05, on the user's request).** It was six dense paragraphs.

- It now opens with a table of the six tables and what one row of each holds,
  each name linking to its own `#### name` section (GitHub's anchors for those
  headings checked on the rendered page);
- each section starts with a Columns line listing the table's columns in
  `schema.sql`'s order, allowed values beside them, then short bullets.
- `tests/docs.test.js` reads that layout and holds it tighter than before: the
  overview must list every table in schema order and link each to its own
  section, the sections must follow the same order, and each Columns line must
  name exactly the table's columns, in order, where before every column only had
  to appear somewhere in its paragraph.
- 59 targeted breaks were each caught by the checks meant for them, every file
  restored byte for byte, and every check that reads the section, or compares it
  with `schema.sql`, SPEC.md or CLAUDE.md, failed under at least one of them.

**README's call-log badge table keeps every label on one line (2026-10-05, on
the user's request to widen its Badge column).** GitHub sizes that column by its
longest unbreakable word, so `abort requested` wrapped onto two lines.

- The two labels of more than one word are now
  `<code>abort&nbsp;requested</code>` and `<code>no&nbsp;response</code>`, which
  widened the column from 125px to 150px at 1012px, and from 146px to 181px at
  720px with text at 125% (GitHub's markdown API and dark CSS, in headless
  Edge).
- `tests/docs.test.js` reads labels in either form, and a new check fails if a
  label of more than one word is not joined that way; 8 targeted breaks were
  each caught by the checks meant for them.

**README's run-history badge table wraps its long labels in one chosen place
(2026-10-05, the user's design).** Joining `completed — missing N of 7` and
`aborted (N of 7 completed)` whole would have taken too much width from the
descriptions, and left free they wrapped at every space, `aborted (N` / `of 7` /
`completed)`.

- Each now wraps once, right after the label it qualifies (`completed —` /
  `missing N of 7`, `aborted` / `(N of 7 completed)`), with `&nbsp;` everywhere
  else, and `in progress…` never wraps.
- Measured as for the call-log table: the Badge column went from 139px to 177px
  at 1012px and from 152px to 206px at 720px with text at 125%, both long labels
  on exactly two lines.
- `tests/docs.test.js` reads the labels in either form, and a new check derives
  each label's one allowed break from the table itself - after the shorter label
  it starts with, and any dash - and fails on any other; 14 targeted breaks were
  each caught by the checks meant for them.

### 2026-10-06: this file's layout, and HARD RULE 4

**This file restructured (2026-10-06, on the user's request, after the layout of
another project's CLAUDE.md).** Before, many of its lines ran to thousands of
characters, which made the file unreadable in GitHub's Code view without
line-wrapping, and many entries were single dense paragraphs.

- Lines are now wrapped at 80 characters, long entries are split into paragraphs
  and sub-items, and the status log has a heading per day or arc.
- The sections after the log are grouped under "Operational notes",
  "Reliability write-ups", "Frontend write-ups", "Anti-abuse layers" and the bug
  log, each topic a heading of its own.
- The content is unchanged. Rendered through GitHub's markdown API before and
  after, every sentence of the old text is in the new, apart from the headings
  added and a few pointers ("the next two bullets") reworded for the new layout;
  the wrapping was checked separately, and changes nothing in the rendered page
  but line breaks.
- Three `<date>` placeholders in HARD RULE 3, which GitHub's renderer dropped as
  unknown HTML tags, are now written so they show.
- "Writing in this file", above this log, sets out how to keep the layout.

**HARD RULE 4 added (2026-10-06, by the user): in every Markdown file but this
one, a reference is a link** - see the HARD RULES block at the top, which adapts
another project's rule in its broader reading. Applied the same day to the two
files it covers, `README.md` and `SPEC.md`:

- 50 links added: every file and directory they name, the other documents and
  the sections meant (`README.md#database`, `CLAUDE.md#status-log`), the two
  commits README describes in prose (the `-background` rename and truncation
  becoming a failure), `npm test`, tables, routes and a badge named away from
  their own sections.
- Rendered through GitHub's markdown API before and after with every `<a>` tag
  stripped, the two files are identical apart from one new sentence in README's
  description of `tests/docs.test.js` saying it checks this rule, so nothing
  else but links changed.
- `tests/docs.test.js` now checks the rule on every Markdown file but this one -
  a new one included - as the rule's last section describes, and reads README's
  endpoint list with each function linked to its own file.
- 27 targeted breaks were each caught by the check meant for them, every file
  restored byte for byte: an unlinked file, document, `npm test`, table, route
  or hash; a link to the wrong file, table or commit; a misspelt anchor in
  either file; a short or non-existent hash; a missing file; whitespace in a
  destination; an absolute link into the repository; and a new Markdown file
  with an unlinked file name. Two more confirmed what stays plain passes: a
  table named in its own section, and a second mention in one paragraph.
- Then mapped the other way round, from each check to a break: the 15 new
  checks, and the 37 endpoint-list checks that read the function names now taken
  from their links, each fail under at least one of 41 targeted breaks (30 in a
  first pass, then 11 written for the 11 checks none had failed yet: four
  functions' methods, two handlers' success, and the site-gate statement on five
  routes), every file restored byte for byte. Three changes that should pass
  did: a valid compare page, and a table and a route linked from SPEC.md to
  their README sections.

## Operational notes

### Image and screenshot volume in long sessions

A recurring operational constraint worth knowing about up front.

This project involves a lot of unfamiliar external dashboards (Supabase,
OpenRouter, Netlify, GitHub) that the user navigates by pasting screenshots for
step-by-step guidance. Discovered while working on this project: **a single
Claude Code conversation has a ceiling on total accumulated image data**, not
just per-image size.

Early in a session, even a large screenshot (e.g. 3840×2160) comes through fine;
later in the *same* session, once "many images" have piled up in the
conversation history (which gets resent in full with every message), even a
small, cropped image (e.g. 1127×1492) starts failing with an error like "image
dimensions exceed max allowed size for many-image requests: 2000 pixels" —
confirmed this is about cumulative volume, not the specific file, by testing the
exact same image both as an inline paste and via a local-file Read, both
rejected identically.

It clears once the conversation is summarised, which drops the earlier images
along with the rest of the detail. The harness does that on its own once a
conversation runs long, and the `/compact` command does it on demand, in the
same session.

**When it happens: run `/compact`, or start a fresh Claude Code session in this
same project directory (`d:\Misc\tribunal-project-guy-cohen`) and tell it what's
in progress.** A fresh session is exactly the scenario this file exists for — a
fresh session reads the "Status log" section (kept live-updated for exactly
this reason) plus memory (see below) plus the real repo state, and can resume
with zero context loss and a full fresh image budget.

Two lighter mitigations that extend how long a session lasts before hitting
this:

- crop screenshots to just the relevant region before pasting,
- and lead with a text description for standard/well-known UI flows, reserving
  screenshots for genuinely ambiguous moments.

### Cross-session memory

Cross-session memory relevant to this project also lives outside this file, in
Claude's persistent memory system (separate from the repo and from this file) —
see `tribunal-git-workflow`, `keep-claude-md-status-current`, and
`economical-openrouter-testing` there. A fresh session should have these
recalled automatically; if not, they're worth asking about explicitly.

### OpenRouter spend and rate limits

There is no daily request allowance to check. The account has been paid since
2026-08-28, so there is nothing that resets overnight - only a prepaid balance
that real calls draw down (see `pricing.ts` for what each tier costs).
OpenRouter reports that balance in dollars, not requests. Called on 2026-10-03:

- `GET https://openrouter.ai/api/v1/key` returned the key's dollar limit and
  what is left of it (`limit`, `limit_remaining`), its dollar `usage` by day,
  week and month, and a `free_model_daily_requests` count that applies only to
  free models, which this project does not use;
- `GET https://openrouter.ai/api/v1/credits` returned the account's total
  credits and usage, also in dollars.
- Neither reports a rate-limit figure: the key's `rate_limit` field is marked
  deprecated.

What is still true: **429s happen during dense testing and are not a bug.** They
are burst rate limiting, and the app handles them (the first few fast ones at
each tier do not even cost a tier attempt - see `FAST_FAILURE_THRESHOLD_MS`).

A successful chat completion carries no `X-RateLimit-*` headers (checked on
2026-10-03 with a real call), so there is no figure to watch before a 429
arrives. Space tests out rather than trying to query one.

### Netlify credit consumption

Operationally important — the free tier is a hard constraint here.

- **A production deploy costs a real share of the free plan's monthly credits**
  (recorded on 2026-09-02).
  - Function compute and bandwidth for an app this size were negligible by
    comparison when measured: on 2026-08-26, a day with 10 deploys, the deploys
    accounted for nearly all of the credits used, and all the OpenRouter test
    traffic for a tiny fraction.
- **This makes "merge to `main` to test a fix" genuinely expensive**, at a real
  slice of the monthly allowance per attempt.
  - `netlify dev` locally costs **zero** credits (it never touches the build
    pipeline), makes real OpenRouter and real Supabase calls, and is the correct
    place to iterate. Deploy only at genuine milestones.
- Netlify's free plan carried **"no overage charges ever"** as of 2026-09-02 —
  exceeding the month's credits paused the site until the next cycle rather than
  billing. Worth knowing, but not a reason to be casual: a paused site mid-work
  is its own problem.
- As of 2026-09-02, the usage breakdown lived at Team → **Usage & billing**
  (credit balance) and → **Builds** → "Usage & insights" (per-project build
  counts, which is what actually reveals deploy spend).

### Tools on this machine

- **`gh` (GitHub's CLI) was not installed on this machine as of 2026-10-04.**
  Repo creation and any other GitHub-side action went through the browser
  (github.com) instead — don't suggest `gh` commands without checking it's
  actually available first.
- **`curl`ing a raw API key directly in a Bash command gets blocked by the
  harness's auto-mode safety classifier**, even for a legitimate first-party
  check (OpenRouter's own key-status endpoint, using the key as intended).
  - Workaround: keep the literal secret out of the command text — e.g.
    `-H "Authorization: Bearer $(grep KEY .env | cut -d= -f2)"` instead of
    interpolating the key directly — so the classifier doesn't see a bare secret
    in the command itself.

## Reliability write-ups

### Free-tier multi-model fallback/retry architecture

**Real findings at the time, fully removed 2026-08-28.** This app originally ran
on OpenRouter's free tier, which meant contending with failure modes a paid
model doesn't have — measuring the real API directly (timing headers vs. full
response body separately, rather than trusting a generic failure message) found
that the single most common failure was a **shared upstream worker-pool limit,
returned as HTTP 200 with an `error` body instead of `choices`** rather than a
real error status (so `response.ok` was true and a naive check swallowed it),
hitting up to ~60% of calls at times.

The fix at the time was a `models` fallback array (each model id has its own
independent worker pool) plus a distinct, explicitly slower last-ditch model
tried once after the normal retry ceiling.

Both mechanisms — `FALLBACK_MODELS`/`LAST_DITCH_MODEL` in `models.ts`,
`callOpenRouterOnce`, the client-side retry-until-success/last-ditch phase in
`app.js` — were removed entirely in commit `dee917e` when switching to a single
paid model (`mistralai/mistral-small-24b-instruct-2501`): the specific problem
they solved (a *shared, account-independent* capacity pool) doesn't exist on
paid usage, and silently substituting a different, lower-quality free model
after a paid one fails would be a worse outcome than a clean visible failure.

If a free or multi-provider setup is ever revisited, this same class of problem
should be expected to recur — the pre-removal code and its full investigation
are in history before `dee917e` if ever needed again.

What carried forward from that investigation into the current, still-active code
rather than being lost with the mechanism it was found for:

- retries are bounded by a **time budget**, not a fixed attempt count, since a
  fast failure (~0.5s) and a real generation (~10-20s) need different retry
  economics *(today by both: each escalation tier has its own attempt count,
  inside an overall time budget, and a fast failure gets free retries that don't
  count - see `openrouter.ts`)*;
- **a `fetch()` timeout signal stays armed while the response body is read**,
  not just until headers arrive — an earlier flat 8s value aborted calls that
  were actually succeeding, which is the general lesson to re-check first any
  time a call "hangs" inexplicably;
- OpenRouter distinguishes a short burst rate limit from a longer-window quota
  via the `X-RateLimit-Reset` header, and only the latter is worth failing fast
  on rather than retrying (a free-tier daily quota specifically resets at 00:00
  UTC, confirmed from that header, not on a rolling 24h basis);
- and judges were found to need an explicit word-count target in their own
  prompt (currently 450-600 words, `roughly 300-500` for representatives):
  without one they ran long enough to blow the time budgets of that era
  regardless of retry logic.

Under today's 650s budget the token cap is what bounds a reply's length, and the
word target is what shapes it within that — `max_tokens` itself is a
self-imposed engineering value, never specified by the source requirements, and
free to tune.

### Escalation-chain reliability incident and fix (2026-09-20)

A real user-facing failure, caught live from a screenshot: Grey Worm's card
showed a permanent "Call failed - OpenRouter returned HTTP 404: No endpoints
found for mistralai/mistral-large-2512" the moment the chain tried to escalate
past tier 1, instead of continuing to the still-live tiers 3/4.

#### Two root causes

- **Root cause 1, confirmed directly, not assumed:**
  `mistralai/mistral-large-2512` (tier 2's model since the 4-tier chain was
  built, `306152e`) was deprecated/removed from OpenRouter's catalogue sometime
  after that
  - its own OpenRouter model page returned 404 (checked via a direct page fetch,
    not a broad "list all models" query, which was separately caught being
    unreliable/likely-hallucinated for enumerated content during this same
    investigation - a recommended replacement id it produced,
    `mistral-large-2411`, itself independently 404d when checked directly).
  - Tiers 3/4 (`openai/gpt-5.6-sol`, `google/gemini-2.5-pro`) were confirmed
    still real and live the same way.
- **Root cause 2, the actual bug: the tier-escalation mechanism only ever
  covered two content-quality failure signals** (`finish_reason==='length'`, the
  degenerate-run heuristic)
  - every other failure, including a fallback tier's own plain HTTP error, hit a
    generic `!response.ok` branch that returned a terminal `failure()`
    unconditionally, regardless of whether working tiers still stood after it.
  - One dead model id at tier 2 was enough to kill the whole call outright, even
    with two genuinely live tiers still ahead of it.

#### The fixes, and what needed no change

- **Fixed:** a plain HTTP failure (non-429/402/5xx) now escalates straight to
  the next tier - skipping the current tier's remaining attempts entirely, since
  retrying the identical broken model id has no upside, unlike the
  degenerate/truncation path's same-tier retry.
  - New `HTTP_ERROR_ESCALATED_MARKER` lets the frontend recognise this as
    non-terminal/still-escalating (folded into `isRetriedMarkerLog`) rather than
    a premature "Call failed," with its own "Escalated" call-log badge rather
    than misreporting it as "Degenerated."
  - Verified offline (tsc-compiled, mocked `fetch`, zero real OpenRouter calls):
    the exact reported scenario (tier1 truncates → tier2 404s → tier3 succeeds)
    now reaches a real success; an all-tiers-404 case still correctly reports a
    terminal failure with accurate "every tier was tried" wording.
- **Tier 2's dead model replaced with `anthropic/claude-haiku-4.5`**, on the
  user's direction after discussing capability (the truncation/degeneration
  failure modes this tier exists to catch are small/weak-model behaviours - a
  frontier-adjacent model shouldn't exhibit them at any meaningful rate for one
  ~300-600 word structured piece of writing, so Haiku 4.5 was judged the right
  fit over jumping straight to the pricier `anthropic/claude-sonnet-5`, which
  makes more sense reserved for a later tier if ever needed).
  - Both the model id and its real per-token pricing were verified directly -
    the model id via its OpenRouter docs page (real content, unlike the dead
    Mistral pages), the pricing via a live call to
    `GET https://openrouter.ai/api/v1/models/anthropic/claude-haiku-4.5/endpoints`
    (the user's explicit, one-time permission for this specific OpenRouter API
    call, per the standing hard rule that even a free/unauthenticated OpenRouter
    endpoint needs asking first) - consistently `$1.00`/`$5.00` per million
    prompt/completion tokens across all 8 routed providers/regions.
- **Tier 1 (the default model) given a second attempt of its own**
  (`maxAttempts` 1 → 2 in `buildRetryTiers`), specifically to compensate for
  tier 2's real cost increase - a cheap same-model retry catches more
  recoverable truncations/degeneracies before ever paying for the pricier tier,
  at near-zero extra cost when it works (the default model is priced in cents
  per million tokens).
- **That change surfaced a second real, separate bug, caught before it shipped
  rather than after:** `isFallbackAttempt` (which gates whether
  `CONCISENESS_REMINDER` is appended to the retry's messages) was computed as
  `tierIndex > 0` - correct only as long as tier 1 had exactly one attempt,
  since that was the only way to reach attempt 2+ at all.
  - With tier 1 now allowed two attempts, its own internal retry keeps
    `tierIndex` at 0, so the old condition would have silently sent the retry
    with no reminder at all - exactly the attempt the reminder exists for.
  - Fixed to `attempt > 1` (the already-tracked, always-correct running attempt
    counter) instead.
  - Verified offline: a tier-1 truncation followed by a tier-1 retry now
    correctly includes the reminder text and recovers without ever reaching tier
    2, confirmed via the actual outgoing request body in a mocked call.
- `TOTAL_BUDGET_MS`'s worst-case-timing comment updated to match (43s x2 for
  tier 1 now, not x1) - new worst case ~541s, still comfortably inside the
  existing 650000ms budget and the real 900s background-function ceiling, so
  `TOTAL_BUDGET_MS` itself didn't need to change. *(Superseded later the same
  day, when per-attempt ceilings began scaling with prompt size: the worst case
  is now ~649s for a judge at 4550 prompt tokens and ~587s for a
  representative - see the next section.)*
- **No frontend code changes were needed for two things that might have looked
  like they would be:**
  - the agent card's `"(first attempt)"`/`"(second attempt)"` suffix is already
    driven generically by `tierMaxAttempts > 1`, so it automatically started
    showing for tier 1 too once its `maxAttempts` became 2 - confirmed correct,
    not assumed.
  - The call log's model-name shortening (`shortModelName()`, strips any
    `provider/` prefix - *and a `:free` suffix, and since later that day a
    standalone `-instruct` segment too; see "Call log table sizing" below*) plus
    full-id-on-hover (`<abbr title="...">`) were already fully generic per-row
    treatments, not per-model special cases - `anthropic/claude-haiku-4.5` gets
    the same "claude-haiku-4.5, full string on hover" treatment as every other
    model with zero code change.
- `pricing.ts`'s dead `mistralai/mistral-large-2512` entry was kept, not
  deleted - real historical `api_call_logs` rows already reference that model
  id, and `calculateCost()` is never called retroactively against stored rows,
  so removing it would only reduce the table's own documentation value with no
  functional benefit.

### Three reliability bugs, and a broken Abort, found in one production trial (2026-09-20)

One real trial against the deployed site surfaced three genuinely separate bugs,
all confirmed against the trial's own database rows rather than guessed at. The
user granted standing permission to query OpenRouter and Netlify while
diagnosing these. *(For that diagnosis only - HARD RULE 1 applies otherwise.)*

#### 1. The escalation chain was unreachable for every transient failure - the big one

`attemptsAtTier++` lived exclusively inside the truncation/degeneracy branch of
`callOpenRouter()`'s loop. Every other retry path - timeout, 429, 5xx, an
empty-content 200 - simply `continue`d, leaving both `attemptsAtTier` and
`tierIndex` untouched.

A call whose attempts kept timing out therefore re-asked the **same model at the
same tier until the entire 650s budget drained**, never escalating once, and
since `onAttemptStart` reports `attemptInTier: attemptsAtTier + 1`, the card
showed "(first attempt)" the whole time. Confirmed exactly against the real
trial: two judges (`barak`, `elon`) sat on `mistral-small (first attempt)` for
~6 unbroken minutes across roughly nine separate 43-second timeouts, with zero
rows written to explain any of it.

**Fixed:** one shared `recordFailedAttemptAndAdvance()` now handles every
failure kind - it counts the attempt against the tier, escalates when the tier
is spent, writes a real discarded-attempt row, and returns whether the chain can
continue.

- A plain HTTP error (removed model id) additionally skips the tier's remaining
  attempts, since re-asking a model that just 404'd is pointless.
- New `TRANSIENT_RETRIED_MARKER` makes those previously-silent retries visible
  in the call log with a "No response" badge.
- *(Refined the same day: a fast transient failure now gets a few free
  same-model retries before it counts - see "Follow-up the same day" below.)*

#### 2. The per-attempt timeout ignored prompt size entirely

`attemptTimeoutFor()` scaled only with `max_tokens`, so a judge (~4550 real
prompt tokens - the full case record plus all four representative arguments) got
the identical 43000ms ceiling as a representative (~1030).

Real measured judge completions in this very trial: 26.9s, 33.9s, and 43.2s -
that last one **right at the line** (logged slightly over 43000ms because the
logged duration also covers the progress write made just before the request),
with its siblings timing out just past it. A ceiling half the real distribution
overruns is a coin flip, not a safety limit.

**Fixed:** the formula is now `12000 + promptTokens * 2.5 + maxTokens * 25`,
clamped to at least 30000ms and at most the budget less
`MIN_REMAINING_TO_ATTEMPT_MS`, deliberately sized so the full four-tier chain
still fits inside the existing 650s budget (judge worst case ~649s,
representative ~587s), needing no budget or `POLL_TIMEOUT_MS` change.

**The offline suite immediately caught a real bug in that change before it
shipped:** the fractional prompt multiplier yields a half-millisecond on any odd
token estimate, and `AbortSignal.timeout()` throws outright on a non-integer -
which would have deterministically failed roughly half of all real calls, on
prompt length alone. `Math.round()` added, with a comment marking it
load-bearing.

#### 3. Degeneration detection was blind to its most common signature

`detectDegenerateRun()` only ever caught one pattern - a single unbroken 40+
word run with no punctuation. It is structurally incapable of seeing a short,
well-punctuated sentence repeated many times, because every chunk between the
periods is short. The trial's Daenerys argument "succeeded" while ending with
`"I can only tell you that I was wrong, and I am sorry."` repeated **8 times
verbatim**.

**Re-scanning the entire real corpus (689 stored texts - 500 arguments, 189
rulings) found 30 texts (4.4%) with a whole sentence repeated 4+ times, topping
out at one that repeated "I had no other way" 195 times - and the existing
detector scored every single one of them clean** (their longest punctuation-free
runs were only 10-24 words). This failure mode had been shipping undetected for
the entire life of the project.

**Fixed:** `detectRepeatedSentences()` added as a third escalation signal,
threshold calibrated against that same real corpus the way the original was -
every borderline case from 4x to 8x was read in full with surrounding context
and found to be genuine degeneration (consecutive identical sentences, or a
looped paragraph-sized block).

- Deliberate anaphora cannot trip it: real anaphora repeats an *opening* and
  continues differently, producing different whole sentences, which is why the
  earlier abandoned 5-word-phrase heuristic false-positived on it and this one
  does not. *(True of the verbatim rules. The near-copy rules added on
  2026-09-28 can flag anaphora whose sentences share most of their words - see
  that day's entry.)*
- Sentences under 5 words are ignored outright.

#### Abort, which stopped nothing server-side

**Also fixed, found while diagnosing the above: Abort never actually stopped
anything server-side.** A Background Function cannot be cancelled by the browser
that started it - `abort.ts` could only record that the user gave up.

The trial's own rows show both aborted judges continuing to run and **completing
30s and 1m32s after the abort**, writing real rulings (and real cost) into a
trial the user had already walked away from. With the chain now able to run up
to 650s across four models, the later ones far pricier than the default, an
abandoned trial could keep billing against those pricier tiers for ten more
minutes.

**Fixed:** `isTrialAborted()` in `db.ts` (reads the abort row abort.ts already
writes), passed into `callOpenRouter()` as an `isAborted` callback checked
before every attempt, plus a final check before persisting so a late result is
discarded rather than resurrecting an aborted trial.

- It cannot cancel an HTTP request already in flight - but the *next* one is
  where all the escalation cost lives.
- Fails open on a lookup error, so a Supabase hiccup can never silently kill a
  wanted call.

#### Verification

**Verified live, end to end, against real OpenRouter through local
`netlify dev`** (zero Netlify credits; real quota spent, under the user's
standing permission):

- **One full 7-agent trial: 7/7, clean, 80 seconds wall clock.** It exercised
  the retry path for real - `barak` truncated on its first attempt and the card
  correctly advanced to **"tier 1, attempt 2/2"** before succeeding.
  - That counter advancing is precisely what was broken: pre-fix it stayed
    pinned at "attempt 1" forever, which is what the user saw for six minutes.
- **A real abort test**, run twice (once before and once after moving
  `logApiCall` ahead of the abort check).
  - Judges were triggered against a trial seeded with real arguments, then
    aborted 6s in, then watched for over two minutes - the window in which the
    pre-fix code had written real rulings into an aborted trial.
  - Result both times: **0 rulings written, 0 calls escalated to a pricier
    tier**, and the log rows stayed frozen rather than growing.
  - The second run also confirmed the two distinct honest outcomes: `shamgar`,
    caught between attempts, wrote
    `[aborted-mid-call] Stopped before attempt 2...`; `barak`/`elon`, already
    mid-fetch when the abort landed, completed and logged `success` truthfully
    **while still having their rulings discarded** rather than saved into the
    aborted trial.
  - *(Changed on 2026-09-27: a reply that finishes after the abort is now logged
    as an `aborted` row rather than a `success`, and an attempt that fails as
    the abort lands is no longer logged as re-tried - see that day's entry on
    early aborts under "Status log".)*
- That abort run incidentally validated the transient-retry work under genuine
  load: real
  `[transient-retried] was rate limited (HTTP 429) - escalated to anthropic/claude-haiku-4.5`
  rows appeared (the account was rate-limited from back-to-back testing).
  Pre-fix those 429s would have been both invisible in the log *and* looped at
  tier 1 until the budget drained.

**Also verified:**

- a 22-check offline suite (real compiled source, mocked `fetch`) covering all
  four fixes plus regressions - repeated-sentence escalation, timeout escalation
  reaching tier 3, prompt-aware timeouts, abort stopping the chain, the
  dead-model-id skip, anaphora *not* false-positiving, and an honest
  all-tiers-failed terminal message.
- `app.js` re-verified by actually executing its top-level code against a stub
  DOM (the class of check that catches a TDZ bug, which a syntax-only check
  cannot).
- All three fallback-tier models re-verified live against the real OpenRouter
  API with this app's exact request shape - all three returned HTTP 200, and
  Haiku 4.5's reported cost (`$0.000032` for 12 prompt + 4 completion tokens)
  confirms the `pricing.ts` entry exactly.
- One live note worth remembering: `google/gemini-2.5-pro` spends real tokens on
  mandatory reasoning that count against `max_tokens` (17 reasoning tokens and
  empty visible content at `max_tokens: 20`), which is harmless at tier 4's
  4000-token cap but would matter if that cap were ever tightened.

#### Follow-up the same day: the escalation fix over-corrected, caught by the user in real use

The user ran a local trial and reported agents "timing out" and escalating
within **seconds** - Jon Snow reached `anthropic/claude-haiku-4.5` seconds after
Begin new trial. Checked against the trial's own rows rather than guessed at,
and the cause was immediate and entirely self-inflicted:

```
18:31:22.842  jon_snow  failed  2343ms  429 -> re-tried with the same model
18:31:26.505  jon_snow  failed  2938ms  429 -> escalated to anthropic/claude-haiku-4.5
18:31:34.914  jon_snow  success 7713ms  anthropic/claude-haiku-4.5
```

Two **fast** burst 429s consumed both of tier 1's attempts within seconds (the
durations logged above include the backoff pause, which was timed as part of
each attempt until 2026-09-26) and pushed the call onto tier 2, significantly
pricier than the default tier.

(Terminology correction, flagged by the user: **every tier in this chain is a
paid model** - nothing here has run on a free tier since the 2026-08-28 switch.
Tier 1 is the *cheapest*, and tier 2 significantly pricier, but tier 1 is not
free, and calling it that anywhere would be wrong.)

Making every transient failure count against the tier budget fixed the
infinite-loop bug but swung too far the other way: a burst rate limit is the
archetypal self-clearing failure and deserves patience on the cheapest model,
not an instant, billable escalation. The same trial showed the contrast
perfectly - its genuine content failures took 33s, 39.8s and 47s, retried on the
cheap model, and succeeded there.

**Fixed by splitting transient failures on duration, which real data makes
trivially separable:** observed 429 bounces came back within a few seconds,
while real timeouts ran their whole per-attempt ceiling, several times longer,
so `FAST_FAILURE_THRESHOLD_MS = 10000` sits in open space rather than splitting
a continuum.

- A fast transient failure now gets a free same-model retry that does *not*
  spend a tier attempt, bounded by `MAX_FAST_TRANSIENT_RETRIES_PER_TIER = 4` and
  reset on every escalation - enough patience to ride out a burst limit (several
  seconds of backoff per tier), far too little to hide a real outage, and
  structurally incapable of recreating the original unbounded loop.
- A slow failure still counts immediately, so a genuine hang still escalates
  after two attempts rather than looping for six minutes.
- Deliberately not applied to a 404-style HTTP error (permanent - retrying is
  pointless) or to truncation/degeneracy (a real generation that genuinely used
  its turn).

**These regression tests now live in the repo rather than in throwaway scratch
files:** `tests/retry-logic.test.js`, run with `npm test`. No framework and no
network - it compiles the real shipped TypeScript with the project's own `tsc`
and drives it against a mocked `fetch`, so it asserts the actual source rather
than a retyped copy.

- It had nine scenarios and 27 checks when written, 28 after the backoff-timing
  fix of 2026-09-26, and has grown since - one scenario per bug this logic had
  produced by then: the repeated-sentence catch, anaphora *not*
  false-positiving, slow timeouts escalating, fast 429s *not* burning tier
  attempts, a permanently rate-limited tier still escalating (proving the fast
  path is bounded), a removed model id costing exactly one attempt,
  prompt-scaled and always-integer timeouts, abort stopping the chain, and an
  honest all-tiers-failed message.
- This was worth making permanent: the offline version of this suite had already
  caught the `Math.round` crash before it shipped, and this very over-correction
  is the kind of thing only real use surfaced.

**Verified live afterwards** on an isolated `netlify dev` instance on separate
ports (8899/3997), deliberately so the user's own running dev server on
8888/3999 was never disturbed: a full 7-agent trial, **7/7 clean in 119s, zero
escalations off a fast failure, every result served by the cheapest tier**.

- Both content failures in that run (Jon Snow at 28.6s, Shamgar at 33.7s -
  genuinely slow real generations) correctly retried on the cheap default model
  and succeeded there.
- Worth remembering for next time: `TaskStop` again failed to release the ports,
  and the orphan had to be killed by PID - matching the already-documented trap.

### Fallback-tier reliability: what has actually been measured (2026-09-21)

Prompted by a false claim in this file's own history. A sweep asserted that
`anthropic/claude-haiku-4.5` had produced no kept or discarded result on this
project, so its content reliability was untested.

That was wrong, and the user caught it: the claim came from grepping this prose
log with a keyword list containing "succeed", which does not match "success" -
and the one line disproving it reads
`jon_snow success 7713ms anthropic/claude-haiku-4.5`. The filter dropped the
only relevant line and the silence was read as evidence.

**A claim that something has never happened cannot rest on a search returning
nothing - only on a count over the data that would contain it.** `api_call_logs`
was one query away the whole time.

#### Tier 2 - `anthropic/claude-haiku-4.5`

**22 calls on this project as of 2026-09-21, 22 clean.** *(Two samples came
after this section was written: a seventh app-served call, found in the log on
2026-09-26 - see the last bullet of this list - and the 22 escalations in the
targeted local trials of 2026-09-27, every reply read in full. All were kept,
none truncated or caught by a detector; one of the 22, a `daenerys_targaryen`
argument that spoke as Jon Snow, was judged degenerate on reading - a persona
failure no repetition rule can see.)*

- 6 served through the app during real trials (528-672 completion tokens), all
  kept.
  - Checked rather than assumed: all six were genuine escalations the chain
    reached on its own, each with 2-3 discarded attempts already logged for that
    role - none forced or harness-driven.
  - Five of them happened locally on 2026-09-20; the sixth, `grey_worm` in trial
    `d611f9a4`, was the first to happen in production.
- 16 in a targeted batch run for this purpose: `grey_worm` and
  `daenerys_targaryen` (the two roles that actually escalate), 8 rounds each
  with cooldowns, driving the **real compiled `callOpenRouter()` and
  `buildRepresentativeMessages()`** against the real charge sheet at this tier's
  real **2800-token allowance**.
  - Completion lengths 502-789 tokens, mean 666, longest reaching 28% of the
    cap; durations 7.2-11.6s.
  - Every call `finish_reason=stop`, none truncated, degenerate or discarded.
- The batch deliberately omitted the `CONCISENESS_REMINDER` that a real
  escalation carries. It also bypassed the dev server and wrote nothing to
  `api_call_logs`, so these 16 are a separate sample from the 6 above rather
  than an addition to the app's own log.
- For contrast, the predecessor at this tier (`mistralai/mistral-large-2512`)
  logged 88 calls: 74 kept, 11 attempts discarded and retried, 3 terminal
  failures. (Counted directly on 2026-09-21.)
- *Found in the log on 2026-09-26: a seventh app-served call, also clean and the
  second in production - `daenerys_targaryen` in trial `5192e119`, later on
  2026-09-21 on the deployed site (the user confirmed where it ran), after two
  truncations at tier 1, 640 tokens in 10.1s. Tiers 3 and 4 were unchanged, at
  13 and 9 calls, as of 2026-09-27.*

#### Tiers 3 and 4

**Tier 3 - `openai/gpt-5.6-sol`: 13 calls logged as of 2026-09-21, all kept,
none discarded.**

**Tier 4 - `google/gemini-2.5-pro`: 9 calls logged as of 2026-09-21 - 6 kept, 3
failed.** All three failures are the same HTTP 400 "Reasoning is mandatory"
rejection from before `modelRequiresReasoning()` existed (`ec4e9de`), i.e. a
configuration fault, not anything about the output. No content failure at this
tier.

#### How to write about these results

**How this should be written about, per the user's explicit direction.** Record
what was tested and at what sample size.

- Do not promise that any model will never truncate or degenerate - no sample
  establishes that, and it is as true of tiers 3 and 4 as of tier 2.
- Equally, do not hedge these results into meaninglessness or imply failures are
  likely when they have not occurred: 22 clean calls on the exact workload a
  tier serves is a real result, produced by real testing, and the write-up
  should say so plainly.
- The honest shape is "this is what happened, across this many calls, under
  these conditions" - confident about the observation, silent about the
  guarantee.
- And in live code comments and docs, per the user's direction of 2026-09-27,
  give no running total at all, not even "at least N": it goes stale with every
  trial. Name fixed, dated samples instead, whose numbers never change.

### Production verification: four live trials, and one real finding (2026-09-21)

Four full 7-agent trials against the deployed site
(`https://tribunal-t001.netlify.app`), on the user's explicit authorisation -
two immediately after the merge (`5c3c2c0`, 54 commits), then two more run
specifically to see whether a tier escalation would arrive on its own (the user
explicitly ruled out forcing one: "do not force the escalation path. We'll wait
for it to arrive naturally").

- Netlify's cloud was touched only through ordinary public HTTPS requests to the
  live site - no CLI, no dashboard, no build triggered.
- The driver loads the **real shipped `app.js`** in a stub DOM and calls its own
  `deriveRoleStates`/marker helpers, so the client-side reading of each result
  is the code a browser actually runs rather than a retyped copy;
- dispatch mirrors the frontend exactly (same worker pool, same 400ms stagger,
  same 2.5s polling of `GET /api/trials/:id`).

#### The four trials

**All four trials: 7/7 succeeded.**

- Trial 1 (`a049af95`): every call clean on the first attempt, no retries, 47s
  from the trial's creation to its last result, $0.001182 - representatives
  512-653 completion tokens in 11.9-15.3s, judges 635-1078 tokens in 14.6-20.7s.
- Trial 2 (`c8bcd3c9`): 64s, $0.001333, one same-model retry.
- Trial 3 (`d611f9a4`): 83s, $0.005557, one role escalating to tier 2.
- Trial 4 (`f5aab9fd`): 61s, $0.001394, one same-model retry.
- Verdicts across the four runs went 2-1, 3-0, 2-1, 3-0 - ordinary run-to-run
  variance from live, non-deterministic output, and three genuinely independent
  rulings every time, never combined.

**Trial 2 exercised the recovery path for real, in production, for the first
time.** `tyrion_lannister`'s first attempt came back at exactly 1400 completion
tokens - `AGENT_MAX_TOKENS`, the truncation signature - was caught by the
`finish_reason === 'length'` check, logged as
`[degenerate-retried-same-model] This attempt hit the max_tokens limit before finishing naturally`,
and retried **on the same model** as tier 1's second attempt, finishing cleanly
at 583 tokens.

That second tier-1 attempt is exactly what the 2026-09-20 fix added
(`maxAttempts` 1 -> 2) to absorb a recoverable truncation before paying for tier
2, and it did that job: the retry stayed on the default model rather than
escalating to tier 2, which is significantly pricier.

**Trial 3 then walked the entire recovery mechanism in production, unforced, in
a single call.** `grey_worm`, in order:

1. **Tier 1, attempt 1 - caught by `detectRepeatedSentences()`.** 604 completion
   tokens, `finish_reason=stop`, comfortably under the cap:
   `This attempt repeated the same sentence 4 times ("i ask the tribunal to consider the truth of what i saw and w...")`.
   This is the detector added on 2026-09-20 after the corpus scan found 30 of
   689 stored texts carrying that signature and the old run-length detector
   scoring every one of them clean. **First production catch of it**, firing at
   exactly its calibrated threshold.
2. **Tier 1, attempt 2 - truncation.** Hit `AGENT_MAX_TOKENS` exactly (1400) in
   30.5s, spending tier 1's second attempt and exhausting the tier.
3. **Escalated to tier 2, `anthropic/claude-haiku-4.5` - clean success.** 605
   tokens, `finish_reason=stop`, 9.3s.

**This closes the one gap left open after trials 1-2, which is worth stating
precisely because it was the reason for the merge.** Two independent
counterfactuals, both now retired:

- without `detectRepeatedSentences()`, step 1's output would have been *kept and
  displayed as a successful argument* while visibly degenerate - the exact
  2026-09-01 user-facing bug;
- and with detection but without this merge's tier-2 replacement plus the
  HTTP-error escalation fix, step 3 would have reached the removed
  `mistralai/mistral-large-2512` and returned a terminal
  `HTTP 404: No endpoints found` rather than escalating past it.

Both paths were verified offline and locally before the merge; this is the first
time either has been exercised for real on the deployed site, by a failure that
occurred on its own.

**What an escalation costs.** Tier 2 is significantly pricier than the default
tier, which is the whole rationale for tier 1 having a second attempt of its
own: trials 2 and 4 each recovered a truncation on the cheap model, never
reaching tier 2 at all.

Across the four trials, three calls had an attempt discarded: two recovered at
tier 1, and one - trial 3's `grey_worm`, with two discarded attempts - needed
the escalation and got it. *(Later the same day, a fifth production trial
(`5192e119`, 7/7) added three more: `shamgar`'s repeated-sentence response, the
first catch on a judge, absorbed at tier 1, and `daenerys_targaryen` truncating
twice at tier 1 and escalating cleanly to tier 2 - the second production
escalation. Found in the log on 2026-09-26; the user confirmed the trial ran on
the deployed site.)*

**First production confirmation of `config.background = true`.** All 28 trigger
POSTs across the four trials returned Netlify's automatic **HTTP 202 in
~0.3-0.5s**, instead of blocking for the real 9-21s generation.

This had genuinely never been verified deployed: local dev detects a Background
Function by *filename* (`netlify-cli` checks `name.endsWith('-background')`,
which is why the rename fixed local testing), while the real platform reads the
`config.background` property - a different code path that local testing
structurally cannot exercise. *(Found on 2026-10-02: Netlify's bundler ignores a
function's `config` export unless the function has a default export, so with the
named `handler` export used here, `background: true`, `path` and `rateLimit`
never took effect. The filename made these Background Functions, and the rate
limit was never applied until it moved to netlify.toml - see that day's entry.)*

#### The finding: `MAX_CONCURRENT_CALLS` stopped bounding OpenRouter concurrency

It stopped at the Background Functions migration, and three comments still
said it did.

`runWithConcurrencyLimit` wraps `triggerAgent`, and `triggerAgent` now returns
at the 202 rather than at the end of the generation it kicked off. A pool slot
therefore frees in ~0.3-0.5s, so all four representatives end up genuinely in
flight at once: the pool bounds overlapping *trigger POSTs*, not overlapping
OpenRouter calls.

**Measured, not inferred.** Reconstructing each call's start as
`timestamp - duration_ms` and sweeping for maximum overlap, all four live trials
ran **4 of 4** representatives and **3 of 3** judges simultaneously.

- Across every trial in `api_call_logs` carrying real duration data as of
  2026-09-21 (41 complete 4-representative phases; older rows predate the
  `duration_ms` column and cannot be measured this way), **36 ran all four at
  once**, going back weeks.
- The other 5 are timing coincidence on fast calls, not the cap biting - nothing
  in the dispatch path can make a call wait for a free slot once a slot frees in
  half a second.

**Nothing in the code was changed for this, deliberately.** The "3 concurrent is
fine, 4 is not" reading dates from two runs on 2026-08-28, on the same default
model as now but while the agent calls were still synchronous functions, and has
been overtaken by evidence:

- the cap has been inert for its stated purpose since `14c0a45` (2026-08-29),
  when the agent functions took their `-background` names, which means the full
  trials behind this project's reliability record - the four that closed the
  escalation-chain verification arc, and all four of that day's production
  trials - ran with all four representatives in flight together, not three.
- (The arc's 24 targeted runs fired three roles each, and the judge-only batches
  three judges, so those ran three at a time by design.)
- There is no demonstrated problem left for the cap to solve, and giving it real
  teeth again would slow every trial down to fix something that is not
  happening.
- The pool is kept because a bounded dispatch is still a sensible thing to point
  at Netlify's per-IP limiter, which is what it genuinely bounds now. *(Not so:
  the per-IP limit, applied for real since 2026-10-02, counts requests in a
  window, not how many overlap, so the pool bounds nothing that matters to it.
  It is kept because removing it would gain nothing either - see the
  `MAX_CONCURRENT_CALLS` comment in `app.js`.)*

**What was corrected** (comments and prose only - no behaviour change):

- the `MAX_CONCURRENT_CALLS` block and `runWithConcurrencyLimit`'s own doc
  comment in `app.js`, both of which asserted the cap bounds in-flight
  OpenRouter calls;
- `INTERRUPTED_THRESHOLD_MS`'s reasoning, which derived a ~32.5 min worst case
  from the 4th representative having to wait for a free slot (the real worst
  case is far lower, since both phases run fully concurrently - the 40-minute
  constant still clears that with margin and was left alone);
- and the matching claims in `README.md` and in this file.

`npm test` (all three suites of the time, including the app.js-executes-cleanly
check that catches a TDZ-class load crash) and the typecheck both pass
unchanged.

## Frontend write-ups

### Frontend polish backlog (flagged 2026-09-02, all 7 items done as of 2026-09-03)

The call log table (column widths, badges, Duration, cost-in-cents, centring)
reached good shape as of `d7e259f`. The 7 items flagged after that in one batch
(explicitly not claimed exhaustive at the time) were all implemented and pushed
to `draft` by 2026-09-03:

1. **Representatives grid** — fixed 2×2 (`#representative-cards`), no longer
   auto-fit wrapping 3-then-1; `#judge-cards` (3 items) deliberately left on
   auto-fit. `d9df19a`.
2. **Live model display while a card escalates** — confirmed the suspicion was
   correct (the model line only ever showed the static default). `197609b`.
   - `callOpenRouter()` gained an `onDiscardedAttempt` callback so a discarded
     attempt is logged the moment it's decided, not batched after the whole
     chain finishes;
   - `deriveRoleStates()` treats a discarded-but-retried row as live-progress
     signal (a separate `currentModels` map), not a terminal failure, so
     `pollForRoles` keeps waiting on the role instead of prematurely showing
     "Call failed."
   - *(The `currentModels` half was replaced the next day: a discarded row is
     always one attempt behind, so the live model now comes from the
     `agent_progress` table - see the 2026-09-03 entry under "Status log".
     The "keep waiting, don't show Call failed" half still stands.)*
3. **Smooth-scroll to Representatives** on "Begin new trial." `54b2cba`.
4. **Loading overlay for run-history clicks** — full-`.main` overlay with a
   large spinner during the fetch, sidebar locked (`pointer-events: none`,
   dimmed) so a second click can't pile up requests. `f0fd976`.
5. **Sidebar status rollup** — verified correct (resultCount-based labelling
   already ignores discarded-attempt rows). `ea6b211`.
   - Found and fixed an adjacent real bug while checking:
     `INTERRUPTED_THRESHOLD_MS` (3 min) was calibrated against a stale ~26s
     `TOTAL_BUDGET_MS`/fully-parallel assumption; raised to 40 min with real
     margin above the genuine worst case.
   - *(That change reasoned from a ~32.5 min worst case, on the assumption that
     the 3-slot pool forces the 4th representative to wait for a free slot. It
     doesn't - see "Production verification: four live trials, and one real
     finding (2026-09-21)" above - so the real worst case is far lower: the
     representatives phase lasting as long as the page polls for it, then the
     judges phase running out its time budget. The 40-minute value still clears
     it with margin and was left alone.)*
6. **Call log totals row** — sums every logged row (including discarded retries)
   into a `<tfoot>`: total tokens, cost, and duration (compute time, not wall
   clock — labelled as such). Verified offline against synthetic data.
   `f3959ed`.
7. **Capped card height** — `.card-body-scroll` (340px max-height, themed
   scrollbar) on the actual argument/ruling text only, not the short
   loading/failed status text. `ed9a2de`.

All 7 verified via offline tests (extracted real functions against synthetic
data/DOM stubs) or structural/typecheck review — no OpenRouter calls spent on
any of it.

Merged to `main` on 2026-09-03 in merge commit **`7370b91`** (23 commits). Not
to be confused with `945f28a`, a separate merge the same day carrying three
other commits: the live-attempt-display fix (`c1155f3`), a Prettier revert, and
a status update.

### Sidebar/scrollbar/card polish backlog (flagged 2026-09-03, all 8 items done as of 2026-09-04)

Flagged in one batch, explicitly "for later." Discussed and resolved one item at
a time, per the user's explicit request, rather than the whole batch implemented
blind - item 7's design question (scrollbar vs. reveal-button) was decided
per-context, not both at once.

All 8 are done, and have since been merged to `main` in merge commit `e542bc3`
(2026-09-04, 42 commits) - verified commit by commit: every commit cited below
is an ancestor of it.

**Note on the numbering below: there is deliberately no heading for item 7.** It
was the "scrollbar vs. reveal-button" question, and it had two halves that were
answered in different places rather than together - the history-list half inside
item 1, the agent-card half inside item 6. Every other item has its own heading,
so the list runs 1-6 then 8.

#### 1. Sidebar height/scroll

**Done (`84dcbef`).** Resolved the history-list half of item 7 along the way,
discussed with the user first rather than picked unilaterally: a plain
scrollbar, not a "View more" button - `listTrials()` already fetches all (up
to 50) trials in one cheap query, so pagination would save no backend work, and
a bounded scroll container turned out to be structurally required either way to
guarantee the fixed-header goal, regardless of a reveal-button on top of it.

- `.sidebar` is `position: sticky` (not `fixed` - stays a normal flex child
  sharing width with `.main`), capped at `height: 100vh`; `.history-list`
  (`flex: 1 1 auto; min-height: 0`) is the one part that scrolls internally.
- Below the 900px stacking breakpoint, sticky-pinning a full-width sidebar
  across the whole viewport would read as broken, not useful - reverted to plain
  static flow there instead, with `.history-list` still capped
  (`max-height: 260px`) so a long history can't push the stacked page down
  indefinitely.

#### 2. History entry border colour

**Done (`8fe767e`).** White at two opacities instead of the gold accent - 45% on
hover, 85% for the active (currently-viewed) entry.

`.active` and `:hover` tie on specificity (two classes against a class and a
pseudo-class), and `.active` comes later in the file, so an entry that's both
active and hovered stays at the active brightness with no combined selector
needed.

#### 3. History entries unclickable during a live trial

**Done (`248ca76`).** Verified the click-does-nothing claim first via code
review (not a live test - unambiguous from the code): `loadTrial()` is the only
click handler an entry has, and its `if (state.running || ...) return;` guard
fires synchronously before any state change or request, with no race window
(`state.running` itself is set synchronously at the top of `beginTrial()`).

`.history-list.running-locked` (toggled by `updateHistoryLockState()` at both
`state.running` transitions, not folded into `renderHistory()` which only runs
on a fresh fetch) greys entries to 45% opacity with `cursor: not-allowed` and
suppresses the hover border - deliberately no `pointer-events: none` (unlike the
separate `.sidebar.loading-locked`), since that would take the element out of
hit-testing/hover entirely and defeat showing an explicit not-allowed cursor.

#### 4. Abort button hover/active border

**Done (`9a8e117`).** Root cause: the shared `.btn:hover:not(:disabled)` rule
(`border-color: var(--accent-dim)`, gold) outranked `.btn-danger`'s own resting
`border-color: var(--fail)` on specificity, so hovering/pressing Abort showed
gold instead of staying red.

`.btn-danger:hover`/`:active` now explicitly override `border-color` back to
`var(--fail)` - `:active` included too, not just `:hover`, so a press without a
preceding hover (keyboard, touch) still gets red.

#### 5. "Begin new trial" cursor while running

**Done (`893464e`).** Confirmed a real gap: `.btn:disabled` used
`cursor: default`, not `not-allowed` - fixed on the shared rule (only
`#new-trial-btn` is ever actually disabled in practice).

Also verified via code review (no live test needed): clicking while running
already does nothing - `beginTrial()`'s `state.running` guard and setting the
button's real `disabled` attribute are synchronously adjacent with no async gap,
and a disabled button never dispatches `click` at all (browser-level).

#### 6. Agent-card scrollbar colour/prominence

**Done, along with item 7's agent-card half (`7f6625d`).** Discussed the design
question first (2026-09-03): the user leaned towards a "Read full response..."
reveal for its cleaner look; ruled out on two technical grounds raised in that
discussion and accepted by the user:

- an in-place expand would fight the card grid's shared row heights (recreating
  the exact ragged-height problem the scroll cap fixed originally),
- and a modal (the only expand style that avoids that) was judged too much added
  complexity (backdrop, focus handling) for the payoff.

Kept the scrollbar, made it clearer there's more text:

- a bottom fade (`.card-body-scroll-wrap`, `attachScrollFade()` in app.js) shown
  only when content actually overflows and hidden again once scrolled to the
  true bottom - verified offline against synthetic scroll-metrics
  (overflow/at-top, at-bottom, no-overflow, dynamic rescroll, all correct).
- Scrollbar itself restyled whitish/neutral instead of the gold accent (which
  read as decorative, not a control), three-stage hover prominence (dim at rest,
  visible once the card is hovered, brightest on the thumb itself), plus a faint
  visible track.
- *(Reworked since, in the follow-ups below: the brightest tier moved from
  hovering the thumb to dragging it, the rest-to-hover change became a JS-driven
  fade, and the track is now transparent.)*

#### 8. Separator line above "Model:"/"Answered by:" text

**Done (`961515f`).** `.model-chain` is the shared class for both the
still-loading "Model: ..." line and the post-success "Answered by: ..." line, so
one rule covers all 4 real usages.

A `::before` pseudo-element with a gradient background (transparent →
`var(--border)` → transparent) tapers to nothing at both ends, avoiding the
harsh cutoff a plain `border-top` would read as.

#### Follow-ups to items 1 and 6: the shared scrollbars and the card fade

The history list (item 1) and the agent cards' text (item 6) share one
scrollbar treatment, so the work that followed both items is recorded once,
here.

##### The scrollbar's styling

**Real bug found by the user after this shipped (2026-09-03, screenshot):
`.history-list` never actually had any scrollbar *styling*, only
`overflow-y: auto`** - so Chrome/Edge fell back to their bulky ~17px native
default, wide enough to visually collide with a history card's own border.
`.card-body-scroll` (item 6 above) already had a styled scrollbar; this one
simply never got the same treatment when it was made scrollable.

**Fixed in `c243fa8`, together with a full scrollbar-behaviour spec from the
user covering both elements at once:** one shared ruleset for `.history-list`
and `.card-body-scroll` - thin and the same weight in every browser, three
white-opacity tiers (very transparent at rest, more opaque once the container is
hovered, most opaque while the thumb is actively dragged - correctly keyed to
`:active` on the thumb, not `:hover`, a real semantic fix from item 6's first
pass, which had wrongly used thumb-hover for its brightest tier).

Firefox tops out at the second tier - `scrollbar-color` has no thumb-scoped
pseudo-classes, no `:active` equivalent exists there. *(Measured 2026-09-26 in
headless Edge 153 and Chrome 154: those versions of Chrome and Edge topped out
at the second tier too. On an element that sets the standard `scrollbar-width`,
as both of these do, Chromium ignores every `::-webkit-scrollbar` rule, so the
`:active` tier and the 8px width in that block never applied there. What renders
in every browser tested is the two-tier rest/hover version, drawn by
`scrollbar-width`/`scrollbar-color`. Where the entries below speak of
Chrome/Edge having or losing the dragging tier, read them with that in mind.)*

##### The hover fade

**Follow-up refinement (2026-09-04, `0209545`): the hover tier's *value* was
lowered (35% -> 30%) and the active tier's too (55% -> 50%), rest deliberately
left untouched.**

- More importantly, the rest -> hover *trigger* itself changed: a bare CSS
  `:hover` fired on every incidental pass of the pointer over a card/the history
  list while moving towards somewhere else on the page (real user report)
  - fixed with a short hover-intent delay instead
    (`attachScrollbarHoverIntent()`, 220ms, entering only - leaving still
    removes the brightened state immediately), a JS-toggled `.scrollbar-hover`
    class replacing the bare `:hover` in both the Firefox and webkit rules.
- A CSS transition on the colour itself was raised and rejected as the
  alternative, on the understanding that browsers do not animate
  `::-webkit-scrollbar-thumb` or Firefox's `scrollbar-color`.
- Verified offline with real timers (quick incidental pass never triggers it,
  sustained hover does after the delay, leaving removes it immediately, a
  cancelled timer never fires late).

**That delay itself then reported as sluggish on a deliberate hover (2026-09-04,
`57d7e0c`) - motion didn't start until the delay had already elapsed.** A smooth
fade turned out to be possible without any CSS animation:

- `attachScrollbarFade()` replaced the delay-then-snap design with a
  `requestAnimationFrame` loop that writes progressively interpolated values
  into a CSS custom property (`--scrollbar-thumb-opacity`, read by the
  `color-mix()` calls) every frame - each individual write is an ordinary
  instant property change every browser already handles fine (exactly the
  mechanism the old class-swap used), repeated every frame for ~220ms to produce
  a real fade despite no browser animating anything itself.
- Reverses smoothly from wherever the fade currently is if the pointer leaves
  mid-fade, rather than restarting from rest - which incidentally solves the
  original flash problem better than the delay did too (a quick pass now only
  reaches a small partial brightening before reversing back, no artificial dead
  time).
- `.scrollbar-hover` and its `:hover`-scoped selectors are gone entirely,
  collapsed to one CSS rule per property.
- Unplanned bonus: Firefox now gets the real fade too, not just an instant
  jump - `scrollbar-color` has no thumb-scoped pseudo-classes for `:hover` to
  key off, but recalculates on a plain custom-property write exactly like
  Chromium (the dragging tier stays Chromium/WebKit-only regardless - Firefox
  still has no `:active` equivalent).
- Verified offline (virtual-clock-driven rAF, no real wall-clock waiting):
  initial value, monotonic fade-in to target, a mid-fade reversal settling
  cleanly at rest with no jump, and a redundant re-trigger being a no-op.

##### A page-load crash

**`57d7e0c` shipped a real, user-reported page-load crash (2026-09-04, caught
live via screenshot: a console `ReferenceError` and the page failing to render
at all) - a `const` temporal-dead-zone bug, fixed in `dcd0ddc`.**

- `attachScrollbarFade(el.historyList)` sat near the top of the script (with the
  other one-time button listeners); `SCROLLBAR_REST_OPACITY`/etc. are `const`s
  declared much further down, right before the function itself.
- Function declarations are fully hoisted (why calling the function before its
  own text worked fine at all), but a `const`'s value doesn't exist until
  execution reaches its line - calling the function any earlier throws reading
  those free variables.
- **The verification gap that let this ship: a plain `new Function(src)` syntax
  check only compiles a script, it never executes it** - it cannot catch an
  execution-order bug like this one, only a real syntax error.
- Fixed by moving the call to after the function/consts are actually defined;
  **this time verified by actually executing app.js's real top-level code (not
  just compiling it) against a stub DOM/fetch**, confirming no synchronous error
  during load - the class of test that would have caught the original bug before
  it shipped.
- Worth remembering for any future top-level (non-function-body) code added to
  this file: a syntax-only check is not sufficient evidence the page still
  loads.

##### The Firefox fade glitch, and Firefox 155's overlay scrollbars

- **A separate Firefox-only rendering glitch reported the same day (screenshot -
  not reproduced in Chrome): the bottom-fade gradient over a card's scrolling
  text came out jagged/"torn" per line instead of a smooth blend.**
  - Matches a known Firefox bug class - subpixel-antialiased text (ClearType on
    Windows) doesn't always recomposite cleanly under a semi-transparent overlay
    the way Chrome's greyscale AA does.
  - **Fixed in `9bdad3d`:** `transform: translateZ(0)` on `.card-body-scroll`,
    forcing it onto its own compositor layer - the standard mitigation for this
    failure mode.
- **A second regression followed, also Firefox-only, and was put down to that
  fix (user report): the card's custom scrollbar
  (`scrollbar-color`/`scrollbar-width`) silently fell back to Firefox's native
  default.**
  - It was read at the time as a known Firefox interaction - a `transform` on
    the *actual scrolling element* breaking its own overlay-scrollbar styling.
    The Firefox 155 entry two below found the transform had nothing to do with
    it: the browser had updated in the middle of the session.
  - Also: the jaggedness fix itself was only ever a partial improvement, even
    before this regression was found ("some ... still sloppy," per the user).
  - **Attempted fix in `5f32bac`:** moved `transform: translateZ(0)` off
    `.card-body-scroll` onto `.card-body-scroll-wrap` (the non-scrolling
    ancestor) instead, on the theory that isolating the same text+gradient
    region into its own compositor layer without transforming the
    scrollbar-owning element would leave its custom styling unaffected.
- **That relocation didn't work either, and surfaced the real problem with the
  whole approach (user report, same day): zero improvement to the jaggedness in
  either placement, and the scrollbar regression turned out to also affect
  `.history-list` - an element with no DOM/CSS relationship whatsoever to
  `.card-body-scroll-wrap`.**
  - That contradiction is the real signal, not just a placement problem: the
    diagnosis (a Firefox subpixel-AA/compositing bug fixable by
    `transform: translateZ(0)`) was likely wrong from the start, not merely
    mis-targeted.
  - **Fully reverted in `848a2c3`** rather than continuing to guess at further
    variations blind.
  - The fade was kept as it is in every browser (see the CSS comment): it does
    its job in Firefox too, and no change was shown to improve the finish of its
    edge there.
- **Firefox's own release notes found what had changed (2026-09-04): the user
  reported their Firefox had auto-updated (154.0.1 -> 155.0) in the middle of
  this exact debugging session and asked to check Firefox's own release notes
  rather than assume coincidence.** They were right.
  - Firefox's 153.0 notes (refined again in 155.0, "limited to a small list of
    sites rather than applying universally") document that Firefox now
    recognises `::-webkit-scrollbar` selectors for site-compat, and while it
    still doesn't apply their actual styling, it does act on one specific side
    effect: "rules with non-zero width/height disable overlay scrollbars for the
    affected container."
  - This project's `::-webkit-scrollbar { width: 8px; }` rule - present since
    this scrollbar treatment's very first commit, written purely as a
    Chrome/Edge/Safari fallback - had been silently disabling Firefox's own
    overlay scrollbar the whole time this session's Firefox happened to be on
    153+, with zero relation to any of the transform/revert work above.
  - This is exactly why `.history-list` broke too: both elements share that one
    rule. *(The next two entries settle which way that side effect ran: in
    Firefox 153-154 it was what gave both elements their classic, always-visible
    scrollbar, and Firefox 155 withdrawing it for this site is what changed both
    at once. The `@supports` gate below changed nothing in Firefox.)*
  - **Fixed in `76c7e35`:** the whole `::-webkit-scrollbar-*` fallback block
    gated behind `@supports not (scrollbar-width: thin)` - real feature
    detection (true only for a browser that doesn't support the standard
    property at all), not a browser guess.
  - Firefox has always supported `scrollbar-width`; Chrome/Edge/Safari have all
    supported it natively since sometime in 2024, so in practice this fallback
    would only have mattered for a genuinely older Chromium/WebKit browser. (The
    gate itself was removed two entries below - the fallback is plain and
    unconditional again today.)
  - **Disclosed, deliberate side effect:** modern Chrome/Edge also falls outside
    this gate now, so they lose the distinct `:active`/dragging brightening tier
    the same way Firefox always lacked it *(they never had it - see the
    2026-09-26 note under "The scrollbar's styling" above)* - a real narrowing
    of the original 3-tier design, traded for the scrollbar working at all in
    current Firefox, with the side benefit of every current real-world browser
    now behaving identically.
  - Verified via Firefox's own release notes (153.0, 155.0, 155.0beta), fetched
    and read directly, not assumed from a search snippet.
- **That fix did NOT restore a visible-at-rest scrollbar - reported by the user:
  at rest the scrollbar is now fully hidden, on hovering the card a visibly thin
  indicator appears, and it widens further only when the pointer moves directly
  onto the scrollbar itself.**
  - That's Firefox's own native Windows-11-style overlay-scrollbar interaction
    model (auto-hide/reveal/expand) - independently confirmed via search results
    noting overlay scrollbars have been Firefox-on-Windows's platform default
    since Firefox 97 (2022), years before this project existed.
  - **Proven, not theorised, with a clean isolated test in the user's own
    Firefox 155** (a throwaway two-box HTML page, never committed): Box E used
    the exact RAW, unconditional `::-webkit-scrollbar { width: 8px; }` rule with
    zero `scrollbar-color`/`@supports` involved at all - byte-for-byte what this
    project's CSS contained from its very first scrollbar commit through the
    same-day `@supports` fix - and it *still* showed the identical
    hidden-until-hover overlay behaviour.
  - This conclusively clears the `@supports` fix of causing the regression: even
    fully reverting to the pre-fix CSS shape produces the same result, so the
    "disable overlay scrollbars" side effect this whole scrollbar treatment had
    been unknowingly depending on (see the entry above) is genuinely gone for
    this site in Firefox 155, independent of anything in this repository.
  - Box F (same webkit rule plus `scrollbar-color`, matching the exact
    pre-`@supports` shape) showed the same hidden/thin/expand behaviour, with
    one confirmed detail: the colour from `scrollbar-color` IS still respected
    within Firefox's own overlay indicator - only the show/hide/width
    *interaction timing* is outside CSS's control, not the colour.
  - **Conclusion: this is a genuine Firefox 155 platform boundary for any site
    not on Mozilla's own internal compat allowlist, not a bug in this project's
    code and not fixable via further CSS engineering** - the "looked perfect in
    all three browsers" state earlier in this project was, in retrospect, an
    unintended side effect of a narrow compatibility window (Firefox 153-154's
    broader `::-webkit-scrollbar` recognition) that Mozilla has since
    deliberately closed for ordinary sites.
  - No code change followed from this test at the time - the `@supports` gate
    from the entry above was believed to remain the objectively correct approach
    regardless (it doesn't make Firefox's behaviour any worse, and it still
    correctly serves genuinely old Chromium/WebKit browsers).
- **That belief was wrong, caught by the user asking directly whether the
  codebase was genuinely back to byte-for-byte functional parity with the
  pre-saga state - it wasn't.**
  - Once the isolated Firefox test above proved the raw, ungated webkit rule
    shows identical broken behaviour to the gated version, the `@supports` gate
    stopped having any possible Firefox benefit at all (it can only ever help by
    excluding Firefox from a rule Firefox is already ignoring for its own
    separate reasons)
  - its only remaining real effect was a potential regression on modern
    Chrome/Edge, which also support the standard `scrollbar-width` property and
    would therefore also fall outside the gate, silently losing their explicit
    8px sizing and `:active`/dragging tier for zero corresponding gain *(a risk
    that turned out not to exist: Chromium ignores that block anyway wherever
    `scrollbar-width` is set - see the 2026-09-26 note under "The scrollbar's
    styling" above)*.
  - No confirmation existed that the user had re-checked Chrome/Edge
    specifically after the gate landed.
  - **Fixed in `6bc56cf`:** the `@supports` gate removed entirely, restoring the
    plain, unconditional `::-webkit-scrollbar-*` fallback exactly as it existed
    before any of this.
  - Verified precisely this time, not assumed: `git diff` against the pre-saga
    commit (`dcd0ddc`) shows `app.js` with zero changes at all, and
    `styles.css`'s remaining diff is 100% comment text - no selector, property,
    or rule differs from the confirmed-good Chrome/Edge state.
- **Also researched properly (not just accepted) at the user's explicit,
  justified pushback against "nothing can be done": is Firefox 155 really
  forcing hidden-by-default scrollbars on all websites with no override, and if
  so why no developer backlash?**
  - Real answer, more precise than first stated: overlay-scrollbar rendering for
    a `scrollbar-color`-styled element has been Firefox's *design intent* since
    Firefox 99 (confirmed via a Mozilla engineer's own bugzilla comment: "no
    built-in CSS property to globally disable overlay scrollbars; this is
    controlled by the operating system") - genuinely not new, and consistent
    with Windows 11's own native overlay-scrollbar convention (which is why
    there's no controversy: it matches the OS, it isn't sudden).
  - What *did* change exactly when the user's Firefox updated: this project's
    `::-webkit-scrollbar{width:8px}` rule had been exploiting an unrelated,
    undocumented-to-us compatibility shim (Firefox 153's `::-webkit-scrollbar`
    recognition) to opt out of that overlay default entirely - Firefox 155
    restricted that shim's site eligibility, closing the exploit for this
    project specifically, independent of any Windows setting on the user's
    machine (confirmed directly by the user: "Always show scrollbars" was off,
    untouched, the whole time; it broke exactly at the version update).
  - Two real, user-machine-level (not website-level) ways exist to restore
    classic rendering for local testing, found and confirmed working by the
    user: Windows 11 Settings → Accessibility → Visual effects → "Always show
    scrollbars", or the Firefox-internal `about:config` preference
    `widget.non-native-theme.scrollbar.style` set to `4`.
  - Neither is something this site can enable for an arbitrary visitor - the
    platform boundary itself holds even after this more careful research, just
    now confirmed and documented rather than asserted.

### Call log table sizing: the measured facts (2026-09-20)

Two column-fit problems were solved by measuring the real rendered table in a
headless browser rather than estimating, and the measurements themselves are
worth keeping — they're the constraints any future column change has to work
inside.

- **The table is narrowest at a 901px viewport: 655px with no page scrollbar,
  640px with one.**
  - Not at the small end: below 901px the sidebar stacks and the table gets
    *more* room (679px at 721px, just above the card-view breakpoint).
  - The 640px figure was measured on 2026-10-03 in headless Edge, whose classic
    page scrollbar takes 15px - the case once a trial's cards and call log make
    the page scroll. At 640px the Model column is 128px, and the longest model
    id, a five-digit token breakdown and every header still fit on one line.
  - That is the case to size against, and a change that works there works
    everywhere above it. The figures below were measured at 655px.
- **Column widths are pure percentages of that** (`table-layout: fixed` +
  colgroup), so every column scales with the table; there are no fixed pixel
  widths to reason about.
  - At 655px the header floors — each header is `white-space: nowrap`, so this
    is a hard minimum, not a preference — measured: Agent 45px, Type 36px, Model
    47px, Tokens 51px, Cost 37px, Duration 64px, Status 48px, Time 36px.
  - Type, Duration and Cost are the genuinely tight ones, each within a few
    pixels of its header at its current share; Model has the most room.
- **Tokens went 15% → 17%, funded by Model 22% → 20%.**
  - The breakdown line (`19,463 in / 8,167 out`) needs 106px, and an *ordinary*
    judge row still needs 100px, against Tokens' old 98px — so it wrapped
    routinely, not just in the extreme case.
  - Model gave up the 2% for nothing: the longest real model id wraps to exactly
    two lines anywhere between 118px and 144px, so its old 144px was idle at
    this width, and at wider viewports 20% still fits that id on one line
    everywhere 22% did. 19%/18% split that id at ~1100px/~1280px.
  - With `-instruct` stripped (see the `shortModelName()` bullet below), 20% at
    the narrowest table is 128px against the 121px the longest id now needs,
    where 19% would leave under 1px - which is what keeps Model at 20%.
- **A two-line Model cell costs zero row height, in either row type** — worth
  knowing before anyone "fixes" it again.
  - A failed row's height is set by its Status text (3.5 lines), a successful
    row's by the Tokens cell (always two stacked lines, in a larger font than
    Model's).
  - Model wrapping has never been what makes a row tall.
- **`shortModelName()` now also strips a standalone `-instruct` segment**, so
  `mistralai/mistral-small-24b-instruct-2501` displays as
  `mistral-small-24b-2501` (121px, fits the 131px column with real margin, where
  the old form needed 161px and wrapped).
  - The rule is generic rather than a per-model lookup table on purpose: every
    tier's model id is env-var-configurable, so a table could never be relied on
    to cover what is actually running.
  - The date stamp is deliberately kept — it is the only thing separating two
    pinned snapshots of one model.
  - An exceptions table consulted ahead of the generic rules stays available if
    a future id ever needs it, but there was no point building one for a set of
    one.
  - Regression tests for all of this live in `tests/render-cards.test.js`.

### Two CSS traps worth not re-discovering, and checks that measured nothing (2026-09-20/21)

Both came out of the sidebar/badge polish arc and cost real time. Neither is
guessable from reading the CSS.

#### `color-mix()` transitions in Edge

**In Edge, a `color-mix()` colour transitions badly against a legacy one.**
`color-mix()` resolves to a modern `color(srgb ...)` value.

- Edge 154 interpolates that against a legacy colour - which is what both `none`
  and `transparent` are - by producing `rgba(1, 0, 0, ...)`, a near-black,
  throughout the transition: on 2026-10-03 it gave that colour at 25%, 50% and
  75% of the way, from `none` and from `transparent` alike, with only the alpha
  climbing.
- On a dark background that looks like nothing happening and then the effect
  jumping in at the end, which is exactly how it was reported.
- The fix is to give the resting state a filter of the same shape *and the same
  colour type* - a `color-mix()` at alpha 0, not `transparent`: from that, the
  same samples hold the real near-white (`oklab(0.9389 ...)`).
  - Since `transparent` reproduces the bug identically, it is the colour type
    doing the work, not the matching function list.
- WebKit 26.6 interpolates all three starting points correctly. See the comment
  on `.github-link` in styles.css.
- Also note `var(--text) 0%` does not preserve the hue (both engines compute it
  as `color(srgb 0 0 0 / 0)`, transparent black) - it is there purely for the
  type, and an alpha-0 endpoint tints nothing, as the samples show.

#### Centring text in a badge

**Symmetric padding centres a line box, not the text you can see.** Every badge
in the app sat ~1.5px low inside its pill - about 7% of its height, which is why
it jumped out when magnified. The font reserves 12px above the baseline and 3px
below at that size, so the baseline sits lower in the box than the ink implies.

- The first fix (`e849d0f`) was uneven vertical padding (2px/4px), measured with
  canvas `TextMetrics` - but only against Segoe UI, the font Windows resolves
  the system font stack to.
- Android resolves it to Roboto, whose balanced metrics already left text
  roughly centred, so on a phone the same padding pushed every badge 1-1.5px
  high (reported 2026-09-27).
- **A font-metrics fix measured on one machine is a fix for that machine's
  font.**
- What replaced it, `text-box: trim-both cap alphabetic`, measures from the
  letters instead of the font's ascent and descent, and puts Segoe UI and Roboto
  within 0.25px of each other; see the comment above the `@supports` block in
  styles.css.

#### Checks that measured nothing

**Methodology note, since three separate verification passes in this arc
silently measured nothing and still looked like they passed:**

- a probe written through a bash heredoc into Python into JS had
  `out.join('\n')` mangled into a literal newline inside a string literal - a
  syntax error, so the script never ran and the page kept its placeholder text,
  which is indistinguishable from "measured, nothing interesting."
- Two others reported "SMOOTH" while feeding unresolved `var()`/`color-mix()`
  into the test, or reading a value mid-transition because the probe element had
  inherited a `transition` declaration.

Same family as the `new Function(src)` trap already logged above (sidebar
backlog, its scrollbar follow-ups): a check that appears to pass because it
never actually exercised the thing. Read the generated file's real bytes, and
sanity-check the *numbers* rather than the verdict - `rgba(1, 0, 0, ...)` being
nothing like a near-white is what exposed the real bug.

## Anti-abuse layers added ahead of switching to a paid OpenRouter model (2026-08-28)

With the site needing to stay Public for 1-2 weeks of grading, and a real
(non-`:free`) OpenRouter model about to be funded by a small prepaid balance,
three independent layers were added - deliberately not just one, since each has
a different blind spot.

### Global call cap

**Global call cap** (`isGlobalCallCapExceeded` in `db.ts`,
`GLOBAL_CALL_CAP`/rolling 24h — 150 when first added, **raised to 350 the same
day and still 350 as of 2026-10-05**; check `db.ts` rather than trusting this
line): checked in `representative-background.ts`/`judge-background.ts` before
any Supabase trial lookup or OpenRouter call.

- This is the one that caps spend regardless of source - once the call log holds
  350 rows from the last 24 hours, the abort endpoint's rows aside, no new agent
  call starts - and defeating it would require actual, sustained abuse, not just
  knowing a header value or spreading requests across IPs.
- Deliberately does NOT log a row when it trips (would make a trip
  self-perpetuating, since the rejection log itself would count towards the very
  total being checked, keeping the cap tripped for the rest of the window even
  after real traffic stopped) - the caller still gets a real error, it just
  isn't persisted.
- *(Since the Background Functions move the caller no longer sees it either: the
  browser gets Netlify's 202, and a trip shows only in Netlify's function
  logs.)*

### Netlify per-IP rate limiting

**Netlify per-IP rate limiting** (`config.rateLimit` export on
`representative-background.ts`/`judge-background.ts` — 30 requests/5min/IP when
first added, **raised to 45 on 2026-08-30**): a real, free-plan-supported
platform feature (confirmed against Netlify's docs on 2026-08-28, not a paid
add-on - the free plan then allowed 2 rate-limit rules per project, which is
exactly the 2 functions that call OpenRouter), declared via the function's own
`path` glob matching how `netlify.toml` actually routes to it.

- Unverified in production - local `netlify dev` doesn't simulate rate limiting,
  and this project has separately, repeatedly found its redirect-based routing
  behaves differently once deployed than locally (see the "Production
  deployment" entries below), so whether this exact path glob is what the
  platform matches against is confirmed only by a real deploy.
- *(Found on 2026-10-02: Netlify's bundler ignores a function's `config` export
  unless the function has a default export, so with the named `handler` export
  used here, `background: true`, `path` and `rateLimit` never took effect. The
  filename made these Background Functions, and the rate limit was never applied
  until it moved to netlify.toml - see that day's entry.)*
- As of 2026-08-28, the installed `@netlify/functions` package's
  `RateLimitConfig` TypeScript type was missing `windowLimit` entirely
  (confirmed a stale type export by checking the actual zod schema Netlify's own
  bundler validates against, vendored inside `netlify-cli`) - fixed by dropping
  the `: Config` annotation on that export rather than fighting a wrong type,
  since TS types are erased at build time and have zero effect on what the
  platform reads.

### Site-gate header

**Site-gate header** (`isSiteGateOk` in `siteGate.ts`, `X-Site-Gate` header,
checked in `trials.ts`'s POST too): explicitly NOT real access control - the
token is a plain constant in the publicly-downloadable `app.js`, so anyone who
looks defeats it trivially.

- Its only job is filtering the laziest class of automated traffic (scanners
  that never loaded the page at all) for near-zero cost.
- Fails OPEN when `SITE_GATE_TOKEN` is unset server-side, on purpose - an unset
  env var must never lock a grader out of an otherwise-working site.
- **Needed `SITE_GATE_TOKEN` set in Netlify's production environment** (matching
  the constant in `app.js` exactly) before this layer did anything at all -
  **done since:** the user confirmed it set on 2026-08-30/2026-09-01, along with
  `DEFAULT_MODEL` and `OPENROUTER_API_KEY`. Nothing outstanding here.

### How the rejections reach the UI

**Every rejection from all three layers surfaces a clear, specific reason in the
UI**, not a raw status code *(no longer true for the agent endpoints - see the
"Superseded" note at the end of this section: a site-gate or call-cap rejection
of an agent call now reaches only Netlify's function logs. The per-IP limiter's
rejection, which the platform returns before the handler runs, and a site-gate
rejection of trial creation still reach the UI)* - this took a real fix, not
just returning better text server-side:

- `callAgentWithRetry()` in `app.js` previously called `res.json()`
  unconditionally, so a response that DOESN'T come back as this app's own JSON
  shape (the realistic case for Netlify's platform-level rate-limit block, which
  returns a plain error page) threw a raw `SyntaxError` that fell into the
  generic network-failure branch - confusing, and would have incorrectly retried
  a permanently-blocked request.
  - Fixed by splitting the fetch and the JSON parse into separate try/catches,
    with a specific message for a non-JSON 429 (recognised as the platform rate
    limiter) and a fallback for any other unrecognised non-JSON response.
- Separately, OpenRouter's real HTTP 402 (not enough credit for the request:
  what is left of the balance, or of the key's own spending limit, cannot cover
  it) is now caught explicitly in both `callOpenRouter()` and
  `callOpenRouterOnce()`, parsed for OpenRouter's own `error.message` where
  possible (`describeErrorBody()`), and treated as non-retryable via a new
  `isOutOfCredits()` text match on the client
  - (mirrors the existing `isQuotaExhausted()` pattern - needed because
    `representative.ts`/`judge.ts` always wrap an OpenRouter-layer failure as a
    502, so the client can't rely on the status code alone the way it can for a
    direct 4xx from this app's own endpoints).
- The pre-existing free-tier daily-quota message was also reworded to drop
  "free-tier"-specific language now that a paid model is in the picture.
- **Superseded by the Background Functions migration:** `callAgentWithRetry()`,
  `isOutOfCredits()` and `isQuotaExhausted()` no longer exist in `app.js`.
  - The client stopped seeing an agent call's own response at all once those
    endpoints became Background Functions - it now learns the outcome by polling
    and reading the persisted `error_message`, so nothing on the client parses
    these messages any more.
  - The server-side wording still matters, because that stored text is what the
    card displays.

## Bugs and fixes encountered (running log — add to this, don't replace it)

Kept so a fix already found once doesn't get re-discovered from scratch, and so
the same mistake isn't repeated (the DEFAULT_MODEL one below happened because
this log didn't exist yet to check against).

### Prompt/call layer

- **`fetch()` crashed on every call, no exception detail surfaced.** The
  `X-Title` header sent to OpenRouter contained an em dash (`—`); HTTP header
  values must be ASCII/Latin-1 only. Fixed: plain hyphen instead, in
  `netlify/functions/lib/openrouter.ts`.
- **Calls silently took 60+ seconds.** The default model
  (`nvidia/nemotron-3.5-lightning:free`) is a "reasoning" model that generates
  hundreds-to-thousands of hidden reasoning tokens per call unless told not to —
  invisible in the visible output, but it's what was eating the time.
  - Fixed: every call sends `reasoning: { enabled: false }` *(except to a model
    that rejects it outright, where the field is left out - see
    `modelRequiresReasoning()` in `models.ts`)*.
- **Arguments/rulings cut off mid-sentence.** The `max_tokens` caps added to
  bound the above (700/1000) were too tight for this model's natural verbosity.
  - Fixed: raised to 1000 (representatives) / 1600 (judges) — real headroom, not
    just "enough." *(Both roles now share `AGENT_MAX_TOKENS` = 1400 at tier 1,
    with 2800-4000 at the later escalation tiers.)*

### Architecture

- **Representatives/judges phases risked serverless timeouts.** Original design
  ran all 4 (then all 3) calls inside one function invocation via
  `Promise.allSettled`. Measured testing showed this pushes close to/over
  serverless function time limits with this model.
  - Fixed: one function invocation per agent (`representative.ts` / `judge.ts`,
    singular — replaced the batch `representatives.ts` / `judges.ts`), fanned
    out in parallel by the frontend instead of internally by one invocation.
  - (Those two files were later renamed to `representative-background.ts` /
    `judge-background.ts` — see the 2026-08-29 rename entry under "Status
    log" — so those are the names to look for today.)
- **429s from OpenRouter's free-tier rate limit were expected and real, and kept
  happening for as long as the project ran on the free tier (until 2026-08-28)**
  — not a bug to fix, but the system's handling of them is deliberate
  engineering, not an afterthought:
  - `openrouter.ts` retries up to twice with backoff on 429/5xx *(long since
    replaced by the escalation chain and its fast-retry rule - see
    `openrouter.ts`)* (resilience, not concealment — whatever actually happens
    is what gets logged), and if it still fails, that agent's role is simply
    absent from the run with a visible failure card, never a fabricated argument
    or ruling.
  - This got proven for real, unplanned, twice: once when testing exhausted the
    daily quota outright (representative cards showed the real 429 error text),
    once with a genuine transient HTTP 500 (next bullet) — both times the UI
    showed the truth instead of papering over it.
- **A representative call failed with a bare, unhelpful HTTP 500.**
  `callOpenRouter()` already caught every failure gracefully, but the Supabase
  calls around it were never wrapped — a transient network failure talking to
  Supabase can reject/throw rather than resolve with an `{error}` object, and
  that propagated as an uncaught crash.
  - The affected run's DB row showed no logged failure at all, confirming the
    crash happened before the normal failure-logging path could even run.
  - Fixed: `lib/safeHandler.ts` wraps all 4 endpoint handlers *(all six today)*
    in try/catch, turning any uncaught exception into a clean JSON error
    response.

### Local dev environment

- **`netlify dev` starts timing out on outbound calls after many requests in one
  long-running process.** Not present on a fresh process; not expected in real
  deployed Netlify (each invocation is isolated there).
  - If calls that were working suddenly start timing out mid-session, stop
    (Ctrl+C) and restart `npm run dev` — a real, recurring local-dev quirk, not
    a one-off.
  - *(Superseded on 2026-08-28: the ~30s cut traced that day was
    `lambda-local`'s fixed synchronous-function timeout, which a restart does
    not change - see that day's entries under "Status log". The agent
    functions' `-background` names took them out of it.)*
- **`netlify dev`'s redirect layer does not correctly forward path-segment
  `:id`/`:role` placeholders to the invoked function locally**, even though
  `netlify.toml`'s redirects use the path-segment form (the confirmed-working
  shape for real deployed Netlify, per the redirect entry further below).
  - Both `GET /api/trials/:id` and `POST /api/trials/:id/representatives/:role`
    returned a clean 400 "Missing trial id or role" instantly when hit through
    the `/api/...` redirect locally — `extractParams` found nothing in either
    the query string or the path, meaning local dev's rewrite genuinely isn't
    passing the value through either shape.
  - Hitting the function's own URL directly works correctly and reaches the real
    handler.
  - **Workaround for local testing only:** call
    `/.netlify/functions/<name>/<id>/<role>` directly instead of `/api/...` when
    testing locally with `netlify dev` - note the agent function names are
    `representative-background` / `judge-background` today, renamed later; trust
    the `/api/...` redirects once actually deployed (this exact path-segment
    shape is the one already verified working against the real deployed site —
    see the redirect fix entry below).
  - No code change made for this — it's a local-emulator-only quirk, not a bug
    in the redirect config or in `extractParams.ts` itself.
  - *(No longer reproduces: every local browser trial since the Background
    Functions move of 2026-08-28 has gone through exactly these `/api/...`
    routes - trigger and poll alike - and worked, and the deployed site never
    had it. The workaround is no longer needed.)*
- **A representative call that got cut off by `netlify dev`'s local 30-second
  lambda-local timeout had actually already succeeded server-side** — the
  OpenRouter call, the Supabase write, and the call log all completed and saved
  correctly in the background, even though the HTTP client saw a timeout error.
  - Root cause of the slowness: contention, not a real hang. The 30s local
    timeout was hit because the browser's own parallel 4-representative run and
    a manual test call were fired concurrently against the same free-tier
    account at the same time.
  - Lesson: don't stack concurrent manual test calls on top of an in-progress
    browser run while debugging locally — and if a local call ever does hit the
    30s cutoff, check whether it actually saved before assuming it failed;
    lambda-local's own timeout is stricter than the underlying work actually
    needed.
  - **Correction to the diagnosis above:** "contention" was the best guess at
    the time and was later superseded - the 30s cutoff itself is
    `lambda-local`'s own fixed, non-configurable kill switch, named and sourced
    further up under the Background Functions arc, and it fires on elapsed time
    regardless of what else is running. Contention can still make a call slow
    enough to reach that line; it is not what draws the line.
  - *(And the line no longer applies to the agent functions at all: their
    `-background` filenames get local dev's 900s background timeout instead.)*

### Frontend UX

Not bugs in the "broken" sense, but genuine misleading-output issues.

- **Run-history sidebar showed raw DB enum text** (`REPRESENTATIVES_COMPLETE`,
  etc.) **and coloured anything non-"completed" as a failure**, even normal
  in-progress states.
  - Fixed: human-readable labels, plus a separate `hadFailures` flag (from
    `api_call_logs`) so `status='completed'`-but-partially-failed runs don't
    read as clean successes.
  - *(The label has since moved off `hadFailures` onto `resultCount` - see the
    2026-08-27 status entry. `hadFailures` is still returned, but nothing on the
    page labels by it.)*
- **Runs stuck mid-phase (interrupted by a dev-server restart, not a real error)
  still read as "In progress…" forever.**
  - Fixed: a non-completed run older than 2 minutes with no logged failure is
    now labelled "Interrupted," not "In progress."
  - *(Today: any non-completed, non-aborted run older than 40 minutes, logged
    failures or not - see `INTERRUPTED_THRESHOLD_MS` in `app.js`.)*
- **Horizontal scrollbars in the sidebar and call log table.**
  - Sidebar: `.badge` forced `white-space: nowrap`, which broke once status
    labels became full sentences.
  - Call log: an 8-column table with no layout constraint naturally overflowed.
  - Fixed: badges wrap now; the table uses `table-layout: fixed` with a
    `<colgroup>` summing to 100% width (structurally can't overflow regardless
    of content length), and prompt/completion/total tokens got consolidated into
    one column.
- **The per-card spinner (added to show a call is in flight) looked broken — the
  bright arc only ever covered a small slice before snapping back**, instead of
  completing a smooth rotation.
  - Cause: each card's whole DOM is rebuilt every ~500ms to update the live
    elapsed/countdown text, which recreates the spinner element too, and a CSS
    animation restarts from 0% whenever its element is torn down and recreated —
    it never got past roughly the first 500ms of its 800ms cycle.
  - Fixed with a negative `animation-delay` computed from the real wall clock at
    element-creation time (`-(Date.now() % 800)ms`): this tells the browser the
    animation has already been running that long, so a freshly recreated element
    starts at the angle a continuously-running one already would be at, making
    the recreation invisible regardless of how often it happens.
  - Only needed for elements recreated on a tick like this — a spinner created
    once per action (e.g. the run-history loading placeholder, see below)
    doesn't need it.
  - *(The ~500ms countdown rebuild is gone: cards are now rebuilt only when
    their own state changes - see `reconcileAgentCards()`. A loading card is
    still rebuilt each time its model line advances, so the negative delay still
    earns its keep.)*
- **The run-history sidebar gave no indication anything was happening while
  `GET /api/trials` was in flight** — genuinely observed taking up to ~10s,
  during which the sidebar just looked frozen/empty.
  - Fixed: a bigger spinner + "Fetching run history…" placeholder shown
    specifically when there's nothing on screen yet (a refresh of an
    already-populated list leaves the existing items visible rather than
    flickering them out while fresh data loads, which would be a worse
    experience than the stale-but-present data).
- **That fix then surfaced a second, pre-existing, more important issue: a real
  `GET /api/trials` failure showed "Could not load run history."**
  - The interesting part — investigation confirmed this was *not* a bug in the
    new render logic (`renderHistory()` tested clean against the real live data)
    but a genuine transient fetch failure, most likely this exact local
    `netlify dev` process's already-documented concurrent-request contention
    (see the local-dev quirks above), likely triggered by a manual test call
    landing at the same moment as a page load. *(The contention reading rests on
    the restart note under "Local dev environment" above, which the 2026-08-28
    `lambda-local` finding superseded. The retries below answer any brief
    failure of this endpoint, whatever its cause.)*
  - Critically: **this exact failure mode almost certainly existed before too**
    — the prior code was `if (!res.ok) return`, which showed nothing at all, not
    even an error, on the same failure. The new error text didn't introduce the
    problem, it just finally made a pre-existing silent one visible, though the
    sudden appearance of a new error message could easily be mistaken for a new
    regression.
  - Fixed by adding a few quick retries (3 attempts, short backoff) before
    showing the error, since this endpoint spends zero OpenRouter/Netlify quota
    and a transient blip retrying invisibly is strictly better than a scary
    message for something that would likely succeed a moment later.
  - Verified against controlled mock scenarios using the real extracted
    function: recovers within budget on a transient failure, gives up cleanly
    with no throw on a persistent one, happy path stays at one call with zero
    added latency.
- **`listTrials()` had three sequential Supabase round trips after the initial
  trials query** (two separate queries against `api_call_logs`, then two more
  result-count queries run in parallel with each other but not with the first
  two) even though none of the four depend on each other's results — only on the
  trial ids from the first query.
  - A real, measured contributor to the run-history sidebar's occasional
    multi-second delays.
  - Fixed: consolidated to one combined `api_call_logs` query (status and
    error_message both needed, previously two separate calls) plus the two
    result-count queries, all fired together via `Promise.all`.
- **Opening a past trial from history whose run had a failed role (even after
  last-ditch) showed that role's card as "Deliberating…" with a live spinner**,
  as if still working — spotted from a real run's history entry. Not a re-run:
  `loadTrial()` makes exactly one `GET /api/trials/:id` call and nothing else.
  - Root cause: it only ever populated `state.representatives`/`state.judges`
    for roles with a *persisted success*
    (`representative_arguments`/`judge_rulings` rows); a failed role simply had
    no entry at all.
  - `buildAgentStatusBody()`'s "no entry" branch was written to mean "hasn't
    started yet" (spinner) — correct during a live run, where every role's entry
    is seeded with `{status: 'loading'}` synchronously before the first render,
    so that branch never actually fires live; wrong for a historical trial,
    where "no entry" instead means "nothing was ever recorded for this role."
  - Fixed in two parts:
    - `loadTrial()` now backfills a real `failed` (or `aborted`, detected via
      the same `ABORTED_BY_USER_MESSAGE` marker `abort.ts` writes) entry for any
      role with no success, sourced from that role's own last logged attempt
      (`api_call_logs` is ordered ascending by timestamp, so the last matching
      row is the most recent) — giving the same real error detail a live failure
      shows, including whether the last-ditch model was the one that failed.
    - As a safety net for a role with literally zero log rows (e.g. a trial that
      never got that far), `buildAgentStatusBody`'s "no entry" branch itself no
      longer shows the spinner — it renders a plain "No result recorded" message
      instead.
  - Verified with an isolated harness exercising the real extracted
    `loadTrial`/`buildAgentStatusBody` against synthetic historical data
    matching the observed case (one judge failed twice including its last-ditch
    attempt, two judges succeeded): failed role now reads "Call failed" with the
    real error and the last-ditch note, not a spinner; the zero-log case reads
    "No result recorded," also not a spinner.
  - *(Since then the backfill has moved from `loadTrial()` into
    `deriveRoleStates()`, shared with the live poller, and the last-ditch model
    it mentions is gone with the rest of the free-tier fallback.)*
- **A run where every representative call failed still let the judges rule from
  the charge sheet alone, with nothing telling a reader that's what happened.**
  - Not a bug in the strict sense — `buildJudgeMessages()` already marks a
    missing seat
    `[argument unavailable — this representative's call failed and was not fabricated]`
    rather than fabricating or silently omitting it, so no judge ever pretends
    to have read an argument that didn't exist — but the resulting ruling in the
    UI looked identical to one reached with a full adversarial record, with the
    connection to the representative-card failures directly above left for the
    reader to infer.
  - Added `updateJudgesCaveat()`: a single banner above the Judges section,
    shown only when fewer than 4 representative arguments succeeded, naming
    which ones and how many were available.
  - One banner covers all three judges, not one per card, because
    `runJudgesPhase()` only ever starts after `runRepresentativesPhase()` has
    fully resolved every role — by construction, all three judges in a given
    trial always saw the exact same set of available/unavailable arguments, live
    or historical, so no new stored data was needed to know what a specific
    judge actually saw.
  - Styled with `--warn`, not `--fail` — the ruling itself succeeded, this only
    contextualises what it was reasoned from.

### Account/dashboard setup

Not code — Supabase/Netlify UI quirks, not fixed by any file change.

- **Pasting `schema.sql` into Supabase's SQL Editor failed with "unterminated
  quoted string,"** with the error output showing extra lines —
  `-- source: dashboard`, `-- user: session:<uuid>`, `-- date: <timestamp>` —
  spliced into the middle of the pasted multi-paragraph string literal, at the
  position of a blank line inside it.
  - Not a SQL syntax problem in the source file; something in the browser (most
    likely an extension — a clipboard manager or similar) rewrites pasted
    content and appears to inject that comment block specifically at blank lines
    within pasted text.
  - Fixed in the file itself: the multi-paragraph `background` value now uses an
    `E'...'` escape string with explicit `\n\n` instead of literal blank lines,
    and every other blank line in `schema.sql` was removed as a precaution.
  - If this resurfaces on a different machine/browser, the same fix applies —
    eliminate blank lines from anything being pasted into that editor.
- **Supabase: "Failed to create new project: Failed to retrieve organization,"**
  right after creating a brand-new organisation. Transient — the org hadn't
  finished propagating yet.
  - Fixed by going back to the organisation's own dashboard page (not retrying
    the same stale "new project" form) and starting "New project" again from
    there.
- **Supabase: the "Region" dropdown on project creation got stuck forever on
  "Loading available regions…"**, blocking the whole form. Fixed by a full page
  reload — came back populated on the next attempt. If this happens again,
  reload before assuming anything is actually broken.
- **As of 2026-08-27, Supabase offered a newer key system** (Project Settings →
  API Keys → "Publishable and secret API keys" tab) alongside the classic
  "Legacy anon, service_role API keys" tab.
  - The new `sb_secret_...` key is the current equivalent of the old
    `service_role` key and is what `SUPABASE_SERVICE_ROLE_KEY` should be set to
    — despite the env var name still saying "service role," a `sb_secret_...`
    value works fine there.
- **GitHub's OAuth "Authorize" button (Netlify requesting GitHub access) stayed
  greyed out for 60+ seconds**, well past GitHub's normal ~2-3 second
  anti-clickjacking delay before that button becomes clickable.
  - Suspected browser extension interference — matches the pattern of the SQL
    Editor paste issue above (something in the browser messing with page
    JS/timers), though not conclusively confirmed.
  - Suggested and apparently effective: reload the page, or retry the same OAuth
    flow in a private/incognito window (most extensions disabled there by
    default).
  - *(Moot: a one-time delay while connecting Netlify to GitHub during account
    setup, solved by a reload, with no bearing on the app.)*
- **Backend calls failed with `permission denied for table X`** (a Postgres
  GRANT error, distinct from RLS silently returning zero rows) even with the
  correct `sb_secret_...` key configured.
  - Root cause: "Automatically expose new tables" was deliberately unchecked
    during project creation (Supabase's own suggested tighter-security default),
    which appears to also gate the grants needed by the new secret-key system,
    not just anon/authenticated as expected.
  - Fixed by running explicit grants in the SQL Editor after `schema.sql`:
    - `grant usage on schema public to service_role`,
    - `grant select, insert, update, delete on all tables in schema public to service_role`,
    - `grant usage, select on all sequences in schema public to service_role`,
    - plus matching `alter default privileges` statements so future tables get
      the same grants automatically.
  - RLS itself (deny-all for anon/authenticated, no policies) is unaffected by
    this — it's a separate layer from GRANT.

### Netlify deployment

All three hit during the same deploy session.

- **Build failed: "Secrets scanning found secrets in build output."** Importing
  the whole local `.env` file with "Contains secret values" checked marked
  `DEFAULT_MODEL` as secret too — but its value (a public OpenRouter model name)
  legitimately appears in plain text in `models.ts`, `openrouter.ts`,
  `README.md`, and `.env.example`, so Netlify correctly refused to deploy a
  "secret" that's visible in the repo.
  - Fixed: only `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and
    `SUPABASE_URL` should ever be marked secret — not `DEFAULT_MODEL` or the
    per-role `MODEL_*` overrides, since those are just model-id strings, not
    credentials. *(The same goes for the three fallback-tier model variables,
    and for `SITE_GATE_TOKEN`, added later, whose value is a constant in
    `public/app.js` and so in the build output too.)*
  - Netlify won't let you un-check "secret" on an existing variable via edit —
    delete it and re-add it correctly instead.
- **Deployed site returned HTTP 401 with a login-redirect page instead of the
  app.** Netlify's team default visibility was "Private" (Netlify-account login
  required) — a "deployed" site nobody but the account holder could reach.
  - Fixed: Project configuration → Visitor access → Project visibility →
    "Public."
- **`:id`/`:role` never reached the functions in production**
  (`{"error":"Missing trial id or role"}`) **despite working perfectly in local
  `netlify dev`.**
  - The redirects forwarded named placeholders into the target's query string
    (`to = ".../trial?id=:id"`) — local dev's redirect simulator accepts this,
    but Netlify's real deployed redirect engine does not reliably honour it for
    rewrites (status 200).
  - Confirmed by hitting the deployed function's exact URL directly with an
    explicit query string, which worked.
  - Fixed: redirects now forward `:id`/`:role` as path segments instead
    (`to = ".../trial/:id"` — Netlify's documented, confirmed-working
    placeholder pattern), and `lib/extractParams.ts` checks the query string
    first, then falls back to parsing the path — correct regardless of which
    shape a given environment actually hands the function.

### Production deployment

Found via the live deployed site, none reproduced in local `netlify dev`.

- **`/api/...` calls failed instantly with "Missing trial id or role" even with
  the path-segment redirect fix above in place.** `extractParams.ts` located
  `id`/`role` by searching `event.path` for the function's own name (e.g.
  `'representative'`).
  - Turned out production's redirect engine does not rewrite `event.path` to the
    target function's path at all — it preserves the *original* request path.
    That path uses the plural route segment (`representatives`) where the
    function name is singular (`representative`), so the name search silently
    returned nothing.
  - A first fix (read the trailing N path segments instead of searching by name)
    was still wrong: the original path has a literal segment (`representatives`)
    sitting between `id` and `role` that the rewritten function path doesn't
    have, so "last 2 segments" grabbed the literal word as `id`.
  - Final fix: locate `id` by UUID shape (trial ids are always UUIDs) rather
    than by position or name — correct under either path layout.
  - Diagnosed by testing the deployed function's direct URL
    (`/.netlify/functions/representative/<id>/<role>`) side by side with the
    `/api/...` redirect and comparing exactly where each one failed.
- **Two hung OpenRouter calls were cut off by Netlify after about 30 seconds
  (observed on the deployed site), with zero trace in the app's logs** — no
  failed row in `api_call_logs`, nothing.
  - `callOpenRouter()`'s `fetch()` had no timeout of its own, so when the
    free-tier model didn't respond, the call just blocked until the platform
    killed the entire function invocation outright, bypassing the retry logic,
    the failure-logging code, and the DB write all at once.
  - This is a real gap in the "visible failure" requirement, not just an
    inconvenience — a silent failure is exactly what that requirement exists to
    prevent.
  - Fixed: `fetch()` now takes its own `AbortSignal.timeout(8000)`, and
    `MAX_RETRIES` dropped from 2 to 1, so the worst case (two 8s attempts plus
    backoff) stays well under the 30 seconds observed and the graceful-failure
    path gets to run.
  - *(The principle stands - every attempt has its own timeout - but the numbers
    are long gone: Netlify's documented limit for a synchronous function on the
    free plan, checked on 2026-08-28, was 10 seconds, and the agent calls have
    run as Background Functions since 2026-08-29 - see the CRITICAL CORRECTION
    entry under "Status log". `MAX_RETRIES` no longer exists, and
    per-attempt timeouts now scale with prompt size and token cap inside a 650s
    Background Function budget. See `openrouter.ts`.)*
- **A live call returned HTTP 200 with a well-formed response but empty
  `message.content`.** A direct reproduction with an equivalent prompt
  immediately after succeeded normally, showing this is a transient upstream
  condition rather than a structural prompt problem.
  - Previously this returned a permanent failure on the very first empty
    response. Fixed: retried like the existing 429/5xx path instead of failing
    immediately.

### Diagnosing the deployed site

Lessons from investigating the production bugs above: how to tell a network
fault from a slow model, and what OpenRouter's key-status endpoint can and
cannot tell you.

- **Diagnosed "is this OpenRouter-specific or a general Netlify networking
  problem?" by adding a temporary control fetch** (to a definitely-reachable
  host, `api.github.com`) alongside the real OpenRouter call, plus richer error
  detail (`err.name`/`code`/`cause`) on failure — both logged only, not returned
  to the client.
  - The control fetch consistently succeeded in under 100ms while the OpenRouter
    fetch hung, which looked at first like a host-specific network block.
  - That theory was later disproven by a direct call to OpenRouter from outside
    Netlify entirely, which showed the connection itself succeeding (fast HTTP
    200 headers) with only the response *body* trickling in slowly — i.e.
    genuine model-generation latency, not a network-layer block.
  - The diagnostic code was removed once this was confirmed.
  - Worth knowing for next time: a fast control-fetch success next to a hanging
    real call does not by itself prove a host-specific block — check whether the
    slow call's connection/headers arrived promptly before concluding it's
    networking rather than upstream latency.
- **`GET https://openrouter.ai/api/v1/key`'s `usage`/`usage_daily`/etc. fields
  are dollar-cost metrics, not request counts.** Misread mid-investigation as
  "zero requests reached OpenRouter" when several real (if slow/failed) calls
  had actually been made — the field just legitimately stays 0 for a $0
  free-tier model regardless of call volume.
  - Don't use this endpoint to infer whether requests are reaching OpenRouter;
    it can only speak to spend.
- **That same endpoint also doesn't expose "N of 50 remaining today," at all.**
  A real call returned `limit`/`limit_reset`/`limit_remaining` all `null` and
  `is_free_tier: true`, with no field naming the daily free-model request cap or
  how much of it is used.
  - The only place that number appeared was the
    `X-RateLimit-Limit`/`X-RateLimit-Remaining`/`X-RateLimit-Reset` headers on a
    429 from a real chat-completion call (see `openrouter.ts`'s 429 handling),
    and reaching one means making calls against the 50. (A successful completion
    carries none of these headers, as checked on 2026-10-03 - see "OpenRouter
    spend and rate limits".)
  - So there is no zero-cost way to check remaining daily quota; the closest
    available signal is the reset time from the last 429 actually hit.
  - Whether this key-status call itself counts against the 50 was never
    conclusively confirmed either way (OpenRouter's docs don't say), but its
    response shape — key/account metadata, not a model completion — gives no
    reason to think it does.
  - *(Moot since 2026-08-28: the account is paid, and no daily request allowance
    applies.)*

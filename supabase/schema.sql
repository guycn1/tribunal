-- Tribunal database schema.
--
-- Five tables:
--   case_definitions        the fixed case record (seeded once, read-only in practice)
--   trials                  one row per run of the tribunal against a case
--   representative_arguments  one row per representative who argued in a trial
--   judge_rulings            one row per judge who ruled in a trial
--   api_call_logs             one row per model call, success or failure
--
-- Row Level Security is enabled on every table with no policies defined, so
-- anon/authenticated clients (the browser) cannot read or write any of it —
-- only the service role key (used exclusively by the backend) can. The
-- browser never talks to Supabase directly; all access goes through the
-- backend functions.
--
-- No blank lines anywhere in this file, deliberately: pasting a version with
-- blank lines into Supabase's SQL Editor triggered some paste-time
-- interference (likely a browser extension) that spliced extra comment
-- lines into the middle of a multi-line string literal at each blank line,
-- breaking the statement. Every multi-paragraph text value below uses an
-- E'...' escape string with explicit \n\n instead of literal blank lines.
-- ---------------------------------------------------------------------------
-- case_definitions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;
create table if not exists case_definitions (
  case_code text primary key,
  title text not null,
  accused text not null,
  deceased text not null,
  act_alleged text not null,
  background text not null,
  agreed_facts jsonb not null,
  question text not null,
  scope_note text not null
);
alter table case_definitions enable row level security;
insert into case_definitions (
  case_code, title, accused, deceased, act_alleged, background, agreed_facts, question, scope_note
) values (
  'T-001',
  'The Realm v. Jon Snow',
  'Jon Snow',
  'Daenerys Targaryen',
  'Jon intentionally killed Daenerys by stabbing her during a private meeting in the throne room after the fall of King''s Landing.',
  E'The story takes place mainly in Westeros. Jon Snow grows up believing he is the illegitimate son of Lord Eddard Stark; he becomes a military commander, then King in the North, and later learns he is the lawful son of Rhaegar Targaryen and Lyanna Stark — giving him a stronger hereditary claim to the throne than Daenerys, though he does not want to rule.\n\nDaenerys Targaryen is the exiled heir of the dynasty that once ruled Westeros. She survives abuse, gains three dragons, frees enslaved people, and builds an army — becoming both liberator and increasingly absolute ruler. Jon and Daenerys become allies and lovers while fighting the Night King. After defeating the dead, Daenerys turns to the Iron Throne; Jon''s hidden parentage weakens her political claim and feeds her fear of betrayal.\n\nDaenerys attacks King''s Landing. The city surrenders, but Daenerys burns streets and civilians from her dragon, Drogon. Jon witnesses the destruction. Grey Worm, her commander, joins the killing on the ground. Daenerys promises further campaigns of "liberation." Tyrion Lannister, her chief adviser, resigns in protest and is imprisoned, warning Jon that Daenerys will kill anyone who threatens her rule, including Jon''s sisters. Jon asks Daenerys to show mercy and share moral judgment with others. She refuses. During an embrace, he stabs her to death. Her soldiers arrest him.',
  '[
    "King''s Landing had surrendered: bells rang, organized resistance had ceased. Daenerys then used Drogon against streets and civilians, causing destruction on a vast scale.",
    "After the victory, Daenerys told her assembled forces the campaign of \"liberation\" would continue beyond King''s Landing. Jon had seen the city and heard the speech.",
    "Tyrion Lannister renounced his office as Hand and was imprisoned. He warned Jon that Daenerys would treat Jon''s sisters, and anyone else she regarded as an obstacle, as enemies.",
    "Jon asked Daenerys to forgive Tyrion and show mercy. She refused to let others choose what was good and presented her own judgment as decisive.",
    "Daenerys was unarmed and was not attacking Jon when he killed her. Jon used their intimacy to get close enough to strike. He had not convened a council, attempted detention, or sought a public surrender of power."
  ]'::jsonb,
  'Was Jon Snow''s intentional killing of Daenerys Targaryen justified as the necessary defense of others and of the realm, given what he knew, the scale of the threatened harm, the absence or presence of safer alternatives, and his lack of formal authority?',
  'The Tribunal decides justified / not justified and gives reasons. It does not impose a sentence, and it does not combine the three judges'' opinions into one verdict.'
)
on conflict (case_code) do nothing;
-- ---------------------------------------------------------------------------
-- trials
-- ---------------------------------------------------------------------------
create table if not exists trials (
  id uuid primary key default gen_random_uuid(),
  case_code text not null references case_definitions(case_code),
  status text not null default 'created' check (status in ('created', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table trials enable row level security;
create index if not exists trials_created_at_idx on trials (created_at desc);
-- ---------------------------------------------------------------------------
-- representative_arguments
-- ---------------------------------------------------------------------------
create table if not exists representative_arguments (
  id uuid primary key default gen_random_uuid(),
  trial_id uuid not null references trials(id) on delete cascade,
  role text not null check (role in ('jon_snow', 'tyrion_lannister', 'daenerys_targaryen', 'grey_worm')),
  seat text not null check (seat in ('defense', 'prosecution')),
  argument_text text not null,
  model_used text not null,
  created_at timestamptz not null default now(),
  unique (trial_id, role)
);
alter table representative_arguments enable row level security;
-- ---------------------------------------------------------------------------
-- judge_rulings
-- ---------------------------------------------------------------------------
create table if not exists judge_rulings (
  id uuid primary key default gen_random_uuid(),
  trial_id uuid not null references trials(id) on delete cascade,
  role text not null check (role in ('barak', 'elon', 'shamgar')),
  verdict text not null check (verdict in ('justified', 'not justified')),
  reasoning_text text not null,
  model_used text not null,
  created_at timestamptz not null default now(),
  unique (trial_id, role)
);
alter table judge_rulings enable row level security;
-- ---------------------------------------------------------------------------
-- api_call_logs
-- ---------------------------------------------------------------------------
create table if not exists api_call_logs (
  id uuid primary key default gen_random_uuid(),
  trial_id uuid not null references trials(id) on delete cascade,
  agent_role text not null,
  call_type text not null check (call_type in ('representative', 'judge')),
  model_used text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  cost numeric(12, 6) not null default 0,
  status text not null check (status in ('success', 'failed')),
  error_message text,
  "timestamp" timestamptz not null default now()
);
alter table api_call_logs enable row level security;
create index if not exists api_call_logs_trial_id_idx on api_call_logs (trial_id);

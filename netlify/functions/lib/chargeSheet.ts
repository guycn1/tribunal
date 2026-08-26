import { getSupabaseClient } from './supabase';
import type { CaseDefinition } from './types';

const CASE_CODE = 'T-001';

// The case record lives in the database (case_definitions), not as a code
// constant, so there is exactly one copy of it — the seed row written by
// supabase/schema.sql. Every prompt-builder and every API response reads
// through this function rather than duplicating the text.
export async function getChargeSheet(): Promise<CaseDefinition> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('case_definitions')
    .select('*')
    .eq('case_code', CASE_CODE)
    .single();

  if (error || !data) {
    throw new Error(`Failed to load case definition '${CASE_CODE}': ${error?.message ?? 'not found'}`);
  }

  return {
    caseCode: data.case_code,
    title: data.title,
    accused: data.accused,
    deceased: data.deceased,
    actAlleged: data.act_alleged,
    background: data.background,
    agreedFacts: data.agreed_facts as string[],
    question: data.question,
    scopeNote: data.scope_note,
  };
}

export function formatChargeSheetForPrompt(caseDef: CaseDefinition): string {
  const facts = caseDef.agreedFacts.map((fact, i) => `${i + 1}. ${fact}`).join('\n');

  return `CASE ${caseDef.caseCode}: ${caseDef.title}

Accused: ${caseDef.accused}
Deceased: ${caseDef.deceased}
Act alleged: ${caseDef.actAlleged}

Background:
${caseDef.background}

Agreed factual record (both sides accept these facts as true):
${facts}

Question for judgment:
${caseDef.question}

Scope note: ${caseDef.scopeNote}`;
}

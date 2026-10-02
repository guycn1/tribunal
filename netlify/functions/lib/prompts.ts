import { formatChargeSheetForPrompt } from './chargeSheet';
import { REPRESENTATIVES } from './representatives';
import { JUDGES } from './judges';
import type { CaseDefinition, JudgeRole, RepresentativeRole, Verdict } from './types';
import type { OpenRouterMessage } from './openrouter';

/**
 * A representative's messages: their character prompt as the system
 * message, and the case record as the user message.
 */
export function buildRepresentativeMessages(
  role: RepresentativeRole,
  caseDef: CaseDefinition
): OpenRouterMessage[] {
  const def = REPRESENTATIVES[role];
  const userContent = `${formatChargeSheetForPrompt(caseDef)}

Present your argument to the Tribunal now.`;

  return [
    { role: 'system', content: def.systemPrompt },
    { role: 'user', content: userContent },
  ];
}

export interface AvailableArgument {
  name: string;
  seat: string;
  argumentText: string;
}

const REPRESENTATIVE_ORDER: RepresentativeRole[] = [
  'jon_snow',
  'tyrion_lannister',
  'daenerys_targaryen',
  'grey_worm',
];

/**
 * A judge's messages: their method prompt as the system message, and the
 * case record followed by all four representatives' arguments as the user
 * message. A representative with no argument is marked unavailable, never
 * left out or filled in.
 *
 * @param availableArguments The saved arguments, by role.
 */
export function buildJudgeMessages(
  role: JudgeRole,
  caseDef: CaseDefinition,
  availableArguments: Partial<Record<RepresentativeRole, string>>
): OpenRouterMessage[] {
  const def = JUDGES[role];

  const argumentsBlock = REPRESENTATIVE_ORDER.map((repRole) => {
    const repDef = REPRESENTATIVES[repRole];
    const text = availableArguments[repRole];
    if (!text) {
      return `${repDef.name} (${repDef.seat}): [argument unavailable — this representative's call failed and was not fabricated]`;
    }
    return `${repDef.name} (${repDef.seat}):\n${text}`;
  }).join('\n\n');

  const userContent = `${formatChargeSheetForPrompt(caseDef)}

Arguments submitted by the four representatives:

${argumentsBlock}

Deliver your ruling now.`;

  return [
    { role: 'system', content: def.systemPrompt },
    { role: 'user', content: userContent },
  ];
}

export interface ParsedJudgeOutput {
  verdict: Verdict;
  reasoningText: string;
}

const VERDICT_LINE = /^\s*VERDICT:\s*(justified|not justified)\s*$/im;

/**
 * A judge's reply split into its verdict and its reasoning, read from the
 * VERDICT line and everything after it. Null if there is no such line, or
 * nothing follows it.
 */
export function parseJudgeOutput(raw: string): ParsedJudgeOutput | null {
  const match = raw.match(VERDICT_LINE);
  if (!match) {
    return null;
  }

  const verdict = match[1].toLowerCase() as Verdict;
  const reasoningText = raw.slice((match.index ?? 0) + match[0].length).trim();

  if (!reasoningText) {
    return null;
  }

  return { verdict, reasoningText };
}

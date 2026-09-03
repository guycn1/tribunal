export type RepresentativeRole = 'jon_snow' | 'tyrion_lannister' | 'daenerys_targaryen' | 'grey_worm';

export type JudgeRole = 'barak' | 'elon' | 'shamgar';

export type Seat = 'defense' | 'prosecution';

export type Verdict = 'justified' | 'not justified';

export type CallType = 'representative' | 'judge';

export type CallStatus = 'success' | 'failed';

export interface CaseDefinition {
  caseCode: string;
  title: string;
  accused: string;
  deceased: string;
  actAlleged: string;
  background: string;
  agreedFacts: string[];
  question: string;
  scopeNote: string;
}

export interface RepresentativeArgumentRecord {
  role: RepresentativeRole;
  seat: Seat;
  argumentText: string;
  modelUsed: string;
  createdAt: string;
}

export interface JudgeRulingRecord {
  role: JudgeRole;
  verdict: Verdict;
  reasoningText: string;
  modelUsed: string;
  createdAt: string;
}

export interface ApiCallLogRecord {
  agentRole: string;
  callType: CallType;
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  status: CallStatus;
  errorMessage: string | null;
  timestamp: string;
  // Wall-clock time this specific row's attempt took, in ms - null only
  // for rows logged before this column existed.
  durationMs: number | null;
}

// The attempt currently in flight (or most recently started) for one role
// in one trial - see agent_progress in schema.sql. tierMaxAttempts lets
// the frontend know whether to show an ordinal suffix ("(first attempt)")
// at all - a tier with only one allowed attempt never needs one.
export interface AgentProgressRecord {
  model: string;
  tierIndex: number;
  attemptInTier: number;
  tierMaxAttempts: number;
}

export interface TrialRecord {
  id: string;
  caseCode: string;
  status: 'created' | 'completed';
  createdAt: string;
  updatedAt: string;
}

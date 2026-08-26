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
}

export interface TrialRecord {
  id: string;
  caseCode: string;
  status: 'created' | 'completed';
  createdAt: string;
  updatedAt: string;
}

import { Platform } from 'react-native';
import { clearCopilotToken, ensureCopilotToken } from './token';

const rawBase = typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_ATOM_ASK_URL : undefined;
const base = rawBase ? rawBase.replace(/\/$/, '') : '';

export interface ClarificationFinding {
  id: string;
  label: string;
  evidence?: string;
  why: string;
  ask?: string;
}

export interface ClarificationReviewResult {
  cardId: string;
  rubricVersion: string;
  requestId: string;
  summary: string;
  covered: ClarificationFinding[];
  missed: ClarificationFinding[];
  lowValue: ClarificationFinding[];
  riskyAssumptions: ClarificationFinding[];
  nextQuestion: string;
  scopeLine: string;
}

export class CopilotReviewError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export function copilotConfigured(): boolean {
  return Boolean(base) && Platform.OS === 'web';
}

function readFinding(value: unknown): ClarificationFinding | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const label = typeof raw.label === 'string' ? raw.label : '';
  const why = typeof raw.why === 'string' ? raw.why : '';
  if (!id || !label || !why) return null;
  return {
    id,
    label,
    why,
    ...(typeof raw.evidence === 'string' && raw.evidence ? { evidence: raw.evidence } : {}),
    ...(typeof raw.ask === 'string' && raw.ask ? { ask: raw.ask } : {}),
  };
}

function readFindings(value: unknown): ClarificationFinding[] | null {
  if (!Array.isArray(value)) return null;
  const findings = value.map(readFinding);
  return findings.every(Boolean) ? (findings as ClarificationFinding[]) : null;
}

function parseReview(value: unknown): ClarificationReviewResult | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const covered = readFindings(raw.covered);
  const missed = readFindings(raw.missed);
  const lowValue = readFindings(raw.lowValue);
  const riskyAssumptions = readFindings(raw.riskyAssumptions);
  if (
    typeof raw.cardId !== 'string' ||
    typeof raw.rubricVersion !== 'string' ||
    typeof raw.requestId !== 'string' ||
    typeof raw.summary !== 'string' ||
    typeof raw.nextQuestion !== 'string' ||
    typeof raw.scopeLine !== 'string' ||
    !covered || !missed || !lowValue || !riskyAssumptions
  ) {
    return null;
  }
  return {
    cardId: raw.cardId,
    rubricVersion: raw.rubricVersion,
    requestId: raw.requestId,
    summary: raw.summary,
    covered,
    missed,
    lowValue,
    riskyAssumptions,
    nextQuestion: raw.nextQuestion,
    scopeLine: raw.scopeLine,
  };
}

export function createCopilotRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `cr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function failureMessage(status: number): string {
  if (status === 401 || status === 403) return 'Copilot access key 不对；下次点击时重新输入。';
  if (status === 429) return '这段时间的审稿次数已到上限，几分钟后再试。';
  if (status === 400) return '这段澄清无法审稿；保留草稿，先用下面的人工清单。';
  return 'Copilot 暂时不可用；草稿和人工清单都还在。';
}

export async function reviewClarifications(input: {
  cardId: string;
  rubricVersion: string;
  answer: string;
  requestId?: string;
}): Promise<ClarificationReviewResult> {
  if (!copilotConfigured()) throw new CopilotReviewError('Copilot 尚未连接；先用下面的人工清单。');
  const token = ensureCopilotToken();
  if (!token) throw new CopilotReviewError('没有 Copilot access key；先用下面的人工清单。');

  let response: Response;
  const id = input.requestId ?? createCopilotRequestId();
  try {
    response = await fetch(`${base}/review/clarifications`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-request-id': id,
      },
      body: JSON.stringify({
        cardId: input.cardId,
        rubricVersion: input.rubricVersion,
        answer: input.answer,
      }),
    });
  } catch {
    throw new CopilotReviewError('Copilot 连不上；草稿和人工清单都还在。');
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) clearCopilotToken();
    throw new CopilotReviewError(failureMessage(response.status), response.status);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new CopilotReviewError('Copilot 返回异常；草稿和人工清单都还在。');
  }
  const review = parseReview(json);
  if (!review || review.cardId !== input.cardId || review.rubricVersion !== input.rubricVersion || review.requestId !== id) {
    throw new CopilotReviewError('Copilot 返回异常；草稿和人工清单都还在。');
  }
  return review;
}

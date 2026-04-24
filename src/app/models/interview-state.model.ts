export type QuestionRecordingStatus =
  | 'not-started'
  | 'recording'
  | 'completed'
  | 'error';

export interface QuestionStateEntry {
  questionId: string;
  index: number;
  status: QuestionRecordingStatus;
  attempts: number;
  /** ISO date string (JSON-safe for persistence) */
  completedAt?: string;
  durationMs?: number;
  errorMessage?: string;
}

/** JSON-safe snapshot for save / restore. Does not include blob data. */
export interface InterviewStateSnapshot {
  version: 1;
  sessionId: string;
  /** ISO date string */
  startedAt: string | null;
  /** ISO date string */
  lastUpdatedAt: string;
  completed: boolean;
  currentIndex: number;
  entries: QuestionStateEntry[];
}

export type NavigationBlockReason =
  | 'current-question-not-completed'
  | 'already-at-first-question'
  | 'already-at-last-question'
  | 'session-not-started'
  | 'session-already-completed';

export interface NavigationResult {
  ok: boolean;
  reason?: NavigationBlockReason;
}

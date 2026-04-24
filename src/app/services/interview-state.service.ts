import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import {
  InterviewStateSnapshot,
  NavigationBlockReason,
  NavigationResult,
  QuestionRecordingStatus,
  QuestionStateEntry,
} from '../models';
import { QuestionService } from './question.service';

const STORAGE_KEY      = 'jobsourcing.interview-state';
const SNAPSHOT_VERSION = 1 as const;
const TICK_INTERVAL_MS = 1_000;

/**
 * High-level orchestrator for an interview session.
 *
 * Sits on top of QuestionService (the catalog / linear navigator) and tracks
 * per-question recording status, session timing, navigation validation, and
 * JSON-safe persistence. Blobs are the RecordingStoreService's responsibility
 * and are intentionally not part of the snapshot.
 */
@Injectable({ providedIn: 'root' })
export class InterviewStateService {
  private readonly questions  = inject(QuestionService);
  private readonly destroyRef = inject(DestroyRef);

  // ── Private state ─────────────────────────────────────────────────────────

  private readonly _sessionId = signal<string>('');
  private readonly _startedAt = signal<Date | null>(null);
  private readonly _completed = signal<boolean>(false);
  private readonly _entries   = signal<Record<string, QuestionStateEntry>>({});
  private readonly _tick      = signal<number>(Date.now());

  private tickHandle: ReturnType<typeof setInterval> | null = null;

  // ── Public readonly signals ───────────────────────────────────────────────

  readonly sessionId = this._sessionId.asReadonly();
  readonly startedAt = this._startedAt.asReadonly();
  readonly completed = this._completed.asReadonly();
  readonly entries   = this._entries.asReadonly();

  readonly currentIndex = computed(() => this.questions.progress().mainIndex);
  readonly totalQuestions = computed(() => this.questions.getAll().length);

  readonly currentQuestionId = computed(() => {
    const q = this.questions.isOnSubQuestion()
      ? this.questions.activeSubQuestion()
      : this.questions.currentMainQuestion();
    return q?.id ?? null;
  });

  readonly currentStatus = computed<QuestionRecordingStatus>(() => {
    const id = this.currentQuestionId();
    return id ? this.getStatus(id) : 'not-started';
  });

  readonly isActive = computed(
    () => this._startedAt() !== null && !this._completed(),
  );

  /** Elapsed session time in milliseconds (pauses included). */
  readonly durationMs = computed(() => {
    const start = this._startedAt();
    if (!start) return 0;
    return this._tick() - start.getTime();
  });

  readonly completedCount = computed(
    () =>
      Object.values(this._entries()).filter(e => e.status === 'completed')
        .length,
  );

  readonly percentComplete = computed(() => {
    const total = this.totalQuestions();
    return total === 0
      ? 0
      : Math.round((this.completedCount() / total) * 100);
  });

  readonly canAdvance = computed(
    () => this.computeCanAdvance().ok,
  );

  readonly canGoBack = computed(
    () => this.computeCanGoBack().ok,
  );

  readonly snapshot = computed<InterviewStateSnapshot>(() => ({
    version:       SNAPSHOT_VERSION,
    sessionId:     this._sessionId(),
    startedAt:     this._startedAt()?.toISOString() ?? null,
    lastUpdatedAt: new Date(this._tick()).toISOString(),
    completed:     this._completed(),
    currentIndex:  this.currentIndex(),
    entries:       Object.values(this._entries()),
  }));

  // ── Observable streams ────────────────────────────────────────────────────

  readonly sessionId$      = toObservable(this.sessionId);
  readonly startedAt$      = toObservable(this.startedAt);
  readonly completed$      = toObservable(this.completed);
  readonly entries$        = toObservable(this.entries);
  readonly currentIndex$   = toObservable(this.currentIndex);
  readonly currentStatus$  = toObservable(this.currentStatus);
  readonly durationMs$     = toObservable(this.durationMs);
  readonly percentComplete$ = toObservable(this.percentComplete);
  readonly snapshot$       = toObservable(this.snapshot);

  constructor() {
    this.destroyRef.onDestroy(() => this.stopTicker());
  }

  // ── Session lifecycle ─────────────────────────────────────────────────────

  start(): void {
    if (this.isActive()) return;
    this._sessionId.set(this.generateSessionId());
    this._startedAt.set(new Date());
    this._completed.set(false);
    this._entries.set(this.seedEntries());
    this._tick.set(Date.now());
    this.startTicker();
  }

  complete(): void {
    if (!this._startedAt()) return;
    this._completed.set(true);
    this.stopTicker();
  }

  reset(): void {
    this.stopTicker();
    this._sessionId.set('');
    this._startedAt.set(null);
    this._completed.set(false);
    this._entries.set({});
    this.questions.reset();
    this.clearPersisted();
  }

  // ── Per-question status ───────────────────────────────────────────────────

  getStatus(questionId: string): QuestionRecordingStatus {
    return this._entries()[questionId]?.status ?? 'not-started';
  }

  getEntry(questionId: string): QuestionStateEntry | undefined {
    return this._entries()[questionId];
  }

  markRecordingStarted(questionId: string): void {
    this.patchEntry(questionId, entry => ({
      ...entry,
      status:   'recording',
      attempts: entry.attempts + 1,
    }));
  }

  markRecordingCompleted(questionId: string, durationMs?: number): void {
    this.patchEntry(questionId, entry => ({
      ...entry,
      status:      'completed',
      completedAt: new Date().toISOString(),
      durationMs:  durationMs ?? entry.durationMs,
      errorMessage: undefined,
    }));
  }

  markRecordingError(questionId: string, message?: string): void {
    this.patchEntry(questionId, entry => ({
      ...entry,
      status:       'error',
      errorMessage: message,
    }));
  }

  resetRecording(questionId: string): void {
    this.patchEntry(questionId, entry => ({
      ...entry,
      status:       'not-started',
      completedAt:  undefined,
      durationMs:   undefined,
      errorMessage: undefined,
    }));
  }

  // ── Navigation (validated) ────────────────────────────────────────────────

  /** Validates then advances through QuestionService. */
  advance(): NavigationResult {
    const check = this.computeCanAdvance();
    if (!check.ok) return check;

    if (this.questions.isOnSubQuestion()) {
      this.questions.afterSubAnswered();
    } else {
      this.questions.afterMainAnswered();
    }

    if (this.questions.isDone()) this.complete();
    return { ok: true };
  }

  /** Validates then navigates backward through QuestionService. */
  goBack(): NavigationResult {
    const check = this.computeCanGoBack();
    if (!check.ok) return check;
    this.questions.goBack();
    return { ok: true };
  }

  /**
   * Jump to an arbitrary main-question index. Only allowed to indexes the user
   * has already reached — never ahead of the furthest completed question + 1.
   */
  jumpTo(index: number): NavigationResult {
    if (!this.isActive()) {
      return { ok: false, reason: 'session-not-started' };
    }
    if (this._completed()) {
      return { ok: false, reason: 'session-already-completed' };
    }
    if (index < 0) {
      return { ok: false, reason: 'already-at-first-question' };
    }
    const furthest = this.furthestReachableIndex();
    if (index > furthest) {
      return { ok: false, reason: 'current-question-not-completed' };
    }
    // Rewind QuestionService step-by-step rather than mutating its internals.
    while (this.questions.progress().mainIndex > index ||
           this.questions.isOnSubQuestion() ||
           this.questions.hasPendingSubSelection()) {
      this.questions.goBack();
    }
    return { ok: true };
  }

  // ── Save / restore ────────────────────────────────────────────────────────

  /** Serialize the current state to localStorage (metadata only — no blobs). */
  save(): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.snapshot()));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Rehydrate from localStorage. Returns false when no valid snapshot was
   * found or the snapshot version is incompatible. QuestionService is advanced
   * to `currentIndex` via its public API — sub-question state is not restored.
   */
  restore(): boolean {
    if (typeof localStorage === 'undefined') return false;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;

    let parsed: InterviewStateSnapshot;
    try {
      parsed = JSON.parse(raw) as InterviewStateSnapshot;
    } catch {
      return false;
    }
    if (parsed?.version !== SNAPSHOT_VERSION) return false;

    const entries: Record<string, QuestionStateEntry> = {};
    for (const entry of parsed.entries ?? []) {
      if (entry?.questionId) entries[entry.questionId] = entry;
    }

    this._sessionId.set(parsed.sessionId || this.generateSessionId());
    this._startedAt.set(parsed.startedAt ? new Date(parsed.startedAt) : null);
    this._completed.set(!!parsed.completed);
    this._entries.set(entries);
    this._tick.set(Date.now());

    this.questions.reset();
    const target = Math.min(
      Math.max(parsed.currentIndex ?? 0, 0),
      Math.max(this.totalQuestions() - 1, 0),
    );
    for (let i = 0; i < target; i++) {
      this.questions.afterMainAnswered();
      if (this.questions.hasPendingSubSelection()) this.questions.skipSubQuestions();
    }

    if (!parsed.completed && parsed.startedAt) this.startTicker();
    return true;
  }

  clearPersisted(): void {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private computeCanAdvance(): NavigationResult {
    if (!this.isActive()) {
      return { ok: false, reason: this._completed() ? 'session-already-completed' : 'session-not-started' };
    }
    const id = this.currentQuestionId();
    if (!id) return { ok: false, reason: 'already-at-last-question' };
    if (this.getStatus(id) !== 'completed') {
      return { ok: false, reason: 'current-question-not-completed' };
    }
    return { ok: true };
  }

  private computeCanGoBack(): NavigationResult {
    if (!this.isActive()) {
      return { ok: false, reason: this._completed() ? 'session-already-completed' : 'session-not-started' };
    }
    const onFirstMain =
      this.questions.progress().mainIndex === 0 &&
      !this.questions.isOnSubQuestion() &&
      !this.questions.hasPendingSubSelection();
    if (onFirstMain) return { ok: false, reason: 'already-at-first-question' };
    return { ok: true };
  }

  /** Highest main-question index the user can reach without skipping incomplete work. */
  private furthestReachableIndex(): number {
    const all = this.questions.getAll();
    for (let i = 0; i < all.length; i++) {
      if (this.getStatus(all[i].id) !== 'completed') return i;
    }
    return Math.max(all.length - 1, 0);
  }

  private patchEntry(
    questionId: string,
    mutate: (entry: QuestionStateEntry) => QuestionStateEntry,
  ): void {
    this._entries.update(map => {
      const existing =
        map[questionId] ??
        this.buildEntryFor(questionId) ?? {
          questionId,
          index:    -1,
          status:   'not-started',
          attempts: 0,
        };
      return { ...map, [questionId]: mutate(existing) };
    });
  }

  private seedEntries(): Record<string, QuestionStateEntry> {
    const map: Record<string, QuestionStateEntry> = {};
    this.questions.getAll().forEach((q, index) => {
      map[q.id] = { questionId: q.id, index, status: 'not-started', attempts: 0 };
      q.subQuestions.forEach(s => {
        map[s.id] = { questionId: s.id, index, status: 'not-started', attempts: 0 };
      });
    });
    return map;
  }

  private buildEntryFor(questionId: string): QuestionStateEntry | null {
    const main = this.questions.getById(questionId);
    if (main) {
      return { questionId, index: main.order - 1, status: 'not-started', attempts: 0 };
    }
    const sub = this.questions.getSubQuestionById(questionId);
    if (sub) {
      return { questionId, index: -1, status: 'not-started', attempts: 0 };
    }
    return null;
  }

  private startTicker(): void {
    this.stopTicker();
    this.tickHandle = setInterval(
      () => this._tick.set(Date.now()),
      TICK_INTERVAL_MS,
    );
  }

  private stopTicker(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  private generateSessionId(): string {
    const cryptoObj = typeof crypto !== 'undefined' ? crypto : undefined;
    if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Re-exported for callers that want to branch on navigation failures. */
export type { NavigationBlockReason };

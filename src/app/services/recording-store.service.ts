import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import {
  QuestionRecording,
  QuestionRecordingMeta,
  RecordingResult,
  StorageStats,
  StorageWarning,
  StorageWarningLevel,
  StoreOperationProgress,
} from '../models';

const DB_NAME    = 'interview-recordings';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

const WARN_BYTES     = 200 * 1024 * 1024; // 200 MB
const CRITICAL_BYTES = 400 * 1024 * 1024; // 400 MB

@Injectable({ providedIn: 'root' })
export class RecordingStoreService {

  private readonly destroyRef = inject(DestroyRef);

  private readonly _recordings = signal<QuestionRecording[]>([]);
  private readonly _progress   = signal<StoreOperationProgress>({ operation: 'idle', percent: 100 });

  readonly recordings = this._recordings.asReadonly();
  readonly progress   = this._progress.asReadonly();

  readonly count = computed(() => this._recordings().length);

  readonly totalSizeBytes = computed(() =>
    this._recordings().reduce((sum, r) => sum + r.sizeBytes, 0),
  );

  readonly storageWarning = computed((): StorageWarning => {
    const bytes = this.totalSizeBytes();
    const totalMb = bytes / (1024 * 1024);
    if (bytes >= CRITICAL_BYTES) {
      return {
        level: 'critical',
        totalMb,
        message: `Storage critical (${totalMb.toFixed(0)} MB). Clear recordings before continuing.`,
      };
    }
    if (bytes >= WARN_BYTES) {
      return {
        level: 'warn',
        totalMb,
        message: `Storage is large (${totalMb.toFixed(0)} MB). Consider uploading soon.`,
      };
    }
    return { level: 'none', totalMb, message: '' };
  });

  readonly stats = computed((): StorageStats => ({
    totalBytes: this.totalSizeBytes(),
    totalMb: this.totalSizeBytes() / (1024 * 1024),
    recordingCount: this.count(),
    warning: this.storageWarning(),
  }));

  readonly isSaving  = computed(() => this._progress().operation === 'saving');
  readonly isLoading = computed(() => this._progress().operation === 'loading');
  readonly isClearing = computed(() => this._progress().operation === 'clearing');
  readonly isBusy     = computed(() => this._progress().operation !== 'idle');

  private db: IDBDatabase | null = null;

  constructor() {
    this.openDb().catch(() => { /* IDB unavailable — memory-only fallback */ });
    this.destroyRef.onDestroy(() => this.db?.close());
  }

  // ── Public API ──────────────────────────────────────────────────

  async saveRecording(
    result: RecordingResult,
    meta: QuestionRecordingMeta,
  ): Promise<QuestionRecording> {
    this._progress.set({ operation: 'saving', percent: 10, current: 0, total: 1 });

    const recording: QuestionRecording = {
      id: this.uuid(),
      ...meta,
      blob: result.blob,
      mimeType: result.mimeType,
      durationMs: result.durationMs,
      sizeBytes: result.sizeBytes,
      savedAt: new Date(),
    };

    // Upsert in memory (replace same question if retaken)
    this._recordings.update(all => [
      ...all.filter(r => r.questionId !== meta.questionId),
      recording,
    ]);
    this._progress.set({ operation: 'saving', percent: 50, current: 0, total: 1 });

    // Persist to IDB — graceful degradation on failure
    try {
      const db = await this.openDb();
      await this.idbPut(db, recording);
    } catch {
      /* recording still lives in memory */
    }

    this._progress.set({ operation: 'idle', percent: 100, current: 1, total: 1 });
    return recording;
  }

  getRecording(questionId: string): QuestionRecording | undefined {
    return this._recordings().find(r => r.questionId === questionId);
  }

  getByIndex(questionIndex: number): QuestionRecording | undefined {
    return this._recordings().find(r => r.questionIndex === questionIndex);
  }

  getAll(): QuestionRecording[] {
    return [...this._recordings()];
  }

  async clearAll(): Promise<void> {
    const total = this._recordings().length;
    this._progress.set({ operation: 'clearing', percent: 0, total });
    this._recordings.set([]);
    this._progress.set({ operation: 'clearing', percent: 60, total });
    try {
      const db = await this.openDb();
      await this.idbClear(db);
    } catch {
      /* memory already cleared */
    }
    this._progress.set({ operation: 'idle', percent: 100, total });
  }

  async restoreFromIdb(): Promise<QuestionRecording[]> {
    this._progress.set({ operation: 'loading', percent: 0 });
    try {
      const db  = await this.openDb();
      this._progress.set({ operation: 'loading', percent: 40 });
      const all = await this.idbGetAll(db);
      const sorted = [...all].sort((a, b) => a.questionIndex - b.questionIndex);
      this._recordings.set(sorted);
      this._progress.set({ operation: 'idle', percent: 100, total: sorted.length });
      return sorted;
    } catch {
      this._progress.set({ operation: 'idle', percent: 100 });
      return [];
    }
  }

  formatBytes(bytes: number): string {
    if (bytes === 0)           return '0 B';
    if (bytes < 1_024)         return `${bytes} B`;
    if (bytes < 1_048_576)     return `${(bytes / 1_024).toFixed(1)} KB`;
    if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
    return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  }

  formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m.toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  }

  // ── IndexedDB ───────────────────────────────────────────────────
  // Key path is `questionId` so `put()` naturally upserts per question (handles retakes).

  private openDb(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB not available'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'questionId' });
          store.createIndex('questionIndex', 'questionIndex', { unique: false });
          store.createIndex('savedAt',       'savedAt',       { unique: false });
        }
      };

      req.onsuccess = (e) => {
        this.db = (e.target as IDBOpenDBRequest).result;
        resolve(this.db);
      };

      req.onerror = () => reject(req.error);
    });
  }

  private idbPut(db: IDBDatabase, record: QuestionRecording): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(record);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  private idbGetAll(db: IDBDatabase): Promise<QuestionRecording[]> {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as QuestionRecording[]);
      req.onerror   = () => reject(req.error);
    });
  }

  private idbClear(db: IDBDatabase): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).clear();
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  private uuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

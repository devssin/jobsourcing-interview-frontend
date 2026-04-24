export type RecordingStatus = 'idle' | 'recording' | 'stopped' | 'uploading' | 'uploaded' | 'error';

export interface Recording {
  id: string;
  questionId: string;
  userId: string;
  /** In-memory blob before upload; undefined after upload */
  blob?: Blob;
  /** S3 URL after successful upload */
  url?: string;
  /** Duration in seconds */
  duration: number;
  status: RecordingStatus;
  createdAt: Date;
}

// ── VideoRecordingService types ──────────────────────────────────

export type RecordingState = 'idle' | 'recording' | 'paused' | 'stopped';

export interface RecordingOptions {
  /** Override auto-detected MIME type (e.g. 'video/webm;codecs=vp9,opus') */
  mimeType?: string;
  /** Target bits per second for the video track */
  videoBitsPerSecond?: number;
  /** Target bits per second for the audio track */
  audioBitsPerSecond?: number;
  /** Milliseconds between ondataavailable events; defaults to 500 */
  timeslice?: number;
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  /** Active recording duration in milliseconds (pause time excluded) */
  durationMs: number;
  sizeBytes: number;
}

export type RecordingErrorCode =
  | 'NOT_SUPPORTED'
  | 'START_FAILED'
  | 'STOP_FAILED'
  | 'PAUSE_RESUME_FAILED'
  | 'UNKNOWN';

export interface RecordingError {
  code: RecordingErrorCode;
  message: string;
  original?: unknown;
}

// ── RecordingStoreService types ──────────────────────────────────

export interface QuestionRecordingMeta {
  questionId: string;
  questionIndex: number;
  questionText: string;
}

export interface QuestionRecording extends QuestionRecordingMeta {
  /** Session-scoped UUID */
  id: string;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
  savedAt: Date;
}

export type StorageWarningLevel = 'none' | 'warn' | 'critical';

export interface StorageWarning {
  level: StorageWarningLevel;
  totalMb: number;
  message: string;
}

export interface StorageStats {
  totalBytes: number;
  totalMb: number;
  recordingCount: number;
  warning: StorageWarning;
}

export type StoreOperation = 'idle' | 'saving' | 'loading' | 'clearing';

export interface StoreOperationProgress {
  operation: StoreOperation;
  /** 0–100 */
  percent: number;
  current?: number;
  total?: number;
}

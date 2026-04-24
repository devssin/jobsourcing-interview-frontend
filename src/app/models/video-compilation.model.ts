export type CompilationState =
  | 'idle'
  | 'preparing'
  | 'compiling'
  | 'finalizing'
  | 'completed'
  | 'error'
  | 'canceled';

export interface CompilationProgress {
  /** 0–100 overall progress */
  percent: number;
  /** 1-based index of the clip currently being processed (0 when idle) */
  currentIndex: number;
  /** Total number of clips being compiled */
  totalCount: number;
  /** Human-readable label for the current clip (e.g. "Question 2") */
  currentLabel: string;
  /** ms since compile() started */
  elapsedMs: number;
  /** ms estimated until completion; 0 when unknown or done */
  estimatedRemainingMs: number;
}

export interface CompilationResult {
  blob: Blob;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  /** Object URL of a single-frame thumbnail (JPEG), ready for <img src>. */
  thumbnailUrl: string;
  createdAt: Date;
}

export interface CompilationError {
  code:
    | 'UNSUPPORTED'
    | 'NO_RECORDINGS'
    | 'AUDIO_CONTEXT_FAILED'
    | 'RECORDER_FAILED'
    | 'CLIP_FAILED'
    | 'CANCELED'
    | 'UNKNOWN';
  message: string;
  clipIndex?: number;
  original?: unknown;
}

export interface CompilationOptions {
  /** Output width in pixels (defaults to 1280) */
  width?: number;
  /** Output height in pixels (defaults to 720) */
  height?: number;
  /** Frames per second for the canvas capture stream (defaults to 30) */
  frameRate?: number;
  /** MIME type for the output recording; auto-detected when omitted */
  mimeType?: string;
  /** Video bits per second */
  videoBitsPerSecond?: number;
}

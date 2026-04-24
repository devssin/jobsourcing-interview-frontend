import { computed, Injectable, signal } from '@angular/core';
import {
  RecordingError,
  RecordingErrorCode,
  RecordingOptions,
  RecordingResult,
  RecordingState,
} from '../models';

@Injectable({ providedIn: 'root' })
export class VideoRecordingService {

  readonly isSupported =
    typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined';

  private readonly _state    = signal<RecordingState>('idle');
  private readonly _error    = signal<RecordingError | null>(null);
  private readonly _duration = signal(0);
  private readonly _result   = signal<RecordingResult | null>(null);

  readonly state    = this._state.asReadonly();
  readonly error    = this._error.asReadonly();
  readonly duration = this._duration.asReadonly();
  readonly result   = this._result.asReadonly();

  readonly isRecording = computed(() => this._state() === 'recording');
  readonly isPaused    = computed(() => this._state() === 'paused');
  readonly isStopped   = computed(() => this._state() === 'stopped');
  readonly isIdle      = computed(() => this._state() === 'idle');
  readonly isActive    = computed(() =>
    this._state() === 'recording' || this._state() === 'paused',
  );

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private detectedMimeType = '';
  private startedAt = 0;
  private stoppedAt = 0;
  private pausedDurationMs = 0;
  private pauseStart = 0;
  private durationTimer: ReturnType<typeof setInterval> | null = null;

  static detectMimeType(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4',
    ];
    return candidates.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
  }

  start(stream: MediaStream, options: RecordingOptions = {}): void {
    if (!this.isSupported) {
      this.setError('NOT_SUPPORTED', 'MediaRecorder API is not supported in this browser.');
      return;
    }
    if (this.isActive()) return;

    this._error.set(null);
    this._result.set(null);
    this.chunks = [];
    this.pausedDurationMs = 0;
    this.pauseStart = 0;

    const mimeType = options.mimeType ?? VideoRecordingService.detectMimeType();
    this.detectedMimeType = mimeType;

    try {
      const recOptions: MediaRecorderOptions = {};
      if (mimeType)                    recOptions.mimeType           = mimeType;
      if (options.videoBitsPerSecond)  recOptions.videoBitsPerSecond = options.videoBitsPerSecond;
      if (options.audioBitsPerSecond)  recOptions.audioBitsPerSecond = options.audioBitsPerSecond;

      this.recorder = new MediaRecorder(stream, recOptions);

      this.recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };

      this.recorder.onstop = () => {
        this.stoppedAt = Date.now();
        this.clearDurationTimer();
        const result = this.buildResult();
        this._duration.set(Math.floor(result.durationMs / 1000));
        this._result.set(result);
        this._state.set('stopped');
      };

      this.recorder.onerror = (e: Event) => {
        const err = (e as Event & { error?: DOMException }).error;
        this.setError('UNKNOWN', err?.message ?? 'An unexpected recording error occurred.', err);
        this.clearDurationTimer();
        this._state.set('idle');
      };

      this.recorder.start(options.timeslice ?? 500);
      this.startedAt = Date.now();
      this._state.set('recording');
      this.startDurationTimer();

    } catch (err) {
      this.setError('START_FAILED', 'Failed to start the MediaRecorder.', err);
    }
  }

  stop(): void {
    if (!this.recorder || !this.isActive()) return;
    try {
      this.recorder.stop();
      this.clearDurationTimer();
    } catch (err) {
      this.setError('STOP_FAILED', 'Failed to stop the MediaRecorder.', err);
    }
  }

  pause(): void {
    if (!this.recorder || !this.isRecording()) return;
    try {
      this.recorder.pause();
      this.pauseStart = Date.now();
      this.clearDurationTimer();
      this._state.set('paused');
    } catch (err) {
      this.setError('PAUSE_RESUME_FAILED', 'Failed to pause recording.', err);
    }
  }

  resume(): void {
    if (!this.recorder || !this.isPaused()) return;
    try {
      this.recorder.resume();
      this.pausedDurationMs += Date.now() - this.pauseStart;
      this._state.set('recording');
      this.startDurationTimer();
    } catch (err) {
      this.setError('PAUSE_RESUME_FAILED', 'Failed to resume recording.', err);
    }
  }

  toBlob(): RecordingResult | null {
    if (this._state() !== 'stopped' || this.chunks.length === 0) return null;
    return this.buildResult();
  }

  reset(): void {
    if (this.recorder && this.isActive()) {
      this.recorder.onstop  = null;
      this.recorder.onerror = null;
      try { this.recorder.stop(); } catch { /* ignore */ }
    }
    this.clearDurationTimer();
    this.recorder        = null;
    this.chunks          = [];
    this.detectedMimeType = '';
    this.startedAt       = 0;
    this.stoppedAt       = 0;
    this.pausedDurationMs = 0;
    this.pauseStart      = 0;
    this._state.set('idle');
    this._error.set(null);
    this._duration.set(0);
    this._result.set(null);
  }

  private buildResult(): RecordingResult {
    const mimeType   = this.detectedMimeType || 'video/webm';
    const blob       = new Blob(this.chunks, { type: mimeType });
    const durationMs = (this.stoppedAt || Date.now()) - this.startedAt - this.pausedDurationMs;
    return { blob, mimeType, durationMs, sizeBytes: blob.size };
  }

  private startDurationTimer(): void {
    this.clearDurationTimer();
    this.durationTimer = setInterval(() => {
      this._duration.set(
        Math.floor((Date.now() - this.startedAt - this.pausedDurationMs) / 1000),
      );
    }, 1000);
  }

  private clearDurationTimer(): void {
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
  }

  private setError(code: RecordingErrorCode, message: string, original?: unknown): void {
    this._error.set({ code, message, original });
  }
}

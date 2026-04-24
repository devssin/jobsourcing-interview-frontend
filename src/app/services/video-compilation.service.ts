import { computed, Injectable, signal } from '@angular/core';
import {
  CompilationError,
  CompilationOptions,
  CompilationProgress,
  CompilationResult,
  CompilationState,
  QuestionRecording,
} from '../models';

const DEFAULT_WIDTH  = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_FPS    = 30;

/**
 * Real browser-side video compiler built on `<canvas>.captureStream()` +
 * `MediaRecorder`. Plays each recording in sequence onto an offscreen canvas,
 * merges audio through an `AudioContext`, and records the combined stream
 * as a single webm/mp4 blob.
 *
 * Progress is tracked against the sum of source durations — because playback
 * happens in real time, total compile time ≈ total recorded time.
 */
@Injectable({ providedIn: 'root' })
export class VideoCompilationService {

  readonly isSupported =
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    'captureStream' in HTMLCanvasElement.prototype;

  private readonly _state    = signal<CompilationState>('idle');
  private readonly _progress = signal<CompilationProgress>(this.emptyProgress());
  private readonly _result   = signal<CompilationResult | null>(null);
  private readonly _error    = signal<CompilationError | null>(null);

  readonly state    = this._state.asReadonly();
  readonly progress = this._progress.asReadonly();
  readonly result   = this._result.asReadonly();
  readonly error    = this._error.asReadonly();

  readonly isActive = computed(() =>
    this._state() === 'preparing' ||
    this._state() === 'compiling' ||
    this._state() === 'finalizing',
  );

  private cancelRequested    = false;
  private activeRecorder:   MediaRecorder | null          = null;
  private activeAudioCtx:   AudioContext | null           = null;
  private activeKeepAlive:  AudioBufferSourceNode | null  = null;
  private activeVideoEl:    HTMLVideoElement | null       = null;
  private activeObjectUrls: string[]                      = [];
  private rafHandle:        number | null                 = null;

  // ── Public API ──────────────────────────────────────────────────────────

  async compile(
    recordings: QuestionRecording[],
    options: CompilationOptions = {},
  ): Promise<void> {
    if (this.isActive()) return;

    this._error.set(null);
    this._result.set(null);
    this.cancelRequested = false;

    if (!this.isSupported) {
      this.fail('UNSUPPORTED', 'Video compilation is not supported in this browser.');
      return;
    }
    if (recordings.length === 0) {
      this.fail('NO_RECORDINGS', 'There are no recordings to compile.');
      return;
    }

    const ordered = [...recordings].sort(
      (a, b) => a.questionIndex - b.questionIndex,
    );
    const totalDurationMs = ordered.reduce((sum, r) => sum + r.durationMs, 0);

    this._state.set('preparing');
    this._progress.set({
      percent:              0,
      currentIndex:         0,
      totalCount:           ordered.length,
      currentLabel:         'Preparing…',
      elapsedMs:            0,
      estimatedRemainingMs: totalDurationMs,
    });

    const width     = options.width     ?? DEFAULT_WIDTH;
    const height    = options.height    ?? DEFAULT_HEIGHT;
    const frameRate = options.frameRate ?? DEFAULT_FPS;

    const canvas = document.createElement('canvas');
    canvas.width  = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      this.fail('UNKNOWN', 'Unable to acquire a 2D canvas context.');
      return;
    }

    // The <video> must be attached to the DOM — Chromium will stall metadata
    // loading and `play()` on a fully-detached element. We hide it offscreen.
    const video = document.createElement('video');
    video.playsInline = true;
    video.preload     = 'auto';
    video.muted       = false; // must NOT be muted — Chrome pauses muted off-screen elements as
    video.volume      = 0;     // "video-only background media" to save power; volume=0 silences output
    video.setAttribute('aria-hidden', 'true');
    video.style.cssText =
      'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(video);
    this.activeVideoEl = video;

    let audioCtx: AudioContext;
    let audioDest: MediaStreamAudioDestinationNode;
    try {
      const AudioCtxCtor: typeof AudioContext =
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext
        ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx  = new AudioCtxCtor();
      audioDest = audioCtx.createMediaStreamDestination();
      this.activeAudioCtx = audioCtx;

      // Keep the AudioContext from auto-suspending while between clips.
      // A looping zero-gain silent buffer is the lightest way to maintain
      // an active graph without producing any audible output.
      const silenceBuf = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
      const keepAlive  = audioCtx.createBufferSource();
      keepAlive.buffer = silenceBuf;
      keepAlive.loop   = true;
      const keepGain   = audioCtx.createGain();
      keepGain.gain.value = 0;
      keepAlive.connect(keepGain);
      keepGain.connect(audioCtx.destination);
      keepAlive.start();
      this.activeKeepAlive = keepAlive;

      if (audioCtx.state !== 'running') {
        try { await audioCtx.resume(); } catch { /* best effort */ }
      }
    } catch (err) {
      this.fail('AUDIO_CONTEXT_FAILED', 'Unable to initialise audio pipeline.', err);
      return;
    }

    // Pre-decode every clip's audio before the MediaRecorder starts so the
    // canvas + audio stay in sync during recording (no decode gap per clip).
    // decodeAudioData reads directly from the blob bytes — it is unaffected
    // by the video element being muted, which was the root cause of silence.
    const audioBuffers: (AudioBuffer | null)[] = await Promise.all(
      ordered.map(async (clip) => {
        try {
          const buf = await clip.blob.arrayBuffer();
          return await audioCtx.decodeAudioData(buf);
        } catch {
          return null;
        }
      }),
    );

    const canvasStream = canvas.captureStream(frameRate);
    const outputStream = new MediaStream();
    canvasStream.getVideoTracks().forEach(t => outputStream.addTrack(t));
    audioDest.stream.getAudioTracks().forEach(t => outputStream.addTrack(t));

    // Prefer the caller's requested mime, but gracefully fall back to any
    // supported codec when it isn't available (e.g. Firefox can't record mp4).
    const requestedMime =
      options.mimeType && MediaRecorder.isTypeSupported(options.mimeType)
        ? options.mimeType
        : undefined;
    const mimeType = requestedMime ?? this.detectMimeType();
    const recorderOptions: MediaRecorderOptions = {};
    if (mimeType)                        recorderOptions.mimeType           = mimeType;
    if (options.videoBitsPerSecond)      recorderOptions.videoBitsPerSecond = options.videoBitsPerSecond;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(outputStream, recorderOptions);
    } catch (err) {
      this.cleanupActive();
      this.fail('RECORDER_FAILED', 'Unable to start MediaRecorder.', err);
      return;
    }
    this.activeRecorder = recorder;

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const startedAt = performance.now();
    recorder.start(500);
    this._state.set('compiling');

    // Fill canvas with black before any video loads.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    try {
      let accumulated = 0;
      for (let i = 0; i < ordered.length; i++) {
        if (this.cancelRequested) throw new CancelError();

        const clip  = ordered[i];
        const label = this.labelFor(clip);
        this._progress.update(p => ({
          ...p,
          currentIndex: i + 1,
          currentLabel: label,
        }));

        const url = URL.createObjectURL(clip.blob);
        this.activeObjectUrls.push(url);

        // Schedule the pre-decoded audio to start 80 ms from now so the
        // video element has time to load metadata and call play() in sync.
        let bufSrc: AudioBufferSourceNode | null = null;
        const ab = audioBuffers[i];
        if (ab && audioCtx.state === 'running') {
          const startAt = audioCtx.currentTime + 0.08;
          bufSrc = audioCtx.createBufferSource();
          bufSrc.buffer = ab;
          bufSrc.connect(audioDest);
          bufSrc.start(startAt);
          // Wait out the scheduling window before kicking off video playback.
          await new Promise<void>(r => setTimeout(r, 90));
        }

        await this.playClip(
          video,
          ctx,
          url,
          width,
          height,
          () => this.cancelRequested,
          (clipElapsedMs) => {
            const elapsed = performance.now() - startedAt;
            const overall = accumulated + clipElapsedMs;
            const percent = totalDurationMs === 0
              ? 0
              : Math.min(99, Math.round((overall / totalDurationMs) * 100));
            this._progress.update(p => ({
              ...p,
              percent,
              elapsedMs:            elapsed,
              estimatedRemainingMs: Math.max(0, totalDurationMs - overall),
            }));
          },
        );

        if (bufSrc) {
          try { bufSrc.stop(); } catch { /* already finished */ }
          bufSrc.disconnect();
        }

        accumulated += clip.durationMs;
      }

      if (this.cancelRequested) throw new CancelError();

      this._state.set('finalizing');
      this._progress.update(p => ({
        ...p,
        percent:              99,
        currentLabel:         'Finalising…',
        estimatedRemainingMs: 0,
      }));

      const stopped = this.waitForStop(recorder);
      recorder.stop();
      await stopped;

      const outMime      = recorder.mimeType || mimeType || 'video/webm';
      const rawBlob      = new Blob(chunks, { type: outMime });
      // Patch the WebM Duration header so players can seek. MediaRecorder
      // leaves Duration=0 in the container; without a real value, the video
      // element reports NaN duration and the seek bar is non-functional.
      const blob         = await this.patchWebmDuration(rawBlob, totalDurationMs);
      const thumbnailUrl = await this.generateThumbnail(blob).catch(() => '');

      this._result.set({
        blob,
        mimeType:     outMime,
        sizeBytes:    blob.size,
        durationMs:   totalDurationMs,
        thumbnailUrl,
        createdAt:    new Date(),
      });
      this._progress.update(p => ({ ...p, percent: 100, currentLabel: 'Done' }));
      this._state.set('completed');
    } catch (err) {
      if (err instanceof CancelError || this.cancelRequested) {
        this.safeStop(recorder);
        this._state.set('canceled');
        this._error.set({ code: 'CANCELED', message: 'Compilation was canceled.' });
      } else {
        this.safeStop(recorder);
        const message = err instanceof Error ? err.message : 'Compilation failed.';
        this.fail('CLIP_FAILED', message, err);
      }
    } finally {
      this.cleanupActive();
    }
  }

  cancel(): void {
    if (!this.isActive()) return;
    this.cancelRequested = true;
    if (this.activeVideoEl) {
      try { this.activeVideoEl.pause(); } catch { /* ignore */ }
    }
  }

  reset(): void {
    if (this.isActive()) this.cancel();
    const prev = this._result();
    if (prev?.thumbnailUrl) {
      try { URL.revokeObjectURL(prev.thumbnailUrl); } catch { /* ignore */ }
    }
    this._state.set('idle');
    this._progress.set(this.emptyProgress());
    this._result.set(null);
    this._error.set(null);
    this.cancelRequested = false;
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024)         return `${bytes} B`;
    if (bytes < 1_048_576)    return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1_073_741_824)return `${(bytes / 1_048_576).toFixed(1)} MB`;
    return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  }

  formatDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private async playClip(
    video: HTMLVideoElement,
    ctx: CanvasRenderingContext2D,
    src: string,
    canvasW: number,
    canvasH: number,
    isCanceled: () => boolean,
    onTick: (clipElapsedMs: number) => void,
  ): Promise<void> {
    video.src = src;
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => { cleanup(); resolve(); };
      const onError  = () => { cleanup(); reject(new Error('Clip failed to load')); };
      const cleanup  = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };
      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onError);
    });

    video.currentTime = 0;
    // Chrome may interrupt play() once if it decides the element is background
    // media. Reload and retry exactly once before surfacing the error.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await video.play();
        break;
      } catch (err) {
        if (attempt === 0) {
          await new Promise<void>(r => setTimeout(r, 150));
          video.load();
          await new Promise<void>((resolve, reject) => {
            const onReady = () => { cleanup(); resolve(); };
            const onErr   = () => { cleanup(); reject(); };
            const cleanup = () => {
              video.removeEventListener('loadedmetadata', onReady);
              video.removeEventListener('error', onErr);
            };
            video.addEventListener('loadedmetadata', onReady);
            video.addEventListener('error', onErr);
          });
          video.currentTime = 0;
          continue;
        }
        throw new Error(
          `video.play() rejected — likely autoplay blocked. Original: ${(err as Error)?.message ?? err}`,
        );
      }
    }

    const clipStart = performance.now();
    const tick = () => {
      if (!video.paused && !video.ended && !isCanceled()) {
        this.drawContainFrame(ctx, video, canvasW, canvasH);
        onTick(performance.now() - clipStart);
        this.rafHandle = requestAnimationFrame(tick);
      }
    };
    this.rafHandle = requestAnimationFrame(tick);

    await new Promise<void>((resolve, reject) => {
      const onEnded  = () => { cleanup(); resolve(); };
      const onError  = () => { cleanup(); reject(new Error('Clip playback failed')); };
      const cancelCheck = setInterval(() => {
        if (isCanceled()) { clearInterval(cancelCheck); cleanup(); resolve(); }
      }, 100);
      const cleanup = () => {
        clearInterval(cancelCheck);
        video.removeEventListener('ended', onEnded);
        video.removeEventListener('error', onError);
      };
      video.addEventListener('ended', onEnded);
      video.addEventListener('error', onError);
    });

    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  /**
   * Draw `video` onto the canvas, preserving aspect ratio (contain, centered).
   * Letterboxed bars are black to match the idle canvas fill.
   */
  private drawContainFrame(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    canvasW: number,
    canvasH: number,
  ): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvasW, canvasH);

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw === 0 || vh === 0) return;

    const scale = Math.min(canvasW / vw, canvasH / vh);
    const dw    = vw * scale;
    const dh    = vh * scale;
    const dx    = (canvasW - dw) / 2;
    const dy    = (canvasH - dh) / 2;
    ctx.drawImage(video, dx, dy, dw, dh);
  }

  private async generateThumbnail(blob: Blob): Promise<string> {
    const video = document.createElement('video');
    video.muted       = true;
    video.playsInline = true;
    video.preload     = 'auto';
    const url = URL.createObjectURL(blob);

    try {
      video.src = url;
      await new Promise<void>((resolve, reject) => {
        video.addEventListener('loadedmetadata', () => resolve(), { once: true });
        video.addEventListener('error',          () => reject(new Error('thumb load')), { once: true });
      });
      const duration = isFinite(video.duration) ? video.duration : 0;
      const target   = duration > 2 ? Math.min(duration * 0.1, 3) : 0;

      video.currentTime = target;
      await new Promise<void>((resolve) => {
        video.addEventListener('seeked', () => resolve(), { once: true });
      });

      const canvas = document.createElement('canvas');
      canvas.width  = video.videoWidth  || 640;
      canvas.height = video.videoHeight || 360;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('thumb ctx');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const thumbBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.82),
      );
      if (!thumbBlob) throw new Error('thumb encode');
      return URL.createObjectURL(thumbBlob);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private detectMimeType(): string {
    // Try mp4 first (iOS Safari + Chromium 121+ support it); webm is the
    // cross-browser fallback. The output attachment extension follows the
    // final mime so the backend's Multer filter accepts either.
    const candidates = [
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    return candidates.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
  }

  private waitForStop(recorder: MediaRecorder): Promise<void> {
    return new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
    });
  }

  private safeStop(recorder: MediaRecorder): void {
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch { /* ignore */ }
  }

  private cleanupActive(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.activeObjectUrls.forEach(u => {
      try { URL.revokeObjectURL(u); } catch { /* ignore */ }
    });
    this.activeObjectUrls = [];
    if (this.activeVideoEl) {
      try {
        this.activeVideoEl.pause();
        this.activeVideoEl.removeAttribute('src');
        this.activeVideoEl.load();
        this.activeVideoEl.remove();
      } catch { /* ignore */ }
      this.activeVideoEl = null;
    }
    if (this.activeKeepAlive) {
      try { this.activeKeepAlive.stop(); } catch { /* ignore */ }
      this.activeKeepAlive = null;
    }
    if (this.activeAudioCtx) {
      this.activeAudioCtx.close().catch(() => { /* ignore */ });
      this.activeAudioCtx = null;
    }
    this.activeRecorder = null;
  }

  /**
   * Patch the Duration element in a WebM container so players know the total
   * length and can seek. MediaRecorder leaves it at 0; we overwrite it with
   * the actual duration in milliseconds (matching the default TimecodeScale
   * of 1 000 000 ns = 1 ms per unit used by Chrome's MediaRecorder).
   *
   * Only touches WebM blobs; MP4 fMP4 output is already seekable in Chrome.
   * Returns the original blob unchanged on any parse error.
   */
  private async patchWebmDuration(blob: Blob, durationMs: number): Promise<Blob> {
    if (!blob.type.includes('webm')) return blob;
    try {
      const buffer = await blob.arrayBuffer();
      const bytes  = new Uint8Array(buffer);
      const view   = new DataView(buffer);
      // The Duration element (EBML ID 0x44 0x89) lives in the Segment Info
      // section, always within the first few KB. Cap the scan at 64 KB to
      // avoid scanning into encoded video data where these bytes may appear.
      const limit = Math.min(bytes.length - 12, 65536);
      for (let i = 0; i < limit; i++) {
        if (bytes[i] !== 0x44 || bytes[i + 1] !== 0x89) continue;
        const sizeVint = bytes[i + 2];
        if (sizeVint === 0x88) {        // VINT = 8 → 8-byte float64
          view.setFloat64(i + 3, durationMs, false);
          return new Blob([buffer], { type: blob.type });
        }
        if (sizeVint === 0x84) {        // VINT = 4 → 4-byte float32
          view.setFloat32(i + 3, durationMs, false);
          return new Blob([buffer], { type: blob.type });
        }
      }
    } catch { /* fall through */ }
    return blob;
  }

  private fail(code: CompilationError['code'], message: string, original?: unknown): void {
    this._error.set({ code, message, original });
    this._state.set('error');
  }

  private emptyProgress(): CompilationProgress {
    return {
      percent:              0,
      currentIndex:         0,
      totalCount:           0,
      currentLabel:         '',
      elapsedMs:            0,
      estimatedRemainingMs: 0,
    };
  }

  private labelFor(clip: QuestionRecording): string {
    const n = clip.questionIndex + 1;
    const text = clip.questionText?.length > 40
      ? clip.questionText.slice(0, 40).trim() + '…'
      : clip.questionText ?? '';
    return text ? `Q${n} — ${text}` : `Clip ${n}`;
  }
}

class CancelError extends Error {
  constructor() { super('canceled'); this.name = 'CancelError'; }
}

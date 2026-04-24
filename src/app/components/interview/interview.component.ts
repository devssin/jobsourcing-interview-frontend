import {
  AfterViewInit,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  OnDestroy,
  signal,
  ViewChild,
} from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';
import { SlicePipe } from '@angular/common';
import { Router } from '@angular/router';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';

import { InterviewProgressService } from '../../services/interview-progress.service';
import { CameraService } from '../../services/camera.service';
import { VideoRecordingService } from '../../services/video-recording.service';
import { RecordingStoreService } from '../../services/recording-store.service';
import { QuestionService } from '../../services/question.service';
import { LoadingSpinnerComponent } from '../shared/loading-spinner/loading-spinner.component';
import { ProgressBarComponent } from '../shared/progress-bar/progress-bar.component';
import { RecordingResult, SubQuestion } from '../../models';

@Component({
  selector: 'app-interview',
  standalone: true,
  imports: [SlicePipe, LoadingSpinnerComponent, ProgressBarComponent],
  templateUrl: './interview.component.html',
  animations: [
    trigger('questionEnter', [
      transition('* => *', [
        style({ opacity: 0, transform: 'translateX(12px)' }),
        animate('200ms cubic-bezier(0.4, 0, 0.2, 1)',
                style({ opacity: 1, transform: 'translateX(0)' })),
      ]),
    ]),
  ],
})
export class InterviewComponent implements AfterViewInit, OnDestroy {
  @ViewChild('liveEl', { static: true })
  private readonly liveEl?: ElementRef<HTMLVideoElement>;

  // Setter fires when @if(inReview()) renders the element.
  // Bypass [src] binding (sanitizes blob: → "unsafe:…") by setting DOM property directly.
  @ViewChild('reviewEl') set reviewEl(el: ElementRef<HTMLVideoElement> | undefined) {
    if (el?.nativeElement) {
      const video = el.nativeElement;
      video.src = this.reviewObjectUrl() ?? '';
      video.load();
    }
  }

  private readonly camera     = inject(CameraService);
  private readonly recorder   = inject(VideoRecordingService);
  private readonly progress   = inject(InterviewProgressService);
  private readonly router     = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly store              = inject(RecordingStoreService);
  readonly questions          = inject(QuestionService);

  readonly cameraReady = this.camera.isStreaming;
  readonly cameraError = computed(() => this.camera.error() !== null);

  readonly isRecording = this.recorder.isRecording;
  readonly isPaused    = this.recorder.isPaused;
  readonly recError    = this.recorder.error;

  readonly timeRemaining = signal(0);
  readonly timePercent   = computed(() => {
    const max = this.currentDuration();
    if (max === 0) return 0;
    return Math.round(((max - this.timeRemaining()) / max) * 100);
  });
  readonly timerColor = computed(() =>
    this.timeRemaining() < 20 ? 'red' : this.timeRemaining() < 45 ? 'amber' : 'blue',
  );

  /** Duration in seconds for the currently active question/sub-question. */
  readonly currentDuration = computed(() => {
    if (this.questions.isOnSubQuestion()) {
      return this.questions.activeSubQuestion()?.duration ?? 120;
    }
    return this.questions.currentMainQuestion()?.duration ?? 180;
  });

  readonly reviewObjectUrl = signal<string | null>(null);
  readonly inReview        = computed(() => this.reviewObjectUrl() !== null);

  readonly currentResultSize       = computed(() => this.recorder.result()?.sizeBytes ?? 0);
  readonly currentResultDurationMs = computed(() => this.recorder.result()?.durationMs ?? 0);

  /** Whole-interview completion ratio, driven by saved-answer count. */
  readonly overallProgressPercent = computed(() => {
    const total = this.questions.progress().totalMain;
    if (total === 0) return 0;
    return Math.min(100, Math.round((this.store.count() / total) * 100));
  });

  /** Live elapsed-recording time (seconds), exposed for template readout. */
  readonly elapsedSeconds = this.recorder.duration;

  // ── Confirmation dialog ────────────────────────────────────────────────────
  readonly showConfirmDialog = signal(false);
  readonly confirmKind       = signal<'next' | 'submit' | 'back'>('next');

  // ── Navigation ─────────────────────────────────────────────────────────────

  /** Used as the `@questionEnter` animation state — re-fires whenever it changes. */
  readonly questionKey = computed(() => {
    if (this.questions.hasPendingSubSelection()) {
      return `${this.questions.currentMainQuestion().id}:select`;
    }
    if (this.questions.isOnSubQuestion()) {
      return this.questions.activeSubQuestion()?.id ?? '';
    }
    return this.questions.currentMainQuestion().id;
  });

  /** Previous button availability — blocked mid-recording / review / save. */
  readonly canGoBack = computed(() => {
    if (this.isRecording() || this.isPaused()) return false;
    if (this.inReview())                       return false;
    if (this.store.isSaving())                 return false;
    const p = this.questions.progress();
    return (
      p.mainIndex > 0 ||
      this.questions.isOnSubQuestion() ||
      this.questions.hasPendingSubSelection()
    );
  });

  /** True whenever leaving would discard in-flight work. */
  readonly hasUnsavedWork = computed(
    () => this.isRecording() || this.isPaused() || this.inReview(),
  );

  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    toObservable(this.recorder.result)
      .pipe(
        filter((r): r is RecordingResult => r !== null),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(result => this.enterReview(result));
  }

  async ngAfterViewInit(): Promise<void> {
    this.store.clearAll();
    this.questions.validate();
    this.resetTimer();

    const stream = await this.camera.startStream();
    if (stream) {
      const el = this.liveEl?.nativeElement;
      if (el) this.camera.attachToVideo(el);
    }
  }

  // ── Recording controls ────────────────────────────────────────────────────

  startRecording(): void {
    const stream = this.camera.stream();
    if (!stream) return;

    // Hand the recorder a fresh stream with exactly one video + one audio track.
    // If the OS surfaces the mic as multiple tracks (e.g. Stereo Mix on Windows),
    // leaving them all attached results in duplicated/echoing audio in the file.
    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];
    const recordStream = new MediaStream();
    if (videoTrack) recordStream.addTrack(videoTrack);
    if (audioTrack) recordStream.addTrack(audioTrack);

    this.recorder.reset();
    this.resetTimer();
    this.recorder.start(recordStream, { timeslice: 500 });
    this.startCountdown();
  }

  stopRecording(): void {
    this.clearCountdown();
    this.recorder.stop();
  }

  togglePause(): void {
    if (this.recorder.isPaused()) {
      this.recorder.resume();
      this.startCountdown();
    } else {
      this.recorder.pause();
      this.clearCountdown();
    }
  }

  retake(): void {
    this.revokeReviewUrl();
    this.recorder.reset();
    this.resetTimer();
  }

  /**
   * Reset after a failed recording and try again. If the camera stream was
   * lost in the process, re-acquire it before kicking off a new capture.
   */
  async retryRecording(): Promise<void> {
    this.clearCountdown();
    this.recorder.reset();

    let stream = this.camera.stream();
    if (!stream) {
      stream = await this.camera.startStream();
      const el = this.liveEl?.nativeElement;
      if (stream && el) this.camera.attachToVideo(el);
    }
    if (!stream) return;

    this.startRecording();
  }

  // ── Confirm-before-advance ────────────────────────────────────────────────

  /** Opens the confirmation dialog before accepting the current recording. */
  requestAccept(): void {
    if (this.store.isSaving()) return;
    this.confirmKind.set(
      this.questions.isLastMainQuestion() && !this.questions.isOnSubQuestion()
        ? 'submit'
        : 'next',
    );
    this.showConfirmDialog.set(true);
  }

  /** Opens the confirmation dialog before navigating back a question. */
  requestGoBack(): void {
    if (!this.canGoBack()) return;
    this.confirmKind.set('back');
    this.showConfirmDialog.set(true);
  }

  async confirmAccept(): Promise<void> {
    const kind = this.confirmKind();
    this.showConfirmDialog.set(false);
    if (kind === 'back') {
      this.performGoBack();
      return;
    }
    await this.acceptRecording();
  }

  cancelAccept(): void {
    this.showConfirmDialog.set(false);
  }

  private performGoBack(): void {
    this.clearCountdown();
    this.recorder.reset();
    this.revokeReviewUrl();
    this.questions.goBack();
    this.resetTimer();
  }

  // ── Browser navigation guard ──────────────────────────────────────────────

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.hasUnsavedWork()) return;
    // Modern browsers ignore the message string but require a truthy
    // returnValue + a canceled event to surface the native prompt.
    event.preventDefault();
    event.returnValue = '';
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  //   Space  → toggle record / stop
  //   Enter  → stop if currently recording (submits confirm dialog when open)
  //   Esc    → cancel confirm dialog

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const tag    = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (target?.isContentEditable) return;

    // Dialog owns the keyboard while it's open.
    if (this.showConfirmDialog()) {
      if (event.key === 'Enter')  { event.preventDefault(); void this.confirmAccept(); }
      if (event.key === 'Escape') { event.preventDefault(); this.cancelAccept(); }
      return;
    }

    // Never intercept shortcuts during review/sub-selection — let buttons work normally.
    if (this.inReview() || this.questions.hasPendingSubSelection()) return;

    if (event.code === 'Space') {
      event.preventDefault();
      if (this.isRecording() || this.isPaused()) {
        this.stopRecording();
      } else if (this.cameraReady()) {
        this.startRecording();
      }
    } else if (event.key === 'Enter') {
      if (this.isRecording() || this.isPaused()) {
        event.preventDefault();
        this.stopRecording();
      }
    }
  }

  async acceptRecording(): Promise<void> {
    const result = this.recorder.result();
    const q      = this.questions.currentMainQuestion();
    if (!q) return;

    const isSubAnswer = this.questions.isOnSubQuestion();
    const sub         = this.questions.activeSubQuestion();

    if (result) {
      await this.store.saveRecording(result, {
        questionId:    isSubAnswer && sub ? sub.id : q.id,
        questionIndex: this.questions.progress().mainIndex,
        questionText:  isSubAnswer && sub ? sub.text : q.text,
      });
    }

    this.revokeReviewUrl();
    this.recorder.reset();

    if (isSubAnswer) {
      this.questions.afterSubAnswered();
    } else {
      this.questions.afterMainAnswered();
    }

    if (this.questions.isDone()) {
      this.finishInterview();
      return;
    }

    this.resetTimer();
  }

  // ── Sub-question selection ────────────────────────────────────────────────

  selectSubQuestion(sub: SubQuestion): void {
    this.questions.selectSubQuestion(sub);
    this.resetTimer();
  }

  skipSubQuestions(): void {
    this.questions.skipSubQuestions();
    this.resetTimer();
  }

  // ── Finish ────────────────────────────────────────────────────────────────

  finishInterview(): void {
    this.clearCountdown();
    this.recorder.reset();
    this.revokeReviewUrl();
    this.progress.completeInterview();
    this.router.navigate(['/complete']);
  }

  // ── Formatting helpers ────────────────────────────────────────────────────

  formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private enterReview(result: RecordingResult): void {
    if (this.inReview()) return;
    const url = URL.createObjectURL(result.blob);
    this.reviewObjectUrl.set(url);
  }

  private revokeReviewUrl(): void {
    const url = this.reviewObjectUrl();
    if (!url) return;
    // Set signal to null FIRST so Angular unmounts the <video #reviewEl> in
    // this change-detection pass; only then revoke the URL. Revoking while the
    // element still holds `src=blob:…` causes devtools to log ERR_FILE_NOT_FOUND
    // when the browser tries to abort the load on unmount.
    this.reviewObjectUrl.set(null);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private resetTimer(): void {
    this.timeRemaining.set(this.currentDuration());
  }

  private startCountdown(): void {
    this.clearCountdown();
    this.countdownTimer = setInterval(() => {
      this.timeRemaining.update(t => {
        if (t <= 1) {
          this.stopRecording();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
  }

  private clearCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  ngOnDestroy(): void {
    this.clearCountdown();
    this.recorder.reset();
    this.revokeReviewUrl();
    this.camera.stopStream();
  }
}

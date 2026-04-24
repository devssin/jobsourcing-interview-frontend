import { AsyncPipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { InterviewProgressService } from '../../services/interview-progress.service';
import { RecordingStoreService } from '../../services/recording-store.service';
import { VideoCompilationService } from '../../services/video-compilation.service';
import { EmailService } from '../../services/email.service';
import { ProgressBarComponent } from '../shared/progress-bar/progress-bar.component';
import { LoadingSpinnerComponent } from '../shared/loading-spinner/loading-spinner.component';

type SubmissionPhase = 'idle' | 'compiling' | 'sending' | 'sent' | 'error';

@Component({
  selector: 'app-complete',
  standalone: true,
  imports: [AsyncPipe, ProgressBarComponent, LoadingSpinnerComponent],
  templateUrl: './complete.component.html',
})
export class CompleteComponent implements OnInit {
  private readonly progress   = inject(InterviewProgressService);
  private readonly router     = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly store    = inject(RecordingStoreService);
  readonly compiler = inject(VideoCompilationService);
  readonly emailer  = inject(EmailService);

  readonly candidateName  = signal('');
  readonly candidateEmail = signal('');

  readonly phase       = signal<SubmissionPhase>('idle');
  readonly phaseError  = signal<string | null>(null);

  readonly uploadPercent$ = this.emailer.uploadProgress$;

  readonly compilationPercent = computed(() => this.compiler.progress().percent);

  readonly summary = [
    { label: 'Identity verification completed' },
    { label: 'Camera and microphone permissions granted' },
    { label: 'All interview questions answered' },
    { label: 'Responses securely recorded and encrypted' },
  ];

  private sendSub: Subscription | null = null;

  ngOnInit(): void {
    if (this.store.count() > 0 && this.phase() === 'idle') {
      void this.runPipeline();
    }
    this.destroyRef.onDestroy(() => this.sendSub?.unsubscribe());
  }

  async runPipeline(): Promise<void> {
    this.phaseError.set(null);
    this.phase.set('compiling');
    this.compiler.reset();

    // Prefer mp4; service falls back to webm where mp4 isn't recordable.
    await this.compiler.compile(this.store.getAll(), {
      mimeType: 'video/mp4;codecs=avc1,mp4a.40.2',
    });

    const result = this.compiler.result();
    if (!result) {
      const msg = this.compiler.error()?.message ?? 'Échec de la compilation';
      this.phase.set('error');
      this.phaseError.set(msg);
      return;
    }

    this.phase.set('sending');
    try {
      const fd = this.emailer.prepareEmailPayload(
        result.blob,
        {
          name:  this.candidateName().trim()  || 'Candidat',
          email: this.candidateEmail().trim() || undefined,
        },
        {
          questionCount:   this.store.count(),
          videoDurationMs: result.durationMs,
        },
      );

      await new Promise<void>((resolve, reject) => {
        this.sendSub = this.emailer.sendVideoEmail(fd).subscribe({
          next:  (r) => (r.success ? resolve() : reject(new Error(r.message))),
          error: (e) => reject(e instanceof Error ? e : new Error(e?.message ?? "Erreur lors de l'envoi de l'email")),
        });
      });

      this.phase.set('sent');
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur lors de l'envoi de l'email";
      this.phase.set('error');
      this.phaseError.set(msg);
    }
  }

  /** Retry the failed step only: compile if missing, otherwise just re-send. */
  retry(): void {
    if (!this.compiler.result()) {
      void this.runPipeline();
      return;
    }
    this.phase.set('sending');
    this.phaseError.set(null);
    void this.runSendOnly();
  }

  private async runSendOnly(): Promise<void> {
    const result = this.compiler.result();
    if (!result) return;
    try {
      const fd = this.emailer.prepareEmailPayload(
        result.blob,
        { name: this.candidateName().trim() || 'Candidat', email: this.candidateEmail().trim() || undefined },
        { questionCount: this.store.count(), videoDurationMs: result.durationMs },
      );
      await new Promise<void>((resolve, reject) => {
        this.sendSub = this.emailer.sendVideoEmail(fd).subscribe({
          next:  (r) => (r.success ? resolve() : reject(new Error(r.message))),
          error: (e) => reject(e instanceof Error ? e : new Error(e?.message ?? "Erreur lors de l'envoi de l'email")),
        });
      });
      this.phase.set('sent');
    } catch (err) {
      this.phase.set('error');
      this.phaseError.set(err instanceof Error ? err.message : "Erreur lors de l'envoi de l'email");
    }
  }

  downloadCompiled(): void {
    const r = this.compiler.result();
    if (!r) return;
    const url = URL.createObjectURL(r.blob);
    const ext = r.mimeType.includes('mp4') ? 'mp4' : 'webm';
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `interview-${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Let the browser finish the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  startOver(): void {
    this.compiler.reset();
    this.emailer.reset();
    this.store.clearAll();
    this.progress.reset();
    this.router.navigate(['/welcome']);
  }
}

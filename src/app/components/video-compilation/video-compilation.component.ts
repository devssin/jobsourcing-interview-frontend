import {
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { VideoCompilationService } from '../../services/video-compilation.service';
import { RecordingStoreService } from '../../services/recording-store.service';
import { ProgressBarComponent } from '../shared/progress-bar/progress-bar.component';
import { LoadingSpinnerComponent } from '../shared/loading-spinner/loading-spinner.component';

@Component({
  selector: 'app-video-compilation',
  standalone: true,
  imports: [ProgressBarComponent, LoadingSpinnerComponent],
  templateUrl: './video-compilation.component.html',
})
export class VideoCompilationComponent {
  readonly open   = input(false);
  readonly closed = output<void>();

  readonly compiler = inject(VideoCompilationService);
  readonly store    = inject(RecordingStoreService);

  private readonly destroyRef = inject(DestroyRef);

  /** Object URL cached for <video>.src + download href. Revoked on reset/destroy. */
  private previewObjectUrl: string | null = null;
  private previewBlob: Blob | null = null;

  // Setter fires when @if(result()) renders the <video>. Pull a fresh URL
  // synchronously — avoids any race with async effects.
  @ViewChild('previewEl') set previewEl(el: ElementRef<HTMLVideoElement> | undefined) {
    if (!el?.nativeElement) return;
    const url = this.ensurePreviewUrl();
    if (url) {
      el.nativeElement.src = url;
      el.nativeElement.load();
    }
  }

  readonly state    = this.compiler.state;
  readonly progress = this.compiler.progress;
  readonly result   = this.compiler.result;
  readonly error    = this.compiler.error;
  readonly isActive = this.compiler.isActive;

  readonly totalRecordings = computed(() => this.store.count());

  readonly etaLabel = computed(() => {
    const ms = this.progress().estimatedRemainingMs;
    if (!this.isActive() || ms <= 0) return '';
    const s = Math.ceil(ms / 1000);
    if (s < 60) return `~${s}s remaining`;
    const m    = Math.floor(s / 60);
    const rest = s % 60;
    return rest === 0 ? `~${m}m remaining` : `~${m}m ${rest}s remaining`;
  });

  readonly elapsedLabel = computed(() => {
    const ms = this.progress().elapsedMs;
    if (ms <= 0) return '00:00';
    return this.compiler.formatDuration(ms);
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.revokePreviewUrl());
  }

  async start(): Promise<void> {
    if (this.isActive()) return;
    this.revokePreviewUrl();
    this.compiler.reset();
    await this.compiler.compile(this.store.getAll());
  }

  cancel(): void {
    this.compiler.cancel();
  }

  restart(): void {
    void this.start();
  }

  download(): void {
    const r = this.result();
    if (!r) return;
    const url = this.ensurePreviewUrl();
    if (!url) return;
    const ext = this.extensionFor(r.mimeType);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `interview-${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  close(): void {
    if (this.isActive()) return; // guard: never close mid-compile
    this.revokePreviewUrl();
    this.compiler.reset();
    this.closed.emit();
  }

  private ensurePreviewUrl(): string | null {
    const r = this.result();
    if (!r) {
      this.revokePreviewUrl();
      return null;
    }
    if (this.previewObjectUrl && this.previewBlob === r.blob) {
      return this.previewObjectUrl;
    }
    this.revokePreviewUrl();
    this.previewBlob      = r.blob;
    this.previewObjectUrl = URL.createObjectURL(r.blob);
    return this.previewObjectUrl;
  }

  private revokePreviewUrl(): void {
    if (this.previewObjectUrl) {
      try { URL.revokeObjectURL(this.previewObjectUrl); } catch { /* ignore */ }
      this.previewObjectUrl = null;
      this.previewBlob      = null;
    }
  }

  private extensionFor(mimeType: string): string {
    if (mimeType.includes('mp4')) return 'mp4';
    return 'webm';
  }
}

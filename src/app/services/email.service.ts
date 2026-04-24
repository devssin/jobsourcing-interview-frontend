import { inject, Injectable } from '@angular/core';
import {
  HttpClient,
  HttpErrorResponse,
  HttpEvent,
  HttpEventType,
  HttpResponse,
} from '@angular/common/http';
import { BehaviorSubject, Observable, throwError } from 'rxjs';
import { catchError, filter, map, tap } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import {
  CandidateInfo,
  EmailResponse,
  EmailStatus,
  InterviewEmailMeta,
} from '../models';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
const ENDPOINT_PATH    = '/api/send-interview-email';

/** French-language error copy, centralised so callers can reuse. */
export const EMAIL_ERRORS = {
  NETWORK:     'Impossible de se connecter au serveur',
  GENERIC:     "Erreur lors de l'envoi de l'email",
  TOO_LARGE:   'Fichier trop volumineux (max 50MB)',
} as const;

@Injectable({ providedIn: 'root' })
export class EmailService {
  private readonly http = inject(HttpClient);

  private readonly endpoint       = `${environment.apiUrl}${ENDPOINT_PATH}`;
  private readonly recipientEmail = environment.recipientEmail;

  /** 0–100 upload progress. Pushed on every HttpEventType.UploadProgress event. */
  readonly uploadProgress$ = new BehaviorSubject<number>(0);

  /** High-level state machine for UI binding. */
  readonly status$ = new BehaviorSubject<EmailStatus>('preparing');

  /** Last error message (French), or null. */
  readonly error$ = new BehaviorSubject<string | null>(null);

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Build the multipart FormData for sending to the backend. Converts the
   * compiled video blob to a named File. Throws when the payload exceeds the
   * server-side limit so callers can show a localised message without firing
   * a wasted request.
   */
  prepareEmailPayload(
    videoBlob: Blob,
    candidateInfo: CandidateInfo,
    meta: InterviewEmailMeta = { questionCount: 0, videoDurationMs: 0 },
  ): FormData {
    this.status$.next('preparing');
    this.error$.next(null);
    this.uploadProgress$.next(0);

    if (videoBlob.size > MAX_UPLOAD_BYTES) {
      this.status$.next('failed');
      this.error$.next(EMAIL_ERRORS.TOO_LARGE);
      throw new Error(EMAIL_ERRORS.TOO_LARGE);
    }

    const ext          = this.extensionFor(videoBlob.type);
    const normalizedType = ext === 'mp4' ? 'video/mp4' : 'video/webm';
    const safeName     = this.slugify(candidateInfo.name) || 'candidate';
    const filename     = `interview-${safeName}-${Date.now()}.${ext}`;
    const file         = new File([videoBlob], filename, { type: normalizedType });

    const interviewDate = (meta.interviewDate ?? new Date()).toISOString();

    const fd = new FormData();
    fd.append('videoFile',     file);
    fd.append('candidateName', candidateInfo.name);
    if (candidateInfo.email) fd.append('candidateEmail', candidateInfo.email);
    if (candidateInfo.phone) fd.append('candidatePhone', candidateInfo.phone);
    fd.append('interviewDate',   interviewDate);
    fd.append('questionCount',   String(meta.questionCount));
    fd.append('videoDuration',   String(meta.videoDurationMs));
    fd.append('recipientEmail',  this.recipientEmail);
    return fd;
  }

  /**
   * POST the FormData to the configured endpoint with `reportProgress: true`
   * so upload events feed `uploadProgress$`. Emits a single `EmailResponse`
   * when the final HTTP response lands; errors are mapped to French strings.
   */
  sendVideoEmail(formData: FormData): Observable<EmailResponse> {
    this.uploadProgress$.next(0);
    this.status$.next('uploading');
    this.error$.next(null);

    return this.http
      .post<EmailResponse>(this.endpoint, formData, {
        reportProgress: true,
        observe:        'events',
      })
      .pipe(
        tap((event: HttpEvent<EmailResponse>) => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
            this.uploadProgress$.next(percent);
            // Once bytes are fully uploaded, the server is doing the sending.
            if (percent >= 100 && this.status$.value === 'uploading') {
              this.status$.next('sending');
            }
          }
        }),
        filter((event: HttpEvent<EmailResponse>) => event.type === HttpEventType.Response),
        map((event) => (event as HttpResponse<EmailResponse>).body ?? { success: false, message: '' }),
        tap((body) => {
          if (body.success) {
            this.uploadProgress$.next(100);
            this.status$.next('sent');
          } else {
            this.status$.next('failed');
            this.error$.next(body.message || EMAIL_ERRORS.GENERIC);
          }
        }),
        catchError((err: HttpErrorResponse) => {
          const message = this.mapError(err);
          this.status$.next('failed');
          this.error$.next(message);
          return throwError(() => ({ success: false, message }) satisfies EmailResponse);
        }),
      );
  }

  /** Reset progress / status / error — call before re-attempting a send. */
  reset(): void {
    this.uploadProgress$.next(0);
    this.status$.next('preparing');
    this.error$.next(null);
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private mapError(err: HttpErrorResponse): string {
    // Network-level / CORS / DNS — no response reached the client.
    if (err.status === 0) return EMAIL_ERRORS.NETWORK;

    // Server refused an oversized payload.
    if (err.status === 413) return EMAIL_ERRORS.TOO_LARGE;

    // Prefer a server-provided message when present (some backends return
    // { message: 'Trop volumineux' } under specific codes).
    const serverMessage =
      (err.error as { message?: string } | null)?.message?.trim?.();
    return serverMessage || EMAIL_ERRORS.GENERIC;
  }

  private extensionFor(mimeType: string): string {
    if (!mimeType)                return 'webm';
    if (mimeType.includes('mp4')) return 'mp4';
    return 'webm';
  }

  private slugify(input: string): string {
    return input
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  }
}

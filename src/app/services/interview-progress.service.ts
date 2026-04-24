import { computed, Injectable, signal } from '@angular/core';

export type InterviewStep = 'welcome' | 'permissions' | 'interview' | 'complete';

@Injectable({ providedIn: 'root' })
export class InterviewProgressService {
  private readonly _welcomeCompleted   = signal(false);
  private readonly _permissionsGranted = signal(false);
  private readonly _interviewCompleted = signal(false);

  readonly welcomeCompleted   = this._welcomeCompleted.asReadonly();
  readonly permissionsGranted = this._permissionsGranted.asReadonly();
  readonly interviewCompleted = this._interviewCompleted.asReadonly();

  /**
   * Index of the next step to complete (0–3).
   * Used as the animation trigger value — incrementing = forward, decrementing = back.
   */
  readonly stepIndex = computed<number>(() => {
    if (this._interviewCompleted()) return 3;
    if (this._permissionsGranted()) return 2;
    if (this._welcomeCompleted())   return 1;
    return 0;
  });

  readonly currentStep = computed<InterviewStep>(() => {
    const steps: InterviewStep[] = ['welcome', 'permissions', 'interview', 'complete'];
    return steps[this.stepIndex()];
  });

  completeWelcome(): void   { this._welcomeCompleted.set(true); }
  grantPermissions(): void  { this._permissionsGranted.set(true); }
  completeInterview(): void { this._interviewCompleted.set(true); }

  reset(): void {
    this._welcomeCompleted.set(false);
    this._permissionsGranted.set(false);
    this._interviewCompleted.set(false);
  }
}

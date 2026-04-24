import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { InterviewProgressService } from '../services/interview-progress.service';

/**
 * Enforces the linear interview flow.
 * Each step requires all previous steps to be completed.
 */
export const interviewFlowGuard: CanActivateFn = (route) => {
  const progress = inject(InterviewProgressService);
  const router   = inject(Router);

  switch (route.routeConfig?.path) {
    case 'permissions':
      return progress.welcomeCompleted()   || router.createUrlTree(['/welcome']);
    case 'interview':
      if (!progress.permissionsGranted()) return router.createUrlTree(['/permissions']);
      if (progress.interviewCompleted())  return router.createUrlTree(['/complete']);
      return true;
    case 'complete':
      return progress.interviewCompleted() || router.createUrlTree(['/interview']);
    default:
      return true;
  }
};

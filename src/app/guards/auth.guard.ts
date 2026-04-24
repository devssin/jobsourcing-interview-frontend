import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

/**
 * Protects routes that require an authenticated user.
 * Replace the `isAuthenticated` stub with a real AuthService check.
 */
export const authGuard: CanActivateFn = (_route, _state) => {
  const router = inject(Router);
  // TODO: replace with inject(AuthService).isAuthenticated()
  const isAuthenticated = false;
  return isAuthenticated ? true : router.createUrlTree(['/home']);
};

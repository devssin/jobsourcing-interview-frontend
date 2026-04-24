import { Routes } from '@angular/router';
import { LayoutComponent } from './components/layout/layout.component';
import { interviewFlowGuard } from './guards';

export const routes: Routes = [
  {
    path: '',
    component: LayoutComponent,
    children: [
      { path: '', redirectTo: 'welcome', pathMatch: 'full' },
      {
        path: 'welcome',
        loadComponent: () =>
          import('./components/welcome/welcome.component').then(m => m.WelcomeComponent),
      },
      {
        path: 'permissions',
        canActivate: [interviewFlowGuard],
        loadComponent: () =>
          import('./components/permissions/permissions.component').then(m => m.PermissionsComponent),
      },
      {
        path: 'interview',
        canActivate: [interviewFlowGuard],
        loadComponent: () =>
          import('./components/interview/interview.component').then(m => m.InterviewComponent),
      },
      {
        path: 'complete',
        canActivate: [interviewFlowGuard],
        loadComponent: () =>
          import('./components/complete/complete.component').then(m => m.CompleteComponent),
      },
      { path: '**', redirectTo: 'welcome' },
    ],
  },
];

import { computed, Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { animate, query, style, transition, trigger } from '@angular/animations';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';

import { ThemeToggleComponent } from '../theme-toggle/theme-toggle.component';
import { InterviewProgressService } from '../../services/interview-progress.service';

const STEP_PATHS = ['welcome', 'permissions', 'interview', 'complete'] as const;

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterOutlet, ThemeToggleComponent],
  templateUrl: './layout.component.html',
  animations: [
    trigger('routeAnimations', [
      // Forward (step index increases)
      transition(':increment', [
        query(':enter', [
          style({ opacity: 0, transform: 'translateX(32px)' }),
          animate('280ms cubic-bezier(0.4, 0, 0.2, 1)', style({ opacity: 1, transform: 'translateX(0)' })),
        ], { optional: true }),
      ]),
      // Backward (step index decreases)
      transition(':decrement', [
        query(':enter', [
          style({ opacity: 0, transform: 'translateX(-32px)' }),
          animate('280ms cubic-bezier(0.4, 0, 0.2, 1)', style({ opacity: 1, transform: 'translateX(0)' })),
        ], { optional: true }),
      ]),
    ]),
  ],
})
export class LayoutComponent {
  protected readonly progress = inject(InterviewProgressService);
  private  readonly router   = inject(Router);

  readonly steps = [
    { path: 'welcome',     label: 'Welcome' },
    { path: 'permissions', label: 'Permissions' },
    { path: 'interview',   label: 'Interview' },
    { path: 'complete',    label: 'Complete' },
  ];

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(e => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
  );

  readonly activeStepIndex = computed(() => {
    const url = this.currentUrl() ?? '';
    const idx = STEP_PATHS.findIndex(p => url.includes('/' + p));
    return idx === -1 ? 0 : idx;
  });

  isCompleted(index: number): boolean { return this.progress.stepIndex() > index; }
  isActive(index: number):    boolean { return this.activeStepIndex() === index; }
}

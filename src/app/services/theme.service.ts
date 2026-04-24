import { computed, effect, Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ThemeMode } from '../models';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private static readonly STORAGE_KEY = 'theme';

  private readonly _mode = signal<ThemeMode>(this.resolveInitial());

  /** Current theme mode as a signal — read in templates with `themeService.mode()` */
  readonly mode = this._mode.asReadonly();

  readonly isDark = computed(() => this._mode() === 'dark');

  /** Observable for components that prefer RxJS (e.g. with `async` pipe) */
  readonly theme$ = toObservable(this._mode);
  readonly isDark$ = toObservable(this.isDark);

  constructor() {
    effect(() => {
      document.documentElement.classList.toggle('dark', this.isDark());
      localStorage.setItem(ThemeService.STORAGE_KEY, this._mode());
    });
  }

  toggle(): void {
    this._mode.update(m => (m === 'dark' ? 'light' : 'dark'));
  }

  setMode(mode: ThemeMode): void {
    this._mode.set(mode);
  }

  private resolveInitial(): ThemeMode {
    const stored = localStorage.getItem(ThemeService.STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
}

import { Component, input, output, signal } from '@angular/core';

@Component({
  selector: 'app-error-message',
  standalone: true,
  template: `
    @if (!dismissed()) {
      <div
        role="alert"
        class="flex items-start gap-3 rounded-lg border p-4 transition-colors duration-200
               bg-red-50 dark:bg-red-900/20
               border-red-200 dark:border-red-800">

        <!-- Icon -->
        <svg xmlns="http://www.w3.org/2000/svg"
             class="h-5 w-5 shrink-0 mt-0.5 text-red-600 dark:text-red-400"
             viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fill-rule="evenodd"
                d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z"
                clip-rule="evenodd"/>
        </svg>

        <!-- Content -->
        <div class="flex-1 min-w-0">
          @if (title()) {
            <p class="text-sm font-semibold text-red-800 dark:text-red-300 mb-0.5">{{ title() }}</p>
          }
          <p class="text-sm text-red-700 dark:text-red-300">{{ message() }}</p>
        </div>

        <!-- Dismiss button -->
        @if (dismissible()) {
          <button
            (click)="dismiss()"
            class="shrink-0 rounded p-0.5 text-red-500 dark:text-red-400
                   hover:bg-red-100 dark:hover:bg-red-900/40
                   focus:outline-none focus:ring-2 focus:ring-red-500
                   transition-colors duration-200"
            aria-label="Dismiss error">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/>
            </svg>
          </button>
        }
      </div>
    }
  `,
})
export class ErrorMessageComponent {
  readonly message     = input.required<string>();
  readonly title       = input('');
  readonly dismissible = input(false);
  readonly dismissed$  = output<void>();

  protected readonly dismissed = signal(false);

  dismiss(): void {
    this.dismissed.set(true);
    this.dismissed$.emit();
  }
}

import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-progress-bar',
  standalone: true,
  template: `
    <div class="w-full">
      @if (label() || showValue()) {
        <div class="flex items-center justify-between mb-1.5">
          @if (label()) {
            <span class="text-xs font-medium text-gray-600 dark:text-gray-400 transition-colors duration-200">
              {{ label() }}
            </span>
          }
          @if (showValue()) {
            <span class="text-xs font-mono font-medium text-gray-500 dark:text-gray-400 transition-colors duration-200">
              {{ clamped() }}%
            </span>
          }
        </div>
      }

      <div
        class="w-full rounded-full overflow-hidden transition-colors duration-200"
        [class]="trackClass()"
        role="progressbar"
        [attr.aria-valuenow]="clamped()"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-label]="label() || 'Progress'">
        <div
          class="h-full rounded-full transition-all duration-500 ease-out"
          [class]="barClass()"
          [style.width.%]="clamped()">
        </div>
      </div>
    </div>
  `,
})
export class ProgressBarComponent {
  readonly value     = input.required<number>();
  readonly label     = input('');
  readonly showValue = input(false);
  readonly size      = input<'sm' | 'md'>('sm');
  readonly color     = input<'blue' | 'green' | 'red' | 'amber'>('blue');

  readonly clamped = computed(() => Math.min(100, Math.max(0, this.value())));

  readonly trackClass = computed(() =>
    this.size() === 'sm'
      ? 'h-1.5 bg-gray-200 dark:bg-gray-700'
      : 'h-2.5 bg-gray-200 dark:bg-gray-700',
  );

  readonly barClass = computed(() => {
    const colors: Record<string, string> = {
      blue:  'bg-blue-600 dark:bg-blue-500',
      green: 'bg-green-500 dark:bg-green-400',
      red:   'bg-red-500 dark:bg-red-400',
      amber: 'bg-amber-500 dark:bg-amber-400',
    };
    return colors[this.color()];
  });
}

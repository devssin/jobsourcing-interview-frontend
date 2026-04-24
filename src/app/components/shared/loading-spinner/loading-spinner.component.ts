import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-loading-spinner',
  standalone: true,
  template: `
    <div role="status" class="inline-flex flex-col items-center gap-2">
      <svg
        class="animate-spin transition-colors duration-200"
        [class]="svgSizeClass()"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true">
        <circle
          class="opacity-25"
          cx="12" cy="12" r="10"
          stroke="currentColor"
          stroke-width="4">
        </circle>
        <path
          class="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z">
        </path>
      </svg>

      @if (label()) {
        <span class="text-sm font-medium text-gray-500 dark:text-gray-400 transition-colors duration-200">
          {{ label() }}
        </span>
      }

      <span class="sr-only">{{ label() || 'Loading…' }}</span>
    </div>
  `,
  host: { class: 'inline-flex' },
})
export class LoadingSpinnerComponent {
  readonly size  = input<'sm' | 'md' | 'lg'>('md');
  readonly label = input('');
  /** Override the icon color; defaults to blue-600 / dark:blue-400 */
  readonly color = input<'blue' | 'white' | 'gray'>('blue');

  readonly svgSizeClass = computed(() => {
    const sizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' };
    const colors = {
      blue:  'text-blue-600 dark:text-blue-400',
      white: 'text-white',
      gray:  'text-gray-500 dark:text-gray-400',
    };
    return `${sizes[this.size()]} ${colors[this.color()]}`;
  });
}

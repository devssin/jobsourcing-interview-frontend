import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, ThemeToggleComponent],
  template: `
    <div class="min-h-screen bg-white dark:bg-gray-900 transition-colors duration-200">
      <nav class="border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-between items-center">
        <h1 class="text-lg font-bold text-gray-900 dark:text-white">Video Interview App</h1>
        <app-theme-toggle />
      </nav>
      <main class="max-w-2xl mx-auto px-6 py-16 text-center">
        <h2 class="text-4xl font-bold text-gray-900 dark:text-white mb-4">Welcome</h2>
        <p class="text-gray-500 dark:text-gray-400 mb-8">
          Ready to start your interview? Click below to begin.
        </p>
        <a routerLink="/interview"
           class="btn-primary inline-block">
          Start Interview
        </a>
      </main>
    </div>
  `,
})
export class HomeComponent {}

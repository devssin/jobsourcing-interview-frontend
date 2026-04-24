import { Component, inject } from '@angular/core';
import { ThemeService } from '../../services';

@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  templateUrl: './theme-toggle.component.html',
})
export class ThemeToggleComponent {
  protected readonly theme = inject(ThemeService);
}

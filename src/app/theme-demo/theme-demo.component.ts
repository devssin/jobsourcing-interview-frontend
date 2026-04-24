import { Component } from '@angular/core';
import { ThemeToggleComponent } from '../components/theme-toggle/theme-toggle.component';

@Component({
  selector: 'app-theme-demo',
  standalone: true,
  imports: [ThemeToggleComponent],
  templateUrl: './theme-demo.component.html',
})
export class ThemeDemoComponent {}

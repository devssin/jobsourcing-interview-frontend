import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { InterviewProgressService } from '../../services/interview-progress.service';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

@Component({
  selector: 'app-welcome',
  standalone: true,
  templateUrl: './welcome.component.html',
})
export class WelcomeComponent {
  private readonly progress   = inject(InterviewProgressService);
  private readonly router     = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  private readonly installPrompt = signal<BeforeInstallPromptEvent | null>(null);
  private readonly _installed    = signal(false);

  readonly isStandalone = computed(() => this.detectStandalone());
  readonly isIos        = computed(() => this.detectIos());

  /** Hide only when the app is already running as an installed PWA. */
  readonly canInstall = computed(() => !this._installed() && !this.isStandalone());

  readonly showManualHint = signal(false);

  readonly checklist = [
    { label: 'Stable internet connection',   description: 'Ensure a reliable connection for the entire session.' },
    { label: 'Camera and microphone ready',  description: "You'll be prompted to grant access in the next step." },
    { label: 'Quiet environment',            description: 'Minimise background noise and distractions.' },
    { label: 'Identification document',      description: 'Have a valid ID nearby if required.' },
  ];

  constructor() {
    if (typeof window === 'undefined') return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      this.installPrompt.set(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      this._installed.set(true);
      this.installPrompt.set(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    this.destroyRef.onDestroy(() => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    });
  }

  begin(): void {
    this.progress.completeWelcome();
    this.router.navigate(['/permissions']);
  }

  async installApp(): Promise<void> {
    const evt = this.installPrompt();
    if (evt) {
      await evt.prompt();
      const { outcome } = await evt.userChoice;
      if (outcome === 'accepted') this._installed.set(true);
      this.installPrompt.set(null);
      return;
    }
    // Fallback: no native prompt available (iOS Safari, unsupported browsers,
    // or dev mode where the service worker is disabled). Toggle manual steps.
    this.showManualHint.update(v => !v);
  }

  private detectStandalone(): boolean {
    if (typeof window === 'undefined') return false;
    const mq = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
    const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    return mq || iosStandalone;
  }

  private detectIos(): boolean {
    if (typeof window === 'undefined') return false;
    const ua = window.navigator.userAgent;
    const isIosDevice = /iPad|iPhone|iPod/.test(ua);
    const isIpadOs    = ua.includes('Mac') && 'ontouchend' in document;
    return isIosDevice || isIpadOs;
  }
}

import {
  AfterViewInit,
  Component,
  computed,
  ElementRef,
  inject,
  OnDestroy,
  signal,
  ViewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { InterviewProgressService } from '../../services/interview-progress.service';
import { CameraService } from '../../services/camera.service';
import { CameraPermissionStatus } from '../../models/camera.model';
import { LoadingSpinnerComponent } from '../shared/loading-spinner/loading-spinner.component';

type PermissionState = 'idle' | 'checking' | 'granted' | 'denied';

@Component({
  selector: 'app-permissions',
  standalone: true,
  imports: [LoadingSpinnerComponent],
  templateUrl: './permissions.component.html',
})
export class PermissionsComponent implements AfterViewInit, OnDestroy {
  @ViewChild('previewEl', { static: true })
  private readonly previewEl?: ElementRef<HTMLVideoElement>;

  private readonly progress = inject(InterviewProgressService);
  private readonly router   = inject(Router);
  readonly camera           = inject(CameraService);

  private readonly _checking = signal(false);

  readonly permissionState = computed<PermissionState>(() => {
    if (this._checking()) return 'checking';
    if (this.camera.hasPermissions()) return 'granted';
    if (
      this.camera.cameraStatus() === 'denied' ||
      this.camera.micStatus()    === 'denied'
    ) return 'denied';
    return 'idle';
  });

  readonly devices = [
    {
      key: 'camera' as const,
      label: 'Camera',
      iconPath: 'M4.5 4.5a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h8.25a3 3 0 0 0 3-3v-9a3 3 0 0 0-3-3H4.5ZM19.94 18.75l-2.69-2.69V7.94l2.69-2.69c.944-.945 2.56-.276 2.56 1.06v11.38c0 1.336-1.616 2.005-2.56 1.06Z',
    },
    {
      key: 'mic' as const,
      label: 'Microphone',
      iconPath: 'M8.25 4.5a3.75 3.75 0 1 1 7.5 0v8.25a3.75 3.75 0 1 1-7.5 0V4.5ZM6 10.5a.75.75 0 0 1 .75.75v1.5a5.25 5.25 0 1 0 10.5 0v-1.5a.75.75 0 0 1 1.5 0v1.5a6.751 6.751 0 0 1-6 6.709v2.041h3a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1 0-1.5h3v-2.041a6.751 6.751 0 0 1-6-6.709v-1.5A.75.75 0 0 1 6 10.5Z',
    },
  ];

  async ngAfterViewInit(): Promise<void> {
    // Auto-start preview if browser already has permission from a previous session
    if (this.camera.hasPermissions()) {
      void this.startPreview();
    }
  }

  private async startPreview(): Promise<void> {
    await this.camera.startStream({ audioEnabled: false });
    const el = this.previewEl?.nativeElement;
    if (el) this.camera.attachToVideo(el);
  }

  async switchCamera(deviceId: string): Promise<void> {
    await this.camera.switchCamera(deviceId);
    const el = this.previewEl?.nativeElement;
    if (el) this.camera.attachToVideo(el);
  }

  stateLabel(key: 'camera' | 'mic'): string {
    const status: CameraPermissionStatus =
      key === 'camera' ? this.camera.cameraStatus() : this.camera.micStatus();
    const labels: Record<CameraPermissionStatus, string> = {
      granted:     'Access granted',
      denied:      'Access denied',
      prompt:      'Not yet requested',
      unsupported: 'Not supported on this device',
    };
    return labels[status];
  }

  stateColor(key: 'camera' | 'mic') {
    const status: CameraPermissionStatus =
      key === 'camera' ? this.camera.cameraStatus() : this.camera.micStatus();
    if (status === 'granted') {
      return {
        bg:   'bg-green-50 dark:bg-green-900/20',
        icon: 'text-green-600 dark:text-green-400',
        text: 'text-green-600 dark:text-green-400',
      };
    }
    if (status === 'denied') {
      return {
        bg:   'bg-red-50 dark:bg-red-900/20',
        icon: 'text-red-500 dark:text-red-400',
        text: 'text-red-600 dark:text-red-400',
      };
    }
    return {
      bg:   'bg-gray-100 dark:bg-gray-800',
      icon: 'text-gray-400 dark:text-gray-500',
      text: 'text-gray-400 dark:text-gray-500',
    };
  }

  async checkPermissions(): Promise<void> {
    this._checking.set(true);
    const granted = await this.camera.requestPermissions();
    this._checking.set(false);
    if (granted) void this.startPreview();
  }

  proceed(): void {
    this.progress.grantPermissions();
    this.router.navigate(['/interview']);
  }

  ngOnDestroy(): void {
    // Release the hardware when leaving this route.
    // InterviewComponent.ngAfterViewInit() calls startStream() which re-acquires the camera.
    this.camera.stopStream();
  }
}

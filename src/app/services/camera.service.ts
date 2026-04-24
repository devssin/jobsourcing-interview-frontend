import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import {
  AudioDevice,
  CameraError,
  CameraErrorCode,
  CameraPermissionStatus,
  MediaConstraintsOptions,
  VideoDevice,
} from '../models/camera.model';

@Injectable({ providedIn: 'root' })
export class CameraService {
  private readonly destroyRef = inject(DestroyRef);

  readonly isSupported: boolean =
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  private readonly _stream       = signal<MediaStream | null>(null);
  private readonly _cameraStatus = signal<CameraPermissionStatus>('prompt');
  private readonly _micStatus    = signal<CameraPermissionStatus>('prompt');
  private readonly _videoDevices = signal<VideoDevice[]>([]);
  private readonly _audioDevices = signal<AudioDevice[]>([]);
  private readonly _error        = signal<CameraError | null>(null);

  readonly stream       = this._stream.asReadonly();
  readonly cameraStatus = this._cameraStatus.asReadonly();
  readonly micStatus    = this._micStatus.asReadonly();
  readonly videoDevices = this._videoDevices.asReadonly();
  readonly audioDevices = this._audioDevices.asReadonly();
  readonly error        = this._error.asReadonly();

  readonly isStreaming    = computed(() => this._stream() !== null);
  readonly hasPermissions = computed(
    () => this._cameraStatus() === 'granted' && this._micStatus() === 'granted',
  );

  readonly stream$        = toObservable(this._stream);
  readonly cameraStatus$  = toObservable(this._cameraStatus);
  readonly micStatus$     = toObservable(this._micStatus);
  readonly videoDevices$  = toObservable(this._videoDevices);
  readonly audioDevices$  = toObservable(this._audioDevices);
  readonly hasPermissions$ = toObservable(this.hasPermissions);
  readonly error$         = toObservable(this._error);

  constructor() {
    if (!this.isSupported) {
      this._cameraStatus.set('unsupported');
      this._micStatus.set('unsupported');
      return;
    }

    this.watchPermissions();

    const onDeviceChange = () => this.enumerateDevices();
    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
    this.destroyRef.onDestroy(() => {
      navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
      this.stopStream();
    });
  }

  private watchPermissions(): void {
    this.queryPermission('camera' as PermissionName, status =>
      this._cameraStatus.set(this.mapPermissionState(status)),
    );
    this.queryPermission('microphone' as PermissionName, status =>
      this._micStatus.set(this.mapPermissionState(status)),
    );
  }

  private async queryPermission(
    name: PermissionName,
    onChange: (state: PermissionState) => void,
  ): Promise<void> {
    try {
      const result = await navigator.permissions.query({ name });
      onChange(result.state);
      result.addEventListener('change', () => onChange(result.state));
    } catch {
      // Firefox does not support querying camera/microphone permissions
    }
  }

  private mapPermissionState(state: PermissionState): CameraPermissionStatus {
    if (state === 'granted') return 'granted';
    if (state === 'denied')  return 'denied';
    return 'prompt';
  }

  async checkPermissions(): Promise<{ camera: CameraPermissionStatus; mic: CameraPermissionStatus }> {
    return { camera: this._cameraStatus(), mic: this._micStatus() };
  }

  async requestPermissions(options: MediaConstraintsOptions = {}): Promise<boolean> {
    if (!this.isSupported) {
      this._error.set({ code: 'UNSUPPORTED', message: 'Media devices are not supported in this browser.' });
      return false;
    }
    this._error.set(null);
    try {
      const constraints = this.buildConstraints({ ...options, audioEnabled: true });
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      stream.getTracks().forEach(t => t.stop());
      this._cameraStatus.set('granted');
      this._micStatus.set('granted');
      await this.enumerateDevices();
      return true;
    } catch (err) {
      const cameraError = this.mapDomError(err);
      this._error.set(cameraError);
      if (cameraError.code === 'NOT_ALLOWED') {
        this._cameraStatus.set('denied');
        this._micStatus.set('denied');
      }
      return false;
    }
  }

  async enumerateDevices(): Promise<void> {
    if (!this.isSupported) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this._videoDevices.set(
        all.filter(d => d.kind === 'videoinput').map((d): VideoDevice => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${d.deviceId.slice(0, 6)}`,
          facing: this.detectFacing(d.label),
        })),
      );
      this._audioDevices.set(
        all.filter(d => d.kind === 'audioinput').map((d): AudioDevice => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${d.deviceId.slice(0, 6)}`,
        })),
      );
    } catch {
      // Enumeration may fail if no permissions have been granted yet; keep previous state
    }
  }

  async startStream(options: MediaConstraintsOptions = {}): Promise<MediaStream | null> {
    if (!this.isSupported) {
      this._error.set({ code: 'UNSUPPORTED', message: 'Media devices are not supported in this browser.' });
      return null;
    }
    this.stopStream();
    this._error.set(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(this.buildConstraints(options));
      this._stream.set(stream);
      this._cameraStatus.set('granted');
      if (options.audioEnabled !== false) this._micStatus.set('granted');
      await this.enumerateDevices();
      return stream;
    } catch (err) {
      const cameraError = this.mapDomError(err);
      this._error.set(cameraError);
      if (cameraError.code === 'NOT_ALLOWED') {
        this._cameraStatus.set('denied');
        if (options.audioEnabled !== false) this._micStatus.set('denied');
      }
      return null;
    }
  }

  async switchCamera(deviceId: string): Promise<MediaStream | null> {
    return this.startStream({ videoDeviceId: deviceId });
  }

  stopStream(): void {
    const stream = this._stream();
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      this._stream.set(null);
    }
  }

  attachToVideo(el: HTMLVideoElement): void {
    const stream = this._stream();
    if (stream) {
      // Force-mute the live preview so the mic track can never feed back through
      // speakers/headphones, even if the template `muted` attribute is stripped.
      el.muted  = true;
      el.volume = 0;
      el.srcObject = stream;
    }
  }

  buildConstraints(options: MediaConstraintsOptions = {}): MediaStreamConstraints {
    const video: MediaTrackConstraints = {};
    if (options.videoDeviceId) {
      video.deviceId = { exact: options.videoDeviceId };
    } else if (options.facingMode) {
      video.facingMode = options.facingMode;
    }
    if (options.width)     video.width     = { ideal: options.width };
    if (options.height)    video.height    = { ideal: options.height };
    if (options.frameRate) video.frameRate = { ideal: options.frameRate };

    const audio: boolean | MediaTrackConstraints =
      options.audioEnabled === false
        ? false
        : {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl:  true,
            channelCount:     1,
            sampleRate:       48000,
            ...(options.audioDeviceId ? { deviceId: { exact: options.audioDeviceId } } : {}),
          };

    return { video: Object.keys(video).length > 0 ? video : true, audio };
  }

  private detectFacing(label: string): VideoDevice['facing'] {
    const l = label.toLowerCase();
    if (l.includes('front') || l.includes('user') || l.includes('facetime')) return 'front';
    if (l.includes('back')  || l.includes('rear') || l.includes('environment')) return 'back';
    return 'unknown';
  }

  private mapDomError(err: unknown): CameraError {
    const messages: Record<CameraErrorCode, string> = {
      NOT_ALLOWED:     'Camera or microphone access was denied. Please grant permission in your browser settings.',
      NOT_FOUND:       'No camera or microphone was found on this device.',
      NOT_READABLE:    'The camera or microphone is already in use by another application.',
      OVERCONSTRAINED: 'The requested camera settings are not supported by this device.',
      UNSUPPORTED:     'Media devices are not supported in this browser.',
      UNKNOWN:         'An unexpected error occurred while accessing media devices.',
    };

    if (err instanceof DOMException) {
      const codeMap: Record<string, CameraErrorCode> = {
        NotAllowedError:             'NOT_ALLOWED',
        PermissionDeniedError:       'NOT_ALLOWED',
        NotFoundError:               'NOT_FOUND',
        DevicesNotFoundError:        'NOT_FOUND',
        NotReadableError:            'NOT_READABLE',
        TrackStartError:             'NOT_READABLE',
        OverconstrainedError:        'OVERCONSTRAINED',
        ConstraintNotSatisfiedError: 'OVERCONSTRAINED',
      };
      const code: CameraErrorCode = codeMap[err.name] ?? 'UNKNOWN';
      return { code, message: messages[code], original: err };
    }
    return { code: 'UNKNOWN', message: messages['UNKNOWN'], original: err };
  }
}

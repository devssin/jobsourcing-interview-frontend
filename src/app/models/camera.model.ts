export type CameraPermissionStatus = 'granted' | 'denied' | 'prompt' | 'unsupported';

export type CameraErrorCode =
  | 'NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'NOT_READABLE'
  | 'OVERCONSTRAINED'
  | 'UNSUPPORTED'
  | 'UNKNOWN';

export interface CameraError {
  code: CameraErrorCode;
  message: string;
  original?: unknown;
}

export interface VideoDevice {
  deviceId: string;
  label: string;
  facing: 'front' | 'back' | 'unknown';
}

export interface AudioDevice {
  deviceId: string;
  label: string;
}

export interface MediaConstraintsOptions {
  videoDeviceId?: string;
  audioDeviceId?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  facingMode?: 'user' | 'environment';
  audioEnabled?: boolean;
}

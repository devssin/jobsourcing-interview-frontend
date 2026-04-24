export type UploadState = 'idle' | 'uploading' | 'success' | 'error';

export interface UploadStatus {
  recordingId: string;
  /** Upload progress 0–100 */
  progress: number;
  state: UploadState;
  /** S3 URL on success */
  url?: string;
  error?: string;
}

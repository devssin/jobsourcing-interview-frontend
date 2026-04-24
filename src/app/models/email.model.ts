export type EmailStatus =
  | 'preparing'
  | 'uploading'
  | 'sending'
  | 'sent'
  | 'failed';

export interface CandidateInfo {
  name: string;
  email?: string;
  phone?: string;
}

export interface EmailResponse {
  success: boolean;
  message: string;
}

/** Extra interview metadata sent alongside the video. */
export interface InterviewEmailMeta {
  /** Number of questions answered */
  questionCount: number;
  /** Total compiled-video duration, in milliseconds */
  videoDurationMs: number;
  /** Defaults to `new Date()` when omitted */
  interviewDate?: Date;
}

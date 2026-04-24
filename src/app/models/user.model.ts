export interface User {
  id: string;
  email: string;
  name: string;
  role: 'candidate' | 'interviewer' | 'admin';
  avatarUrl?: string;
  createdAt: Date;
}

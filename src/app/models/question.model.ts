export type QuestionCategory =
  | 'professional-status'
  | 'job-search-status'
  | 'other-opportunities'
  | 'logistics'
  | 'availability'
  | 'compensation'
  | 'motivation'
  | 'professional-development'
  | 'personality';

export const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  'professional-status':      'Statut professionnel',
  'job-search-status':        'Recherche d\'emploi',
  'other-opportunities':      'Autres opportunités',
  'logistics':                'Mobilité',
  'availability':             'Disponibilité',
  'compensation':             'Rémunération',
  'motivation':               'Motivation',
  'professional-development': 'Évolution professionnelle',
  'personality':              'Personnalité',
};

export interface SubQuestion {
  id: string;
  text: string;
  /** Shown to user to indicate when this sub-question applies. e.g. "Si oui" */
  conditionLabel: string;
  /** Maximum seconds allowed to answer */
  duration: number;
}

export interface Question {
  id: string;
  text: string;
  /** Maximum seconds allowed to answer */
  duration: number;
  order: number;
  category: QuestionCategory;
  hasSubQuestions: boolean;
  subQuestions: SubQuestion[];
}

/**
 * The four phases of a question node:
 * - main          → answering a main question
 * - sub-selection → main answered; user chooses which sub-question applies
 * - sub-answer    → answering the selected sub-question
 * - done          → all questions completed
 */
export type QuestionNavigationState = 'main' | 'sub-selection' | 'sub-answer' | 'done';

export interface QuestionProgress {
  /** 0-based index of the current main question */
  mainIndex: number;
  /** Total number of main questions */
  totalMain: number;
  /** True when currently answering a sub-question */
  isOnSubQuestion: boolean;
  /** True when awaiting sub-question selection after completing a main question */
  hasPendingSubSelection: boolean;
  /** 0–100 based on main-question completion */
  percentComplete: number;
}

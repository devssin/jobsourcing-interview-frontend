import { computed, Injectable, isDevMode, signal } from '@angular/core';

import {
  CATEGORY_LABELS,
  Question,
  QuestionCategory,
  QuestionNavigationState,
  QuestionProgress,
  SubQuestion,
} from '../models';

const INTERVIEW_QUESTIONS: Question[] = [
  // ── 1. Statut professionnel ────────────────────────────────────────────────
  {
    id: 'q1',
    order: 1,
    category: 'professional-status',
    text: 'Êtes-vous actuellement en poste ?',
    duration: 180,
    hasSubQuestions: true,
    subQuestions: [
      {
        id: 'q1-s1',
        text: 'Quel est votre poste actuel et depuis combien de temps l\'occupez-vous ?',
        conditionLabel: 'Si oui',
        duration: 150,
      },
      {
        id: 'q1-s2',
        text: 'Depuis combien de temps êtes-vous sans emploi et qu\'avez-vous fait pendant cette période ?',
        conditionLabel: 'Si non',
        duration: 150,
      },
    ],
  },

  // ── 2. Recherche d'emploi ──────────────────────────────────────────────────
  {
    id: 'q2',
    order: 2,
    category: 'job-search-status',
    text: 'Êtes-vous en recherche active d\'emploi en ce moment ?',
    duration: 180,
    hasSubQuestions: true,
    subQuestions: [
      {
        id: 'q2-s1',
        text: 'Depuis combien de temps cherchez-vous et qu\'est-ce qui vous a poussé à chercher ?',
        conditionLabel: 'Si oui',
        duration: 150,
      },
      {
        id: 'q2-s2',
        text: 'Qu\'est-ce qui vous a amené à répondre à cette offre si vous n\'étiez pas en recherche active ?',
        conditionLabel: 'Si non',
        duration: 150,
      },
    ],
  },

  // ── 3. Autres opportunités ─────────────────────────────────────────────────
  {
    id: 'q3',
    order: 3,
    category: 'other-opportunities',
    text: 'Avez-vous d\'autres opportunités en cours ou des entretiens prévus ?',
    duration: 180,
    hasSubQuestions: true,
    subQuestions: [
      {
        id: 'q3-s1',
        text: 'Lesquels ? (type de poste, secteur, avancement du processus)',
        conditionLabel: 'Si oui',
        duration: 120,
      },
    ],
  },

  // ── 4. Mobilité ────────────────────────────────────────────────────────────
  {
    id: 'q4',
    order: 4,
    category: 'logistics',
    text: 'Êtes-vous mobile géographiquement ou contraint à une zone particulière ?',
    duration: 180,
    hasSubQuestions: true,
    subQuestions: [
      {
        id: 'q4-s1',
        text: 'Quelle est votre zone géographique de recherche et pourquoi ?',
        conditionLabel: 'Si contraint(e)',
        duration: 150,
      },
    ],
  },

  // ── 5. Disponibilité ───────────────────────────────────────────────────────
  {
    id: 'q5',
    order: 5,
    category: 'availability',
    text: 'Quelle est votre disponibilité ? Avez-vous un préavis à respecter ?',
    duration: 180,
    hasSubQuestions: true,
    subQuestions: [
      {
        id: 'q5-s1',
        text: 'Combien de temps dure votre préavis et est-il négociable ?',
        conditionLabel: 'Si préavis',
        duration: 120,
      },
    ],
  },

  // ── 6. Rémunération ────────────────────────────────────────────────────────
  {
    id: 'q6',
    order: 6,
    category: 'compensation',
    text: 'Quelle est votre rémunération actuelle et quelles sont vos prétentions salariales ?',
    duration: 180,
    hasSubQuestions: false,
    subQuestions: [],
  },

  // ── 7. Motivation ──────────────────────────────────────────────────────────
  {
    id: 'q7',
    order: 7,
    category: 'motivation',
    text: 'Qu\'est-ce qui vous motive dans ce poste et pourquoi avez-vous postulé à cette offre en particulier ?',
    duration: 180,
    hasSubQuestions: false,
    subQuestions: [],
  },

  // ── 8. Évolution professionnelle ───────────────────────────────────────────
  {
    id: 'q8',
    order: 8,
    category: 'professional-development',
    text: 'Quelles sont vos ambitions professionnelles à moyen terme (3–5 ans) ?',
    duration: 180,
    hasSubQuestions: false,
    subQuestions: [],
  },

  // ── 9. Personnalité ────────────────────────────────────────────────────────
  {
    id: 'q9',
    order: 9,
    category: 'personality',
    text: 'Comment vous décririez-vous professionnellement en trois mots ? Pouvez-vous illustrer chacun d\'eux ?',
    duration: 180,
    hasSubQuestions: false,
    subQuestions: [],
  },

  // ── 10. Personnalité (complémentaire) ──────────────────────────────────────
  {
    id: 'q10',
    order: 10,
    category: 'personality',
    text: 'Avez-vous des questions sur le poste ou sur notre entreprise ?',
    duration: 180,
    hasSubQuestions: false,
    subQuestions: [],
  },
];

@Injectable({ providedIn: 'root' })
export class QuestionService {

  private readonly _questions = INTERVIEW_QUESTIONS.slice().sort((a, b) => a.order - b.order);

  // ── State signals ─────────────────────────────────────────────────────────

  private readonly _mainIndex        = signal(0);
  private readonly _navState         = signal<QuestionNavigationState>('main');
  private readonly _activeSubQuestion = signal<SubQuestion | null>(null);

  // ── Derived signals ───────────────────────────────────────────────────────

  readonly currentMainQuestion = computed(() => this._questions[this._mainIndex()] ?? null);

  readonly activeSubQuestion = computed(() => this._activeSubQuestion());

  readonly pendingSubQuestions = computed((): SubQuestion[] => {
    const q = this.currentMainQuestion();
    return q?.hasSubQuestions ? q.subQuestions : [];
  });

  readonly isOnSubQuestion = computed(() => this._navState() === 'sub-answer');

  readonly hasPendingSubSelection = computed(() => this._navState() === 'sub-selection');

  readonly isDone = computed(() => this._navState() === 'done');

  readonly isLastMainQuestion = computed(() => this._mainIndex() === this._questions.length - 1);

  readonly progress = computed((): QuestionProgress => ({
    mainIndex:               this._mainIndex(),
    totalMain:               this._questions.length,
    isOnSubQuestion:         this.isOnSubQuestion(),
    hasPendingSubSelection:  this.hasPendingSubSelection(),
    percentComplete:         Math.round((this._mainIndex() / this._questions.length) * 100),
  }));

  // ── Navigation ────────────────────────────────────────────────────────────

  /**
   * Called after the user finishes answering a main question.
   * If the question has sub-questions, transitions to 'sub-selection';
   * otherwise advances to the next question (or marks done).
   */
  afterMainAnswered(): void {
    const q = this.currentMainQuestion();
    if (!q) return;

    if (q.hasSubQuestions && q.subQuestions.length > 0) {
      this._navState.set('sub-selection');
    } else {
      this._advanceMain();
    }
  }

  /** Called when the user picks a sub-question from the selection screen. */
  selectSubQuestion(sub: SubQuestion): void {
    if (this._navState() !== 'sub-selection') return;
    this._activeSubQuestion.set(sub);
    this._navState.set('sub-answer');
  }

  /** Called when the user explicitly skips sub-questions. */
  skipSubQuestions(): void {
    if (this._navState() !== 'sub-selection') return;
    this._activeSubQuestion.set(null);
    this._advanceMain();
  }

  /** Called after the user finishes answering a sub-question. */
  afterSubAnswered(): void {
    if (this._navState() !== 'sub-answer') return;
    this._activeSubQuestion.set(null);
    this._advanceMain();
  }

  /**
   * Goes back one step:
   * - sub-answer      → sub-selection
   * - sub-selection   → main (re-shows current question)
   * - main (index > 0) → previous main question
   */
  goBack(): void {
    const state = this._navState();
    if (state === 'sub-answer') {
      this._activeSubQuestion.set(null);
      this._navState.set('sub-selection');
      return;
    }
    if (state === 'sub-selection') {
      this._navState.set('main');
      return;
    }
    if (state === 'main' && this._mainIndex() > 0) {
      this._mainIndex.update(i => i - 1);
    }
  }

  reset(): void {
    this._mainIndex.set(0);
    this._navState.set('main');
    this._activeSubQuestion.set(null);
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getById(id: string): Question | undefined {
    return this._questions.find(q => q.id === id);
  }

  getSubQuestionById(id: string): SubQuestion | undefined {
    for (const q of this._questions) {
      const found = q.subQuestions.find(s => s.id === id);
      if (found) return found;
    }
    return undefined;
  }

  getAll(): Question[] {
    return [...this._questions];
  }

  getNext(): Question | null {
    const next = this._mainIndex() + 1;
    return next < this._questions.length ? this._questions[next] : null;
  }

  getPrevious(): Question | null {
    const prev = this._mainIndex() - 1;
    return prev >= 0 ? this._questions[prev] : null;
  }

  getCategoryLabel(category: QuestionCategory): string {
    return CATEGORY_LABELS[category];
  }

  // ── Validation (dev-mode only) ────────────────────────────────────────────

  validate(): boolean {
    if (!isDevMode()) return true;

    let ok = true;
    const ids     = new Set<string>();
    const subIds  = new Set<string>();
    const orders  = new Set<number>();

    for (const q of this._questions) {
      if (!q.id || !q.text || !q.category) {
        console.error(`[QuestionService] Question missing required fields:`, q);
        ok = false;
      }
      if (ids.has(q.id)) {
        console.error(`[QuestionService] Duplicate question id: ${q.id}`);
        ok = false;
      }
      ids.add(q.id);

      if (orders.has(q.order)) {
        console.error(`[QuestionService] Duplicate question order: ${q.order}`);
        ok = false;
      }
      orders.add(q.order);

      if (q.duration < 30 || q.duration > 600) {
        console.warn(`[QuestionService] Unusual duration (${q.duration}s) for question ${q.id}`);
      }

      if (q.hasSubQuestions && q.subQuestions.length === 0) {
        console.error(`[QuestionService] Question ${q.id} has hasSubQuestions=true but no subQuestions`);
        ok = false;
      }
      if (!q.hasSubQuestions && q.subQuestions.length > 0) {
        console.error(`[QuestionService] Question ${q.id} has subQuestions but hasSubQuestions=false`);
        ok = false;
      }

      for (const s of q.subQuestions) {
        if (!s.id || !s.text || !s.conditionLabel) {
          console.error(`[QuestionService] Sub-question missing required fields:`, s);
          ok = false;
        }
        if (subIds.has(s.id)) {
          console.error(`[QuestionService] Duplicate sub-question id: ${s.id}`);
          ok = false;
        }
        subIds.add(s.id);
      }
    }

    if (ok) console.info(`[QuestionService] Validation passed — ${this._questions.length} questions OK`);
    return ok;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _advanceMain(): void {
    if (this._mainIndex() < this._questions.length - 1) {
      this._mainIndex.update(i => i + 1);
      this._navState.set('main');
    } else {
      this._navState.set('done');
    }
  }
}

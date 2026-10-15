// Core game types. The engine is pure: no Math.random, no Date, no DOM.

export type CompanyId = "Vercel" | "Stripe" | "Google";
export type Level = "EM" | "Senior EM" | "Director";
export type Grade =
  | "Strongly Exceeds"
  | "Exceeds"
  | "Meets"
  | "Partially Meets"
  | "Does Not Meet";

export type AttrKey =
  | "coding"
  | "debugging"
  | "communication"
  | "ambition"
  | "morale"
  | "energy";

export type Trait =
  | "flight-risk"
  | "hero-coder"
  | "quiet-genius"
  | "drama-magnet"
  | "wants-to-lead"
  | "steady";

export type StakeholderRole = "skip" | "pm" | "peer";

/** A recorded cause for a number moving. Every delta the player sees has one. */
export interface Cause {
  subject: string; // "Priya's Morale", "PM Trust", "Tech Debt"
  delta: number;
  why: string;
  week: number;
  quarter: number;
}

export interface Engineer {
  id: string;
  name: string;
  level: number; // 3..7
  tenure: string;
  bio: string;
  attrs: Record<AttrKey, number>; // 1..20
  loyalty: number; // 1..20, hidden until scouted
  loyaltyKnown: boolean;
  traits: Trait[]; // hidden
  revealed: Trait[];
  scout: number; // accumulated 1:1 discovery progress
  projectId: string | null;
  log: Cause[]; // most recent first, trimmed
}

export interface Project {
  id: string;
  name: string;
  owner: StakeholderRole;
  scope: number; // points to ship, starts at 100
  progress: number;
  startWeek: number;
  dueWeek: number;
  flagship: boolean;
  status: "active" | "shipped" | "late-shipped" | "missed";
}

export interface Stakeholder {
  role: StakeholderRole;
  name: string;
  quote: string;
  trust: number; // 0..100
}

export interface Fact {
  id: string;
  kind: "promise" | "grudge" | "favor";
  subjectId: string;
  text: string;
  quarter: number;
  createdWeek: number;
  dueWeek: number;
  status: "open" | "kept" | "broken";
}

export type Effect =
  | { k: "attr"; who: string; attr: AttrKey; d: number }
  | { k: "loyalty"; who: string; d: number }
  | { k: "trust"; role: StakeholderRole; d: number }
  | {
      k: "meter";
      m: "techDebt" | "oncallLoad" | "stress" | "capital" | "reputation" | "packet";
      d: number;
    }
  | { k: "progress"; project: string; d: number }
  | { k: "scope"; project: string; d: number }
  | { k: "deadline"; project: string; d: number }
  | { k: "promise"; who: string; text: string; dueIn: number }
  | { k: "keep"; factId: string }
  | { k: "break"; factId: string }
  | { k: "scout"; who: string; d: number }
  | { k: "leave"; who: string }
  | { k: "hire" }
  | { k: "chance"; p: number; then: Effect[]; else?: Effect[]; note: string }
  | { k: "teamAttr"; attr: AttrKey; d: number };

export interface IntentSpec {
  id: string;
  label: string;
  cost: number;
  hints: string;
  effects: Effect[];
  cause: string; // short cause sentence used in the causality log
}

export type Category = "PEOPLE" | "DELIVERY" | "POLITICS" | "FOLLOW-UP";

/** A concrete inbox item for this week. Text comes from templates; the LLM may rewrite it later. */
export interface InboxItem {
  id: string;
  type: string;
  cat: Category;
  required: boolean;
  from: string;
  fromRole: string;
  title: string;
  body: string;
  intents: IntentSpec[];
  ignoreHint: string;
  ignoreEffects: Effect[];
  ignoreCause: string;
  subjectId?: string;
  factId?: string;
  why?: string; // the AI director's reason for picking this demand
}

/** The AI director's choice of next week's demands. Picks are candidate ids from candidatePool(). */
export interface DirectorPlan {
  quarter: number;
  week: number;
  picks: string[];
  requiredId: string | null;
  rationale: Record<string, string>;
  arcNote: string;
}

export interface Plan {
  choices: Record<string, string>; // itemId -> intentId | "ignore"
  oneOnOnes: string[];
  focus: boolean;
  spend: string[]; // Political Capital actions, applied on Friday
  oncallId: string | null;
}

export interface FridayLine {
  time: string;
  text: string;
  cause: string;
  tone?: "good" | "bad";
}

export interface WeekResult {
  quarter: number;
  week: number;
  slotsUsed: number;
  capacity: number;
  lines: FridayLine[];
  causes: Cause[];
  luck: number;
  headline: string;
  recap: string;
  good: boolean;
  keynote?: "shipped" | "missed";
}

export interface QuarterRecord {
  quarter: number;
  company: CompanyId;
  level: Level;
  grade: Grade | "New role";
  score?: number;
}

export interface ReviewResult {
  delivery: number;
  team: number;
  trust: number;
  weighted: number;
  baseGrade: Grade;
  bossSteps: -1 | 0 | 1;
  grade: Grade;
  outcome: "stay" | "promotion" | "fired" | "win" | "run-over";
  letter: string[];
  packetApproved?: boolean;
  notes: string[];
}

export interface Offer {
  company: CompanyId;
  level: Level;
  salary: number;
  kind: "hunt" | "poach";
}

export type Phase =
  | "plan"
  | "friday"
  | "back"
  | "checkin"
  | "review"
  | "hunt"
  | "offer"
  | "farewell"
  | "recap";

export interface RunStats {
  projectsShipped: number;
  incidents: number;
  promisesKept: number;
  promisesBroken: number;
  departed: string[];
  bestEngineer?: string;
}

export interface GameState {
  version: 1;
  seed: number;
  company: CompanyId;
  level: Level;
  quarter: number;
  week: number;
  phase: Phase;
  engineers: Engineer[];
  projects: Project[];
  stakeholders: Stakeholder[];
  techDebt: number;
  oncallLoad: number;
  stress: number;
  capital: number;
  reputation: number;
  packet: number; // Google promo packet evidence
  firings: number;
  strongStreak: number;
  partialStreak: number;
  history: QuarterRecord[];
  facts: Fact[];
  inbox: InboxItem[];
  plan: Plan;
  capacity: number; // this week's slot budget
  recentTypes: string[]; // anti-repeat window
  directorPlan: DirectorPlan | null; // next week's picks, if the AI director answered in time
  inboxSource: { by: "director" | "random"; arcNote?: string }; // who chose this week's demands
  pendingPostmortem: { role: StakeholderRole; hit: number } | null; // Stripe: last week's incident awaiting review
  incidentMultiplier: number; // Stripe: grows when reviews are skipped
  departuresThisQuarter: number;
  checkinFocus: number | null;
  lastWeek: WeekResult | null;
  review: ReviewResult | null;
  offers: Offer[];
  pendingOffer: Offer | null;
  runEnd: "win" | "loss" | null;
  stats: RunStats;
  nextId: number;
}

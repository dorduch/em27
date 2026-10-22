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
  /** A follow-on that arrived mid-quarter: it can only raise the delivery score, and it never misses. */
  stretch?: boolean;
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
  payload?: Effect[];
  payloadHint?: string;
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
  | {
      k: "promise";
      who: string;
      text: string;
      dueIn: number;
      /** Applied when the promise is kept: what keeping it actually costs or delivers. */
      payload?: Effect[];
      payloadHint?: string;
    }
  | { k: "keep"; factId: string }
  | { k: "break"; factId: string }
  | { k: "scout"; who: string; d: number }
  | { k: "leave"; who: string; how?: "quit" | "cut" | "transfer" }
  | { k: "away"; who: string } // steps off their project and the pager for a while (a loan, a week off)
  | { k: "assign"; who: string; project: string } // put someone (back) on an active project
  | { k: "hire" }
  | { k: "settle"; type: string } // the situation behind an event type is dealt with: it won't come back this quarter
  | { k: "chance"; p: number; then: Effect[]; else?: Effect[]; note: string; miss?: string } // miss: narrated when the roll fails
  | { k: "teamAttr"; attr: AttrKey; d: number }
  | { k: "levelUp"; who: string }
  // Storyline effects: only act when the item belongs to a storyline.
  | { k: "arc"; to: string; wait: [number, number] } // schedule the next beat in min..max weeks
  | { k: "arcEnd"; outcome: string } // close the storyline with an outcome
  | { k: "arcFlag"; flag: string }; // remember a choice for later beats

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
  projectId?: string; // the project a one-off is about, if any
  factId?: string;
  why?: string; // the AI director's reason for picking this demand
  /** Set when the item is a beat of a storyline. `start` marks the beat that opened it this week. */
  arc?: { id: string; storyline: string; beat: string; start?: boolean; otherId?: string; projectId?: string };
}

/** A running storyline: who it is about, which beat comes next, and when. */
export interface ArcState {
  id: string;
  storyline: string;
  subjectId: string;
  otherId?: string; // a second person, when the storyline is between two people
  projectId?: string;
  beat: string;
  /** Absolute week (quarter * 12 + week) from which the beat may appear. Lets storylines cross quarters. */
  due: number;
  flags: string[];
  started: number;
}

/** How a storyline ended. Later storylines read this (a broken promo makes a flight risk likelier). */
export interface ArcRecord {
  storyline: string;
  subjectId: string;
  outcome: string;
  ended: number;
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

/** One row per project on the back page, including projects that made no progress. */
export interface ProjectWeek {
  id: string;
  name: string;
  gain: number;
  team: number;
  progress: number;
  scope: number;
  dueWeek: number;
  status: Project["status"];
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
  projects?: ProjectWeek[]; // absent in saves from before this field existed
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
  quarterEvents: string[]; // event types seen this quarter (for once-per-quarter events)
  arcs: ArcState[]; // running storylines
  arcHistory: ArcRecord[];
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

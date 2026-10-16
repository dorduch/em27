import {
  EVENT_TYPES,
  postmortemFollowUp,
  promiseFollowUp,
  type EventCtx,
  type EventType,
} from "@/content/events";
import { beatCtx, storylineById, STORYLINES, type Storyline } from "@/content/storylines";
import { makeRng, type Rng } from "./rng";
import type { ArcRecord, ArcState, Category, DirectorPlan, GameState, InboxItem } from "./types";

export const REGULAR_ITEMS = { EM: 5, "Senior EM": 6, Director: 0 } as const;
/** How many storylines can run at once. */
export const MAX_ARCS = { EM: 3, "Senior EM": 4, Director: 0 } as const;
/** At most this many storyline beats land in one week; the rest slide a week. */
const MAX_BEATS = 2;
/** A storyline that has not resolved after this many weeks quietly fades. */
const ARC_MAX_AGE = 16;
// Roughly the last two weeks of one-off events. Types in it are heavily down-weighted.
const REPEAT_WINDOW = 10;
// People events can be about different engineers, so they offer two variants.
const VARIANTS: Partial<Record<Category, number>> = { PEOPLE: 2 };

function stakeholder(s: GameState, role: "skip" | "pm" | "peer") {
  return s.stakeholders.find((x) => x.role === role)!;
}

/** One concrete option for this week: an event type plus who or what it is about. */
export interface Candidate {
  id: string; // `${type}:${variant}`, stable for a given state
  type: EventType;
  ctx: EventCtx;
  weight: number;
  /** Set when picking this candidate opens a storyline about ctx.subject. */
  storyline?: string;
}

/** Absolute week, so storylines can be scheduled across quarters. */
export const now = (s: GameState) => s.quarter * 12 + s.week;

export const baseCtx = (s: GameState): EventCtx => ({ s, skip: stakeholder(s, "skip"), pm: stakeholder(s, "pm"), peer: stakeholder(s, "peer") });

/** Engineers already at the centre of a running storyline. One storyline per person. */
export function inStoryline(s: GameState): Set<string> {
  return new Set(s.arcs.flatMap((a) => (a.otherId ? [a.subjectId, a.otherId] : [a.subjectId])));
}

/** The key recorded in quarterEvents: see EventType.oncePer. Default: the week it happened. */
function oneOffKey(type: string, week: number, subjectId?: string, projectId?: string): string {
  const per = EVENT_TYPES.find((t) => t.id === type)?.oncePer;
  if (per === "quarter") return `${type}@-`;
  if (per === "subject") return `${type}@${subjectId}`;
  if (per === "project") return `${type}@${projectId}`;
  return `${type}@w${week}`;
}

/** A one-off without a fixed rhythm needs a three-week gap before it can come back. */
const GAP = 3;
function tooSoon(s: GameState, type: string, subjectId?: string, projectId?: string): boolean {
  if (s.quarterEvents.includes(oneOffKey(type, s.week, subjectId, projectId))) return true;
  if (EVENT_TYPES.find((t) => t.id === type)?.oncePer) return false;
  for (let w = s.week - GAP; w < s.week; w++) if (s.quarterEvents.includes(`${type}@w${w}`)) return true;
  return false;
}

/** A storyline's opening beat, wrapped as an event type so the draw and the director can pick it. */
function openingType(sl: Storyline): EventType {
  const beat = sl.beats[sl.start];
  return {
    id: sl.id,
    cat: sl.cat,
    canBeRequired: sl.canBeRequired,
    weight: () => 0,
    setup: (ctx) => ctx,
    build: (ctx) => beat.build(beatCtx(ctx, { storyline: sl.id, subjectId: ctx.subject!.id, otherId: ctx.other?.id, projectId: ctx.project?.id, flags: [] })!),
  };
}

/** While the inbox is being refilled it still holds last week's items (the director's preview sees the same). */
const lastWeekTypes = (s: GameState) => new Set(s.inbox.filter((i) => !i.arc).map((i) => i.type));

/** Everything that could land in this week's inbox. Deterministic for a given state. */
export function candidatePool(s: GameState): Candidate[] {
  const base = baseCtx(s);
  const busy = inStoryline(s);
  const out: Candidate[] = [];
  const lastWeek = lastWeekTypes(s);
  for (const type of EVENT_TYPES) {
    const raw = type.weight(s);
    // Never the same kind of demand two weeks running; rarely within the repeat window.
    if (raw <= 0 || lastWeek.has(type.id)) continue;
    const weight = s.recentTypes.includes(type.id) ? raw * 0.1 : raw;
    const seen = new Set<string>();
    for (let v = 0; v < (VARIANTS[type.cat] ?? 1); v++) {
      const ctx = type.setup(base, makeRng(s.seed, s.quarter, s.week, "candidate", type.id, v));
      if (!ctx) continue;
      // People in a storyline get their news through it, not through one-offs.
      if (type.cat === "PEOPLE" && ctx.subject && busy.has(ctx.subject.id)) continue;
      if (tooSoon(s, type.id, ctx.subject?.id, ctx.project?.id)) continue;
      const key = `${ctx.subject?.id}|${ctx.other?.id}|${ctx.project?.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: `${type.id}:${v}`, type, ctx, weight });
    }
  }
  // Storyline openings, while there is room for another storyline.
  if (s.arcs.length < MAX_ARCS[s.level]) {
    let free = s.engineers.filter((e) => !busy.has(e.id));
    for (const sl of STORYLINES) {
      if (s.arcs.some((a) => a.storyline === sl.id)) continue;
      const cast = sl.cast(s, free, makeRng(s.seed, s.quarter, s.week, "cast", sl.id));
      if (!cast) continue;
      // One storyline per person, even among this week's openings.
      free = free.filter((x) => x !== cast.subject && x !== cast.other);
      // Storylines are the spine of a quarter, so they outweigh any single one-off.
      out.push({ id: `${sl.id}:0`, type: openingType(sl), ctx: { ...base, ...cast }, weight: sl.weight(s, cast.subject) * 4, storyline: sl.id });
    }
  }
  return out;
}

/** A storyline beat that is due this week, already routed against the current state. */
export interface DueBeat {
  arc: ArcState;
  beat: string;
}

/**
 * Bring running storylines up to date for this week: drop the ones whose person has left,
 * follow routes (a beat may jump, wait, or close the storyline), and cap the beats per week.
 * Pure: returns the new arcs, the beats to show, and any storylines that ended.
 */
export function settleArcs(s: GameState): { arcs: ArcState[]; due: DueBeat[]; ended: ArcRecord[] } {
  const t = now(s);
  const base = baseCtx(s);
  const arcs: ArcState[] = [];
  const due: DueBeat[] = [];
  const ended: ArcRecord[] = [];
  const close = (a: ArcState, outcome: string) => ended.push({ storyline: a.storyline, subjectId: a.subjectId, outcome, ended: t });
  for (const a0 of s.arcs) {
    const sl = storylineById(a0.storyline);
    const ctx0 = beatCtx(base, a0);
    if (!sl || !ctx0) {
      close(a0, "left");
      continue;
    }
    if (t - a0.started > ARC_MAX_AGE) {
      close(a0, "faded");
      continue;
    }
    if (a0.due > t) {
      arcs.push(a0);
      continue;
    }
    let a = a0;
    let outcome: string | null = null;
    for (let hops = 0; hops < 5; hops++) {
      const beat = sl.beats[a.beat];
      const r = beat?.route?.({ ...ctx0, flags: a.flags }) ?? { show: true as const };
      if ("goto" in r) a = { ...a, beat: r.goto };
      else if ("wait" in r) a = { ...a, due: t + 1 };
      else if ("end" in r) outcome = r.end;
      if (!("goto" in r)) break;
    }
    if (outcome) {
      close(a, outcome);
      continue;
    }
    if (a.due <= t && due.length < MAX_BEATS) due.push({ arc: a, beat: a.beat });
    else if (a.due <= t) a = { ...a, due: t + 1 };
    arcs.push(a);
  }
  return { arcs, due, ended };
}

/** How many different demands the pool can supply: one per event type, and one storyline opening at most. */
export function pickable(pool: Candidate[]): number {
  const oneOffs = new Set(pool.filter((c) => !c.storyline).map((c) => c.type.id)).size;
  return oneOffs + (pool.some((c) => c.storyline) ? 1 : 0);
}

/**
 * How many regular demands to draw once the storyline beats have their seats. The pool
 * already excludes last week's types, so a quiet week stays quiet instead of repeating itself.
 */
export function regularQuota(s: GameState, pool: Candidate[] = candidatePool(s)): number {
  const base = REGULAR_ITEMS[s.level];
  if (!base) return 0;
  return Math.min(Math.max(2, base - settleArcs(s).due.length), pickable(pool));
}

function weightedPick(rng: Rng, pool: Candidate[]): Candidate | null {
  const total = pool.reduce((n, c) => n + c.weight, 0);
  if (total <= 0) return null;
  let r = rng.next() * total;
  for (const c of pool) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return pool[pool.length - 1];
}

/** The random draw: at most one must-respond item, one candidate per event type. */
export function randomPicks(s: GameState, pool: Candidate[]): { picks: string[]; requiredId: string | null } {
  const rng = makeRng(s.seed, s.quarter, s.week, "inbox");
  // Nobody gets two demands in one week; a person with a storyline beat this week is taken.
  const people = (c: Candidate) => [c.ctx.subject?.id, c.ctx.other?.id].filter((x): x is string => !!x);
  const busy = new Set(settleArcs(s).due.flatMap(({ arc }) => (arc.otherId ? [arc.subjectId, arc.otherId] : [arc.subjectId])));
  let left = pool.filter((c) => !people(c).some((p) => busy.has(p)));
  const picks: string[] = [];
  let requiredId: string | null = null;
  const take = (c: Candidate) => {
    picks.push(c.id);
    for (const p of people(c)) busy.add(p);
    // One kind of demand each, at most one new storyline a week, one demand per person.
    left = left.filter((x) => x.type !== c.type && !(c.storyline && x.storyline) && !people(x).some((p) => busy.has(p)));
  };
  const req = weightedPick(rng, left.filter((c) => c.type.canBeRequired));
  if (req) {
    take(req);
    requiredId = req.id;
  }
  const quota = regularQuota(s, pool);
  while (picks.length < quota) {
    const c = weightedPick(rng, left);
    if (!c) break;
    take(c);
  }
  return { picks, requiredId };
}

/**
 * Check a director plan against this week's pool. Returns null when anything is off,
 * so the caller falls back to the random draw.
 */
export function validatePlan(s: GameState, pool: Candidate[], plan: DirectorPlan | null): DirectorPlan | null {
  if (!plan || plan.quarter !== s.quarter || plan.week !== s.week) return null;
  const byId = new Map(pool.map((c) => [c.id, c]));
  const want = regularQuota(s, pool);
  if (plan.picks.length !== want || new Set(plan.picks).size !== want) return null;
  const types = new Set<string>();
  for (const id of plan.picks) {
    const c = byId.get(id);
    if (!c || types.has(c.type.id)) return null;
    types.add(c.type.id);
  }
  if (plan.picks.filter((id) => byId.get(id)!.storyline).length > 1) return null;
  const hasRequiredOption = plan.picks.some((id) => byId.get(id)!.type.canBeRequired);
  if (hasRequiredOption) {
    if (!plan.requiredId || !plan.picks.includes(plan.requiredId) || !byId.get(plan.requiredId)!.type.canBeRequired) return null;
  } else if (plan.requiredId) return null;
  return plan;
}

/**
 * Monday's inbox: due promises and company follow-ups first, then the director's picks
 * when a valid plan exists for this week, otherwise the seeded random draw.
 */
export function buildInbox(s: GameState): InboxItem[] {
  const items: InboxItem[] = [];
  const id = () => `q${s.quarter}w${s.week}-${items.length}`;

  for (const f of s.facts) {
    if (f.kind === "promise" && f.status === "open" && f.quarter === s.quarter && f.dueWeek === s.week) {
      const e = s.engineers.find((x) => x.id === f.subjectId);
      items.push({ id: id(), type: "promise_due", cat: "FOLLOW-UP", required: false, subjectId: f.subjectId, factId: f.id, ...promiseFollowUp(f, e, s.week) });
    }
  }
  if (s.company === "Stripe" && s.pendingPostmortem) {
    const oncall = s.engineers.find((e) => e.id === s.plan.oncallId);
    items.push({ id: id(), type: "postmortem", cat: "FOLLOW-UP", required: false, ...postmortemFollowUp(oncall) });
  }

  // Storyline beats that are due: they continue a story, so they come before new demands.
  const base = baseCtx(s);
  for (const { arc, beat } of settleArcs(s).due) {
    const sl = storylineById(arc.storyline)!;
    const body = sl.beats[beat].build(beatCtx(base, arc)!);
    honestPacket(s, body.intents);
    items.push({ id: id(), type: `${sl.id}.${beat}`, cat: sl.cat, required: false, subjectId: arc.subjectId, arc: { id: arc.id, storyline: sl.id, beat }, ...body });
  }

  const pool = candidatePool(s);
  const plan = validatePlan(s, pool, s.directorPlan);
  const { picks, requiredId } = plan ?? randomPicks(s, pool);
  const byId = new Map(pool.map((c) => [c.id, c]));

  const regular: InboxItem[] = [];
  for (const pick of picks) {
    const c = byId.get(pick)!;
    const body = c.type.build(c.ctx);
    honestPacket(s, body.intents);
    const sl = c.storyline ? storylineById(c.storyline) : undefined;
    regular.push({
      id: "",
      type: c.type.id,
      cat: c.type.cat,
      required: pick === requiredId,
      subjectId: c.ctx.subject?.id,
      projectId: c.ctx.project?.id,
      why: plan?.rationale[pick],
      // The arc id is assigned when the inbox is filled.
      ...(sl ? { arc: { id: "", storyline: sl.id, beat: sl.start, start: true, otherId: c.ctx.other?.id, projectId: c.ctx.project?.id } } : {}),
      ...body,
    });
  }
  // Must-respond first, then the director's order (or the draw order).
  regular.sort((a, b) => Number(b.required) - Number(a.required));
  for (const item of regular) items.push({ ...item, id: id() });
  return items.sort((a, b) => Number(b.required) - Number(a.required));
}

/** Build Monday's inbox in place and record who chose it. Consumes the director plan. */
export function fillInbox(d: GameState): void {
  const plan = validatePlan(d, candidatePool(d), d.directorPlan);
  d.inbox = buildInbox(d);
  const settled = settleArcs(d);
  d.arcs = settled.arcs;
  d.arcHistory = [...d.arcHistory, ...settled.ended];
  // Open the storylines whose first beat was picked this week.
  for (const item of d.inbox) {
    if (!item.arc?.start) continue;
    const { storyline, beat, otherId, projectId } = item.arc;
    const arc: ArcState = { id: `a${d.nextId++}`, storyline, subjectId: item.subjectId!, otherId, projectId, beat, due: now(d), flags: [], started: now(d) };
    d.arcs.push(arc);
    item.arc = { ...item.arc, id: arc.id };
  }
  d.quarterEvents = [
    ...(d.quarterEvents ?? []),
    ...d.inbox.map((i) => i.type),
    ...d.inbox.filter((i) => !i.arc && i.cat !== "FOLLOW-UP").map((i) => oneOffKey(i.type, d.week, i.subjectId, i.projectId)),
  ];
  d.inboxSource = plan ? { by: "director", arcNote: plan.arcNote } : { by: "random" };
  d.directorPlan = null;
}

/** The promo packet only exists at Google; keep hints honest elsewhere. */
function honestPacket(s: GameState, intents: { hints: string }[]) {
  if (s.company !== "Google") for (const i of intents) i.hints = stripPacket(i.hints);
}

/** The promo packet only exists at Google; remove its hint segment elsewhere. */
export function stripPacket(hints: string): string {
  return hints
    .split(" · ")
    .filter((seg) => seg !== "Packet evidence")
    .join(" · ");
}

export function rememberTypes(s: GameState): string[] {
  return [...s.inbox.filter((i) => !i.arc).map((i) => i.type), ...s.recentTypes].slice(0, REPEAT_WINDOW);
}

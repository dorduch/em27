import {
  EVENT_TYPES,
  postmortemFollowUp,
  promiseFollowUp,
  type EventCtx,
  type EventType,
} from "@/content/events";
import { makeRng, type Rng } from "./rng";
import type { Category, DirectorPlan, GameState, InboxItem } from "./types";

export const REGULAR_ITEMS = { EM: 5, "Senior EM": 6, Director: 0 } as const;
const REPEAT_WINDOW = 6;
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
}

/** Everything that could land in this week's inbox. Deterministic for a given state. */
export function candidatePool(s: GameState): Candidate[] {
  const base: EventCtx = { s, skip: stakeholder(s, "skip"), pm: stakeholder(s, "pm"), peer: stakeholder(s, "peer") };
  const out: Candidate[] = [];
  for (const type of EVENT_TYPES) {
    const raw = type.weight(s);
    if (raw <= 0) continue;
    const weight = s.recentTypes.includes(type.id) ? raw * 0.15 : raw;
    const seen = new Set<string>();
    for (let v = 0; v < (VARIANTS[type.cat] ?? 1); v++) {
      const ctx = type.setup(base, makeRng(s.seed, s.quarter, s.week, "candidate", type.id, v));
      if (!ctx) continue;
      const key = `${ctx.subject?.id}|${ctx.other?.id}|${ctx.project?.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: `${type.id}:${v}`, type, ctx, weight });
    }
  }
  return out;
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
  let left = pool.slice();
  const picks: string[] = [];
  let requiredId: string | null = null;
  const take = (c: Candidate) => {
    picks.push(c.id);
    left = left.filter((x) => x.type !== c.type);
  };
  const req = weightedPick(rng, left.filter((c) => c.type.canBeRequired));
  if (req) {
    take(req);
    requiredId = req.id;
  }
  while (picks.length < REGULAR_ITEMS[s.level]) {
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
  const want = Math.min(REGULAR_ITEMS[s.level], new Set(pool.map((c) => c.type.id)).size);
  if (plan.picks.length !== want || new Set(plan.picks).size !== want) return null;
  const types = new Set<string>();
  for (const id of plan.picks) {
    const c = byId.get(id);
    if (!c || types.has(c.type.id)) return null;
    types.add(c.type.id);
  }
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

  const pool = candidatePool(s);
  const plan = validatePlan(s, pool, s.directorPlan);
  const { picks, requiredId } = plan ?? randomPicks(s, pool);
  const byId = new Map(pool.map((c) => [c.id, c]));

  const regular: InboxItem[] = [];
  for (const pick of picks) {
    const c = byId.get(pick)!;
    const body = c.type.build(c.ctx);
    if (s.company !== "Google") {
      // The promo packet only exists at Google; keep hints honest elsewhere.
      for (const i of body.intents) i.hints = stripPacket(i.hints);
    }
    regular.push({
      id: "",
      type: c.type.id,
      cat: c.type.cat,
      required: pick === requiredId,
      subjectId: c.ctx.subject?.id,
      why: plan?.rationale[pick],
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
  d.quarterEvents = [...(d.quarterEvents ?? []), ...d.inbox.map((i) => i.type)];
  d.inboxSource = plan ? { by: "director", arcNote: plan.arcNote } : { by: "random" };
  d.directorPlan = null;
}

/** The promo packet only exists at Google; remove its hint segment elsewhere. */
export function stripPacket(hints: string): string {
  return hints
    .split(" · ")
    .filter((seg) => seg !== "Packet evidence")
    .join(" · ");
}

export function rememberTypes(s: GameState): string[] {
  return [...s.inbox.map((i) => i.type), ...s.recentTypes].slice(0, REPEAT_WINDOW);
}

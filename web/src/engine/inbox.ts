import {
  EVENT_TYPES,
  postmortemFollowUp,
  promiseFollowUp,
  type EventCtx,
  type EventType,
} from "@/content/events";
import { makeRng, type Rng } from "./rng";
import type { GameState, InboxItem } from "./types";

const REGULAR_ITEMS = { EM: 5, "Senior EM": 6, Director: 0 } as const;
const REPEAT_WINDOW = 6;

function stakeholder(s: GameState, role: "skip" | "pm" | "peer") {
  return s.stakeholders.find((x) => x.role === role)!;
}

function weightedPick(rng: Rng, types: EventType[], s: GameState): EventType | null {
  const weights = types.map((t) => {
    const w = t.weight(s);
    return s.recentTypes.includes(t.id) ? w * 0.15 : w;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let r = rng.next() * total;
  for (let i = 0; i < types.length; i++) {
    r -= weights[i];
    if (r <= 0) return types[i];
  }
  return types[types.length - 1];
}

/** Monday's inbox: due promises, company follow-ups, then weighted events with at most one must-respond. */
export function buildInbox(s: GameState): InboxItem[] {
  const rng = makeRng(s.seed, s.quarter, s.week, "inbox");
  const base: EventCtx = { s, skip: stakeholder(s, "skip"), pm: stakeholder(s, "pm"), peer: stakeholder(s, "peer") };
  const items: InboxItem[] = [];
  const id = () => `q${s.quarter}w${s.week}-${items.length}`;

  for (const f of s.facts) {
    if (f.kind === "promise" && f.status === "open" && f.quarter === s.quarter && f.dueWeek === s.week) {
      const e = s.engineers.find((x) => x.id === f.subjectId);
      items.push({ id: id(), type: "promise_due", cat: "FOLLOW-UP", required: false, subjectId: f.subjectId, factId: f.id, ...promiseFollowUp(f, e, s.week) });
    }
  }
  if (s.company === "Stripe" && s.pendingPostmortem) {
    items.push({ id: id(), type: "postmortem", cat: "FOLLOW-UP", required: false, ...postmortemFollowUp() });
  }

  let remaining = EVENT_TYPES.slice();
  let wantRequired = true;
  for (let n = 0; n < REGULAR_ITEMS[s.level]; n++) {
    const candidates = wantRequired ? remaining.filter((t) => t.canBeRequired) : remaining;
    const type = weightedPick(rng, candidates, s);
    if (!type) {
      if (wantRequired) {
        wantRequired = false;
        n--;
        continue;
      }
      break;
    }
    remaining = remaining.filter((t) => t !== type);
    const ctx = type.setup(base, rng);
    if (!ctx) {
      n--;
      continue;
    }
    const body = type.build(ctx);
    if (s.company !== "Google") {
      // The promo packet only exists at Google; keep hints honest elsewhere.
      for (const i of body.intents) i.hints = i.hints.replace(/ · Packet evidence|Packet evidence · /g, "");
    }
    items.push({
      id: id(),
      type: type.id,
      cat: type.cat,
      required: wantRequired,
      subjectId: ctx.subject?.id,
      ...body,
    });
    wantRequired = false;
  }
  // Must-respond item first, follow-ups next, the rest after.
  return items.sort((a, b) => Number(b.required) - Number(a.required));
}

export function rememberTypes(s: GameState): string[] {
  return [...s.inbox.map((i) => i.type), ...s.recentTypes].slice(0, REPEAT_WINDOW);
}

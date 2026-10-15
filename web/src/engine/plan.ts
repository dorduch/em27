// Planning rules. Everything here is reversible until Continue.

import type { GameState, InboxItem, Level } from "./types";
import { BASE_SLOTS } from "./setup";

export function produce(s: GameState, fn: (draft: GameState) => void): GameState {
  const draft = structuredClone(s);
  fn(draft);
  return draft;
}

export function intentCost(item: InboxItem, choice: string | undefined): number {
  if (!choice || choice === "ignore") return 0;
  return item.intents.find((i) => i.id === choice)?.cost ?? 0;
}

export function planCost(s: GameState): number {
  const inbox = s.inbox.reduce((n, item) => n + intentCost(item, s.plan.choices[item.id]), 0);
  return inbox + s.plan.oneOnOnes.length + (s.plan.focus ? 1 : 0);
}

/** The single must-respond item still waiting for a decision, if any. */
export function blockingItem(s: GameState): InboxItem | undefined {
  return s.inbox.find((i) => i.required && !s.plan.choices[i.id]);
}

/** Demands without a decision yet, must-respond first. Every demand needs one before Friday; Ignore counts. */
export function undecided(s: GameState): InboxItem[] {
  return s.inbox.filter((i) => !s.plan.choices[i.id]).sort((a, b) => Number(b.required) - Number(a.required));
}

/** Mark every undecided optional demand as ignored. The must-respond item is left alone. */
export function ignoreRest(s: GameState): GameState {
  return produce(s, (d) => {
    for (const i of d.inbox) if (!i.required && !d.plan.choices[i.id]) d.plan.choices[i.id] = "ignore";
  });
}

/** Choosing replaces any previous choice for that item: the old cost is refunded first. */
export function choose(s: GameState, itemId: string, choice: string): GameState {
  const item = s.inbox.find((i) => i.id === itemId);
  if (!item) return s;
  if (choice === "ignore" && item.required) return s;
  if (choice !== "ignore" && !item.intents.some((i) => i.id === choice)) return s;
  return produce(s, (d) => {
    d.plan.choices[itemId] = choice;
  });
}

export function clearChoice(s: GameState, itemId: string): GameState {
  return produce(s, (d) => {
    delete d.plan.choices[itemId];
  });
}

export function toggleOneOnOne(s: GameState, engineerId: string): GameState {
  if (!s.engineers.some((e) => e.id === engineerId)) return s;
  return produce(s, (d) => {
    const has = d.plan.oneOnOnes.includes(engineerId);
    d.plan.oneOnOnes = has ? d.plan.oneOnOnes.filter((x) => x !== engineerId) : [...d.plan.oneOnOnes, engineerId];
  });
}

export function toggleFocus(s: GameState): GameState {
  return produce(s, (d) => {
    d.plan.focus = !d.plan.focus;
  });
}

export interface CapitalAction {
  id: string;
  label: string;
  cost: number;
  hints: string;
  available: (s: GameState) => string | null; // reason when unavailable
}

export const CAPITAL_ACTIONS: CapitalAction[] = [
  {
    id: "no-meetings",
    label: "Buy the team a no-meeting week",
    cost: 8,
    hints: "Team Energy ↑ · PM Trust ↓ · 0 slots",
    available: () => null,
  },
  {
    id: "backfill",
    label: "Fight for a backfill",
    cost: 15,
    hints: "Strong hiring chance · Skip Trust ↓ · 0 slots",
    available: (s) => (s.level !== "Director" && s.engineers.length < (s.level === "Senior EM" ? 8 : 6) ? null : "Team is at full headcount"),
  },
];

export function capitalCommitted(s: GameState): number {
  return s.plan.spend.reduce((n, id) => n + (CAPITAL_ACTIONS.find((a) => a.id === id)?.cost ?? 0), 0);
}

export function toggleSpend(s: GameState, id: string): GameState {
  const action = CAPITAL_ACTIONS.find((a) => a.id === id);
  if (!action) return s;
  const has = s.plan.spend.includes(id);
  if (!has && (action.available(s) || s.capital - capitalCommitted(s) < action.cost)) return s;
  return produce(s, (d) => {
    d.plan.spend = has ? d.plan.spend.filter((x) => x !== id) : [...d.plan.spend, id];
  });
}

export function setOncall(s: GameState, engineerId: string): GameState {
  if (!s.engineers.some((e) => e.id === engineerId)) return s;
  return produce(s, (d) => {
    d.plan.oncallId = engineerId;
  });
}

export function assign(s: GameState, engineerId: string, projectId: string | null): GameState {
  if (projectId && !s.projects.some((p) => p.id === projectId && p.status === "active")) return s;
  return produce(s, (d) => {
    const e = d.engineers.find((x) => x.id === engineerId);
    if (e) e.projectId = projectId;
  });
}

export const OVERBOOK_STRESS = 5;
export const FOCUS_RELIEF = 6;
export const WEEKLY_STRESS_DECAY = 3;

export function baseSlots(level: Level): number {
  return level === "Director" ? 0 : BASE_SLOTS[level];
}

/** High Stress shrinks the calendar, but never below base − 2 (no death spiral). */
export function capacityFor(level: Level, stress: number): number {
  const base = baseSlots(level);
  const cut = (stress >= 70 ? 1 : 0) + (stress >= 90 ? 1 : 0);
  return Math.max(base - 2, base - cut);
}

export function projectedStress(s: GameState, used = planCost(s)): number {
  const over = Math.max(0, used - s.capacity);
  return Math.max(0, Math.min(100, s.stress + over * OVERBOOK_STRESS - (s.plan.focus ? FOCUS_RELIEF : 0) - WEEKLY_STRESS_DECAY));
}

export function projectedCapacity(s: GameState, used = planCost(s)): number {
  return capacityFor(s.level, projectedStress(s, used));
}

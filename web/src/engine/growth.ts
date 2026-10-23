// Engineer development: the work you give people grows their skills, up to a hidden ceiling,
// and skills that clear the bar for the next level make the promo case.

import type { Engineer, SkillKey } from "./types";

export const SKILL_LABEL: Record<SkillKey, string> = { coding: "Coding", debugging: "Debugging", communication: "Communication" };

/** Growth points per week and per moment. Halves keep routine work slower than a stretch. */
export const GROW = {
  work: 0.5, // a week on an active project
  stretch: 0.5, // extra when the project is the flagship, a stretch goal, or theirs alone
  ship: 2, // shipping it
  oncall: 0.5, // a week carrying the pager
  incident: 2, // containing an incident
  oneOnOne: 1.5, // coaching in a 1:1
} as const;

/** Points for the next +1. Juniors grow faster, seniors slower. */
export function pointsToGrow(e: Engineer): number {
  return 4 + 2 * Math.max(0, e.level - 3);
}

/** Too tired or too unhappy to learn anything this week. */
export function stalled(e: Engineer): boolean {
  return e.attrs.energy <= 5 || e.attrs.morale <= 6;
}

export function skillAverage(e: Engineer): number {
  return (e.attrs.coding + e.attrs.debugging + e.attrs.communication) / 3;
}

/** The average skill the next level expects. An L4 needs 14 to make the L5 case. */
export function promoBar(e: Engineer): number {
  return e.level + 10;
}

export function promoReady(e: Engineer): boolean {
  return e.level < 7 && skillAverage(e) >= promoBar(e);
}

/** How far along the promo case is, 0..1, for the profile bar. */
export function promoCase(e: Engineer): number {
  const start = promoBar(e) - 3;
  return Math.max(0, Math.min(1, (skillAverage(e) - start) / 3));
}

/** Calibration odds: the packet matters, and so does whether their skills clear the bar. */
export function calibrationOdds(e: Engineer, evidence: boolean): number {
  const base = evidence ? 0.55 : 0.25;
  const gap = skillAverage(e) - promoBar(e);
  const skills = gap >= 0 ? 0.3 : gap >= -1 ? 0.1 : -0.1;
  return Math.max(0.1, Math.min(0.9, base + skills));
}

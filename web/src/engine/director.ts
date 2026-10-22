// The AI director chooses next week's demands from a pool the engine builds.
// It never changes mechanics: it only picks candidate ids, and the engine validates them.

import { expectedProgress } from "@/content/events";
import { STORYLINES } from "@/content/storylines";
import { forecastAll } from "./forecast";
import { candidatePool, now, regularQuota, rememberTypes, settleArcs, repairPlan } from "./inbox";
import { produce } from "./plan";
import type { DirectorPlan, GameState } from "./types";

/** The state next Monday's inbox will be built from. Null when there is no next week in this quarter. */
export function nextWeekPreview(s: GameState): GameState | null {
  if (!["friday", "back", "checkin"].includes(s.phase) || s.week >= 12 || s.level === "Director") return null;
  return { ...s, week: s.week + 1, recentTypes: rememberTypes(s), directorPlan: null };
}

export interface DirectorCandidate {
  id: string;
  type: string;
  category: string;
  canBeMustRespond: boolean;
  /** Picking this candidate opens a multi-week storyline about this person. */
  opensStoryline: boolean;
  title: string;
  from: string;
  /** The engineer the demand is about, if any, with the numbers that matter. */
  person: { name: string; morale: number; energy: number } | null;
  /** A second person the demand involves (the reviewer, the other side of a feud), or null. */
  alsoAbout: string | null;
  project: string | null;
}

/** Everything the director sees: a compact summary plus the candidates it may pick from. */
export interface DirectorBrief {
  quarter: number;
  week: number;
  company: string;
  level: string;
  pick: number;
  /** `staff` is who works on it; `forecastFinishWeek` is when it ships at current staffing (null: never). */
  projects: { name: string; percent: number; expectedPercent: number; dueWeek: number; status: string; flagship: boolean; staff: string[]; forecastFinishWeek: number | null }[];
  team: { name: string; morale: number; energy: number; loyalty: number | null; traits: string[]; project: string | null; onCall: boolean }[];
  /** Who carries the pager next week, or null when nobody does. */
  onCall: string | null;
  trust: Record<string, number>;
  meters: { techDebt: number; oncallLoad: number; stress: number; reputation: number };
  openPromises: { text: string; dueWeek: number }[];
  lastWeek: { good: boolean; biggestChanges: string[] } | null;
  recentEventTypes: string[];
  /** Storylines already running. Their next beats are scheduled by the engine, not picked. */
  storylines: { title: string; person: string; beat: string; dueThisWeek: boolean }[];
  midQuarterFocus: string | null;
  candidates: DirectorCandidate[];
}

const FOCUS = ["Recover delivery", "Protect the team", "Rebuild stakeholder trust"];

export function directorBrief(s: GameState): DirectorBrief | null {
  const next = nextWeekPreview(s);
  if (!next) return null;
  const pool = candidatePool(next);
  const projectName = (id: string | null) => next.projects.find((p) => p.id === id)?.name ?? null;
  const forecasts = forecastAll(next);
  const oncallId = next.plan.oncallId;
  return {
    quarter: next.quarter,
    week: next.week,
    company: next.company,
    level: next.level,
    pick: regularQuota(next, pool),
    projects: next.projects.map((p) => ({
      name: p.name,
      percent: Math.round((p.progress / p.scope) * 100),
      expectedPercent: Math.round((expectedProgress(p, next.week) / p.scope) * 100),
      dueWeek: p.dueWeek,
      status: p.status,
      flagship: p.flagship,
      staff: p.status === "active" ? next.engineers.filter((e) => e.projectId === p.id).map((e) => e.name) : [],
      forecastFinishWeek: forecasts[p.id]?.finishWeek ?? null,
    })),
    team: next.engineers.map((e) => ({
      name: e.name,
      morale: e.attrs.morale,
      energy: e.attrs.energy,
      loyalty: e.loyaltyKnown ? e.loyalty : null,
      traits: e.revealed,
      project: projectName(e.projectId),
      onCall: e.id === oncallId,
    })),
    onCall: next.engineers.find((e) => e.id === oncallId)?.name ?? null,
    trust: Object.fromEntries(next.stakeholders.map((x) => [x.role, x.trust])),
    meters: { techDebt: next.techDebt, oncallLoad: next.oncallLoad, stress: next.stress, reputation: next.reputation },
    openPromises: next.facts.filter((f) => f.status === "open").map((f) => ({ text: f.text, dueWeek: f.dueWeek })),
    lastWeek: s.lastWeek
      ? {
          good: s.lastWeek.good,
          biggestChanges: [...s.lastWeek.causes]
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
            .slice(0, 6)
            .map((c) => `${c.subject} ${c.delta > 0 ? "+" : ""}${c.delta}: ${c.why}`),
        }
      : null,
    recentEventTypes: next.recentTypes,
    storylines: settleArcs(next).arcs.map((a) => ({
      title: STORYLINES.find((x) => x.id === a.storyline)?.title ?? a.storyline,
      person: next.engineers.find((e) => e.id === a.subjectId)?.name ?? "",
      beat: a.beat,
      dueThisWeek: a.due <= now(next),
    })),
    midQuarterFocus: next.checkinFocus === null ? null : FOCUS[next.checkinFocus],
    candidates: pool.map((c) => {
      const body = c.type.build(c.ctx);
      const e = c.ctx.subject;
      return {
        id: c.id,
        type: c.type.id,
        category: c.type.cat,
        canBeMustRespond: c.type.canBeRequired,
        opensStoryline: !!c.storyline,
        title: body.title,
        from: body.from,
        person: e ? { name: e.name, morale: e.attrs.morale, energy: e.attrs.energy } : null,
        alsoAbout: c.ctx.other?.name ?? null,
        project: c.ctx.project?.name ?? null,
      };
    }),
  };
}

/**
 * Store the director's plan for next week if it is valid against the same pool the engine will use.
 * Returns the state unchanged (and the random draw will be used) when it is not.
 */
export function applyDirectorPlan(s: GameState, plan: DirectorPlan): { state: GameState; accepted: boolean } {
  const next = nextWeekPreview(s);
  if (!next) return { state: s, accepted: false };
  const valid = repairPlan(next, candidatePool(next), plan);
  if (!valid) return { state: s, accepted: false };
  return { state: produce(s, (d) => void (d.directorPlan = valid)), accepted: true };
}

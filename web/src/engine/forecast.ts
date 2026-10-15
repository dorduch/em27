// Forward-looking project status: when will each project finish at the current staffing?
// Used by the Projects screen, the staffing preview and the "nobody on it" warnings.

import { engineerOutput } from "./resolve";
import type { Engineer, GameState, Project } from "./types";

export type ForecastKind = "shipped" | "late-shipped" | "missed" | "on-track" | "behind" | "stalled";

export interface Forecast {
  kind: ForecastKind;
  weekly: number; // points per week at current staffing
  finishWeek: number | null; // week the project would ship; null if it never will
  dueWeek: number;
  team: number;
}

/** Progress lands on Friday, so planning in week `week` with weekly output w finishes in week + ceil(remaining / w) − 1. */
export function forecast(p: Project, engineers: Engineer[], techDebt: number, week: number): Forecast {
  const team = engineers.filter((e) => e.projectId === p.id);
  const weekly = Math.round(team.reduce((n, e) => n + engineerOutput(e, techDebt), 0));
  if (p.status !== "active") return { kind: p.status, weekly, finishWeek: null, dueWeek: p.dueWeek, team: team.length };
  if (weekly <= 0) return { kind: "stalled", weekly: 0, finishWeek: null, dueWeek: p.dueWeek, team: team.length };
  const remaining = Math.max(0, p.scope - p.progress);
  const finishWeek = week + Math.max(1, Math.ceil(remaining / weekly)) - 1;
  return { kind: finishWeek <= p.dueWeek ? "on-track" : "behind", weekly, finishWeek, dueWeek: p.dueWeek, team: team.length };
}

export function forecastAll(s: GameState, engineers: Engineer[] = s.engineers): Record<string, Forecast> {
  return Object.fromEntries(s.projects.map((p) => [p.id, forecast(p, engineers, s.techDebt, s.week)]));
}

/** What moving one engineer to `projectId` (or null to rest them) would do to every project. */
export function forecastMove(s: GameState, engineerId: string, projectId: string | null): Record<string, Forecast> {
  const moved = s.engineers.map((e) => (e.id === engineerId ? { ...e, projectId } : e));
  return forecastAll(s, moved);
}

/** One-line status for UI, e.g. "Behind: finishes wk 11, due wk 9". */
export function forecastLabel(f: Forecast): string {
  switch (f.kind) {
    case "shipped":
      return "Shipped";
    case "late-shipped":
      return "Shipped late";
    case "missed":
      return "Missed";
    case "stalled":
      return f.team ? `Stalled: no progress, due wk ${f.dueWeek}` : `Nobody on it: never finishes, due wk ${f.dueWeek}`;
    case "on-track":
      return `On track: finishes wk ${f.finishWeek}, due wk ${f.dueWeek}`;
    case "behind":
      return f.finishWeek! > 12
        ? `Behind: won’t finish this quarter, due wk ${f.dueWeek}`
        : `Behind: finishes wk ${f.finishWeek}, due wk ${f.dueWeek}`;
  }
}

export const forecastTone = (f: Forecast): "good" | "warn" | "bad" =>
  f.kind === "on-track" || f.kind === "shipped" ? "good" : f.kind === "late-shipped" ? "warn" : "bad";

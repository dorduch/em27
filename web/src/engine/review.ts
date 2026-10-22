// Quarterly review: rating math, grade, boss adjustment, and the outcome it implies.

import { PACKET_TARGET } from "@/content/companies";
import { expectedProgress } from "@/content/events";
import type { GameState, Grade, Project, ReviewResult } from "./types";

export const GRADES: Grade[] = ["Strongly Exceeds", "Exceeds", "Meets", "Partially Meets", "Does Not Meet"];
export const GRADE_FLOOR: Record<Grade, number> = {
  "Strongly Exceeds": 85,
  Exceeds: 72,
  Meets: 58,
  "Partially Meets": 45,
  "Does Not Meet": 0,
};
export const REVIEW_REPUTATION: Record<Grade, number> = {
  "Strongly Exceeds": 10,
  Exceeds: 6,
  Meets: 2,
  "Partially Meets": -3,
  "Does Not Meet": -8,
};
export const PROMOTION_REPUTATION = 60;

const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function weightedScore(delivery: number, team: number, trust: number): number {
  return round1(delivery * 0.4 + team * 0.3 + trust * 0.3);
}

export function gradeFor(score: number): Grade {
  return GRADES.find((g) => score >= GRADE_FLOOR[g])!;
}

/** Boss Trust can move the grade at most one step either way. */
export function bossSteps(skipTrust: number): -1 | 0 | 1 {
  if (skipTrust >= 75) return 1;
  if (skipTrust <= 30) return -1;
  return 0;
}

export function shiftGrade(g: Grade, steps: -1 | 0 | 1): Grade {
  const i = GRADES.indexOf(g) - steps;
  return GRADES[Math.max(0, Math.min(GRADES.length - 1, i))];
}

/** Active projects are scored against where they should be by now, so mid-quarter numbers are fair. */
export function projectScore(p: Project, week: number): number {
  if (p.status === "shipped") return 100;
  if (p.status === "late-shipped") return 70;
  const frac = p.progress / p.scope;
  if (p.status === "missed") return Math.round(60 * frac);
  const expected = Math.max(1, expectedProgress(p, week + 1));
  return Math.round(Math.min(100, (100 * p.progress) / expected));
}

/** The quarter's committed projects, plus stretch follow-ons only when counting them helps. */
export function deliveryScore(s: GameState): number {
  const core = s.projects.filter((p) => !p.stretch).map((p) => projectScore(p, s.week));
  const all = s.projects.map((p) => projectScore(p, s.week));
  return Math.round(Math.max(avg(core), avg(all)));
}

export function teamScore(s: GameState): number {
  const morale = avg(s.engineers.map((e) => e.attrs.morale));
  const energy = avg(s.engineers.map((e) => e.attrs.energy));
  return Math.max(0, Math.min(100, Math.round((morale / 20) * 45 + (energy / 20) * 35 + 20 - 5 * s.departuresThisQuarter)));
}

export function trustScore(s: GameState): number {
  return Math.round(avg(s.stakeholders.map((x) => x.trust)));
}

export function isStrong(g: Grade): boolean {
  return g === "Strongly Exceeds" || g === "Exceeds";
}

export function computeReview(s: GameState): ReviewResult {
  const delivery = deliveryScore(s);
  const team = teamScore(s);
  const trust = trustScore(s);
  const weighted = weightedScore(delivery, team, trust);
  const baseGrade = gradeFor(weighted);
  const skip = s.stakeholders.find((x) => x.role === "skip")!;
  const steps = bossSteps(skip.trust);
  const grade = shiftGrade(baseGrade, steps);

  const repAfter = s.reputation + REVIEW_REPUTATION[grade];
  const packetApproved = s.company === "Google" ? s.packet >= PACKET_TARGET : undefined;
  const fired = grade === "Does Not Meet" || (grade === "Partially Meets" && s.partialStreak >= 1);
  const streak = isStrong(grade) ? s.strongStreak + 1 : 0;
  const promote =
    !fired && streak >= 2 && repAfter >= PROMOTION_REPUTATION && (s.company !== "Google" || packetApproved === true);

  let outcome: ReviewResult["outcome"] = "stay";
  if (fired) outcome = s.firings >= 1 ? "run-over" : "fired";
  else if (promote) outcome = s.level === "Senior EM" ? "win" : "promotion";

  const notes: string[] = [];
  if (outcome === "promotion" || outcome === "win") notes.push("Two consecutive Exceeds-or-better reviews plus sufficient Reputation.");
  else if (fired) notes.push(grade === "Does Not Meet" ? "Does Not Meet → firing." : "Partially Meets twice in a row → firing.");
  else if (isStrong(grade)) {
    if (streak < 2) notes.push("Promotion progress: 1 of 2 strong quarters.");
    else if (repAfter < PROMOTION_REPUTATION) notes.push(`Two strong quarters, but Reputation ${repAfter} is below ${PROMOTION_REPUTATION}.`);
    else if (packetApproved === false) notes.push(`Calibration: not this cycle. Packet ${s.packet}/${PACKET_TARGET}.`);
  } else if (grade === "Partially Meets") notes.push("Warning: another Partially Meets means a firing.");
  else notes.push("Promotion progress resets. Another strong quarter starts the streak.");

  return {
    delivery,
    team,
    trust,
    weighted,
    baseGrade,
    bossSteps: steps,
    grade,
    outcome,
    letter: reviewLetter(s, { delivery, team, trust, grade, outcome }),
    packetApproved,
    notes,
  };
}

/** "A", "A and B", "A, B and C". */
const listOf = (xs: string[]) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function reviewLetter(
  s: GameState,
  r: { delivery: number; team: number; trust: number; grade: Grade; outcome: ReviewResult["outcome"] },
): string[] {
  const shipped = s.projects.filter((p) => p.status === "shipped" || p.status === "late-shipped");
  const missed = s.projects.filter((p) => p.status === "missed");
  const broken = s.facts.filter((f) => f.quarter === s.quarter && f.status === "broken").length;
  const left = s.departuresThisQuarter;
  const flagship = s.projects.find((p) => p.flagship);
  const lines: string[] = [];
  if (shipped.length) lines.push(`“You shipped ${listOf(shipped.map((p) => p.name))}. That matters.`);
  else lines.push("“I was hoping to see something ship this quarter.");
  if (s.company === "Vercel" && flagship?.status === "shipped") lines.push(`“${flagship.name} on stage at the keynote was the moment of the quarter.`);
  if (missed.length) lines.push(`“${listOf(missed.map((p) => p.name))} missed ${missed.length > 1 ? "their dates" : "its date"}, and I heard about it before you told me.`);
  if (left) lines.push(`“${left === 1 ? "Losing someone" : `Losing ${left} people`} in one quarter is something I noticed. So did your team.`);
  if (r.team < 55) lines.push("“Your team is tired. A team that needs a recovery quarter is not a plan.");
  else if (r.team >= 75 && !left) lines.push("“Your team is still here, and still wants to be. Don’t underestimate that.");
  if (broken) lines.push(`“${broken === 1 ? "A promise" : `${broken} promises`} didn’t make it. People remember those.`);
  if (r.trust < 50) lines.push("“Stakeholders are not convinced yet.");
  lines.push(
    r.outcome === "promotion" || r.outcome === "win"
      ? "“You’re ready for the next level.”"
      : r.outcome === "fired" || r.outcome === "run-over"
        ? "“We needed a different quarter.”"
        : "“Now make it repeatable.”",
  );
  return lines;
}

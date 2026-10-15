// Career run: review outcomes, job hunt, poaching offers, new jobs, recap.

import { COMPANIES, COMPANY_IDS } from "@/content/companies";
import { STAKEHOLDER_POOL } from "@/content/people";
import { fillInbox } from "./inbox";
import { capacityFor, produce } from "./plan";
import { REVIEW_REPUTATION, isStrong } from "./review";
import { makeRng } from "./rng";
import { autoAssign, makeEngineer, makeProjects, makeSquad, TEAM_SIZE } from "./setup";
import type { CompanyId, GameState, Level, Offer, StakeholderRole } from "./types";

export const FIRING_REPUTATION = -20;
export const POACH_CHANCE = 0.5;

function salaryFor(company: CompanyId, level: Level, rng: ReturnType<typeof makeRng>): number {
  const base = COMPANIES[company].salary[level === "Director" ? "Senior EM" : level];
  return base + rng.int(-2, 4) * 5000;
}

/** Start the next quarter at the same company with the same squad. */
export function newQuarter(s: GameState): GameState {
  return produce(s, (d) => {
    const rng = makeRng(d.seed, d.quarter + 1, "new-quarter");
    d.quarter += 1;
    d.week = 1;
    d.phase = "plan";
    d.review = null;
    d.departuresThisQuarter = 0;
    d.checkinFocus = null;
    d.pendingOffer = null;
    d.offers = [];
    d.packet = d.company === "Google" ? Math.floor(d.packet / 2) : 0;
    if (d.level !== "Director") {
      const max = TEAM_SIZE[d.level];
      const used = new Set(d.engineers.map((e) => e.name));
      while (d.engineers.length < max) {
        const hire = makeEngineer(rng, `e${d.nextId++}`, used);
        hire.tenure = "new";
        d.engineers.push(hire);
      }
      d.projects = makeProjects(rng, d.company, d.level, d.nextId);
      d.nextId += 10;
    }
    for (const e of d.engineers) {
      e.attrs.energy = Math.min(20, e.attrs.energy + 3);
      e.projectId = null;
    }
    autoAssign(d.engineers, d.projects);
    // Promises still open at quarter end (made too late to come due) carry over to week 2.
    d.facts = d.facts
      .filter((f) => f.status === "open" && d.engineers.some((e) => e.id === f.subjectId))
      .map((f) => ({ ...f, quarter: d.quarter, dueWeek: 2 }));
    d.quarterEvents = [];
    d.capacity = capacityFor(d.level, d.stress);
    d.plan = { choices: {}, oneOnOnes: [], focus: false, spend: [], oncallId: d.plan.oncallId && d.engineers.some((e) => e.id === d.plan.oncallId) ? d.plan.oncallId : d.engineers[0]?.id ?? null };
    d.recentTypes = [];
    fillInbox(d);
  });
}

function huntOffers(d: GameState): Offer[] {
  const rng = makeRng(d.seed, d.quarter, "hunt");
  const level: Level = d.reputation >= 40 ? d.level : "EM";
  const others = COMPANY_IDS.filter((c) => c !== d.company);
  const count = d.reputation < 30 ? 1 : others.length;
  return rng.shuffle(others).slice(0, count).map((company) => ({ company, level, salary: salaryFor(company, level, rng), kind: "hunt" }));
}

/** Apply the review: history, streaks, Reputation, then route to the next phase. */
export function applyReview(s: GameState): GameState {
  const r = s.review;
  if (s.phase !== "review" || !r) return s;
  const next = produce(s, (d) => {
    d.history.push({ quarter: d.quarter, company: d.company, level: d.level, grade: r.grade, score: r.weighted });
    d.reputation = Math.max(0, Math.min(100, d.reputation + REVIEW_REPUTATION[r.grade]));
    d.strongStreak = isStrong(r.grade) ? d.strongStreak + 1 : 0;
    d.partialStreak = r.grade === "Partially Meets" ? d.partialStreak + 1 : 0;
  });
  switch (r.outcome) {
    case "win":
      return produce(next, (d) => {
        d.level = "Director";
        d.runEnd = "win";
        d.phase = "recap";
      });
    case "run-over":
      return produce(next, (d) => {
        d.firings += 1;
        d.reputation = Math.max(0, d.reputation + FIRING_REPUTATION);
        d.runEnd = "loss";
        d.phase = "recap";
      });
    case "fired":
      return produce(next, (d) => {
        d.firings += 1;
        d.reputation = Math.max(0, d.reputation + FIRING_REPUTATION);
        d.strongStreak = 0;
        d.partialStreak = 0;
        d.offers = huntOffers(d);
        d.phase = "hunt";
      });
    case "promotion": {
      const promoted = produce(next, (d) => {
        d.level = "Senior EM";
        d.strongStreak = 0;
      });
      return newQuarter(promoted);
    }
    default: {
      const rng = makeRng(s.seed, s.quarter, "poach");
      if (isStrong(r.grade) && rng.chance(POACH_CHANCE)) {
        return produce(next, (d) => {
          const company = rng.pick(COMPANY_IDS.filter((c) => c !== d.company));
          const level: Level = d.level === "EM" && d.reputation >= 55 ? "Senior EM" : d.level;
          d.pendingOffer = { company, level, salary: salaryFor(company, level, rng) + 15000, kind: "poach" };
          d.phase = "offer";
        });
      }
      return newQuarter(next);
    }
  }
}

export function chooseOffer(s: GameState, offer: Offer): GameState {
  return produce(s, (d) => {
    d.pendingOffer = offer;
    d.phase = "offer";
  });
}

export function backToHunt(s: GameState): GameState {
  return produce(s, (d) => {
    d.pendingOffer = null;
    d.phase = "hunt";
  });
}

export function acceptOffer(s: GameState): GameState {
  if (!s.pendingOffer) return s;
  return produce(s, (d) => void (d.phase = "farewell"));
}

export function declineOffer(s: GameState): GameState {
  const next = produce(s, (d) => {
    for (const e of d.engineers) e.loyalty = Math.min(20, e.loyalty + 2);
    d.pendingOffer = null;
  });
  return newQuarter(next);
}

export function leverageOffer(s: GameState): GameState {
  const rng = makeRng(s.seed, s.quarter, "leverage");
  const next = produce(s, (d) => {
    d.capital += 10;
    const skip = d.stakeholders.find((x) => x.role === "skip")!;
    skip.trust = Math.max(0, skip.trust - 8);
    if (rng.chance(0.3)) {
      skip.trust = Math.max(0, skip.trust - 10);
      d.reputation = Math.max(0, d.reputation - 3);
    }
    d.pendingOffer = null;
  });
  return newQuarter(next);
}

/** Leave the squad behind and start the new job. Reputation carries; promotion progress resets. */
export function startNewJob(s: GameState): GameState {
  const offer = s.pendingOffer;
  if (!offer || offer.level === "Director") return s;
  const level = offer.level;
  const moved = produce(s, (d) => {
    const rng = makeRng(d.seed, d.quarter, "new-job", offer.company);
    d.company = offer.company;
    d.level = level;
    d.engineers = makeSquad(rng, TEAM_SIZE[level], d.nextId);
    d.nextId += 20;
    const roles: StakeholderRole[] = ["skip", "pm", "peer"];
    d.stakeholders = roles.map((role) => {
      const p = rng.pick(STAKEHOLDER_POOL[role]);
      return { role, name: p.name, quote: p.quote, trust: rng.int(50, 60) };
    });
    d.techDebt = rng.int(24, 40);
    d.oncallLoad = rng.int(30, 45);
    d.packet = 0;
    d.strongStreak = 0;
    d.partialStreak = 0;
    d.incidentMultiplier = 1;
    d.pendingPostmortem = null;
    // Promises made to the squad you leave behind lapse; they count as broken.
    d.stats.promisesBroken += d.facts.filter((f) => f.status === "open").length;
    d.facts = [];
    d.plan.oncallId = null;
    d.history.push({ quarter: d.quarter, company: d.company, level, grade: "New role" });
  });
  return newQuarter(moved);
}

export interface Recap {
  win: boolean;
  path: string;
  quarters: number;
  history: { label: string; grade: string }[];
  projectsShipped: number;
  incidents: number;
  promisesKept: number;
  promisesBroken: number;
  best?: string;
  gotAway?: string;
  headline: string[];
}

export function buildRecap(s: GameState): Recap {
  const steps: string[] = [];
  for (const h of s.history) {
    const step = `${h.company} ${h.level}`;
    if (steps[steps.length - 1] !== step) steps.push(step);
  }
  if (s.runEnd === "win") steps.push("Director");
  const best = [...s.engineers].sort((a, b) => b.attrs.coding + b.attrs.morale - (a.attrs.coding + a.attrs.morale))[0];
  const win = s.runEnd === "win";
  return {
    win,
    path: steps.join(" → "),
    quarters: s.history.filter((h) => h.grade !== "New role").length,
    history: s.history.filter((h) => h.grade !== "New role").map((h) => ({ label: `Q${h.quarter} · ${h.company} · ${h.level}`, grade: h.grade })),
    projectsShipped: s.stats.projectsShipped,
    incidents: s.stats.incidents,
    promisesKept: s.stats.promisesKept,
    promisesBroken: s.stats.promisesBroken,
    best: best?.name,
    gotAway: s.stats.departed[0],
    headline: win
      ? s.stats.incidents >= 5
        ? [`Survived ${s.stats.incidents} incidents.`, "Never wrote the quick deck."]
        : ["Director.", "The calendar finally works for you."]
      : ["The calendar won.", "Twice."],
  };
}

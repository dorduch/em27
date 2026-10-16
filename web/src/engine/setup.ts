import { COMPANIES, KEYNOTE_WEEK } from "@/content/companies";
import { BIOS, FIRST_NAMES, LAST_NAMES, STAKEHOLDER_POOL } from "@/content/people";
import { makeRng, type Rng } from "./rng";
import type {
  CompanyId,
  Engineer,
  GameState,
  Level,
  Project,
  StakeholderRole,
  Stakeholder,
  Trait,
} from "./types";
import { fillInbox } from "./inbox";

export const TEAM_SIZE: Record<Exclude<Level, "Director">, number> = { EM: 6, "Senior EM": 8 };
export const BASE_SLOTS: Record<Exclude<Level, "Director">, number> = { EM: 8, "Senior EM": 9 };
const PROJECTS: Record<Exclude<Level, "Director">, number> = { EM: 3, "Senior EM": 4 };

const TRAITS: Trait[] = ["flight-risk", "hero-coder", "quiet-genius", "drama-magnet", "wants-to-lead", "steady"];

const clamp = (v: number, lo = 1, hi = 20) => Math.max(lo, Math.min(hi, v));

export function makeEngineer(rng: Rng, id: string, usedNames: Set<string>): Engineer {
  // First names stay unique within a squad so commentary like "Theo and Jonah" is unambiguous.
  const usedFirst = new Set([...usedNames].map((n) => n.split(" ")[0]));
  let name = "";
  for (let i = 0; i < 80 && (!name || usedNames.has(name) || usedFirst.has(name.split(" ")[0])); i++) {
    name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
  }
  usedNames.add(name);
  const level = rng.pick([3, 4, 4, 4, 5, 5, 6]);
  const skill = (lo: number, hi: number) => clamp(rng.int(lo, hi) + (level - 4));
  const traits = rng.shuffle(TRAITS).slice(0, rng.int(1, 2));
  const tenureMonths = rng.int(2, 60);
  return {
    id,
    name,
    level,
    tenure: tenureMonths < 12 ? `${tenureMonths}mo` : `${Math.floor(tenureMonths / 12)}y`,
    bio: rng.pick(BIOS),
    attrs: {
      coding: skill(9, 16),
      debugging: skill(7, 15),
      communication: skill(7, 16),
      ambition: clamp(rng.int(7, 18) + (traits.includes("wants-to-lead") ? 2 : 0)),
      morale: rng.int(10, 16),
      energy: rng.int(11, 17),
    },
    loyalty: clamp(rng.int(7, 16) - (traits.includes("flight-risk") ? 4 : 0)),
    loyaltyKnown: false,
    traits,
    revealed: [],
    scout: 0,
    projectId: null,
    log: [],
  };
}

function makeStakeholders(rng: Rng): Stakeholder[] {
  const roles: StakeholderRole[] = ["skip", "pm", "peer"];
  return roles.map((role) => {
    const p = rng.pick(STAKEHOLDER_POOL[role]);
    return { role, name: p.name, quote: p.quote, trust: rng.int(50, 62) };
  });
}

export function makeProjects(
  rng: Rng,
  company: CompanyId,
  level: Exclude<Level, "Director">,
  idBase: number,
): Project[] {
  const names = rng.shuffle(COMPANIES[company].projectNames);
  const owners: StakeholderRole[] = ["pm", "skip", "peer", "skip"];
  // Staggered deadlines so the quarter has rhythm. Vercel's flagship is pinned to the keynote.
  const dues = level === "EM" ? [6, 9, 12] : [5, 8, 10, 12];
  const projects = Array.from({ length: PROJECTS[level] }, (_, i) => ({
    id: `p${idBase + i}`,
    name: names[i],
    owner: owners[i],
    scope: 100,
    progress: 0,
    startWeek: 1,
    dueWeek: dues[i],
    flagship: i === 0,
    status: "active" as const,
  }));
  if (company === "Vercel") projects[0].dueWeek = KEYNOTE_WEEK;
  return projects;
}

/** Spread engineers across projects, strongest coders first. */
export function autoAssign(engineers: Engineer[], projects: Project[]): void {
  const open = projects.filter((p) => p.status === "active");
  if (!open.length) return;
  [...engineers]
    .sort((a, b) => b.attrs.coding - a.attrs.coding)
    .forEach((e, i) => (e.projectId = open[i % open.length].id));
}

export function makeSquad(rng: Rng, size: number, idBase: number): Engineer[] {
  const used = new Set<string>();
  return Array.from({ length: size }, (_, i) => makeEngineer(rng, `e${idBase + i}`, used));
}

export function newGame(company: CompanyId, seed: number): GameState {
  const rng = makeRng(seed, "new-game");
  const engineers = makeSquad(rng, TEAM_SIZE.EM, 1);
  const projects = makeProjects(rng, company, "EM", 1);
  autoAssign(engineers, projects);
  const oncall = [...engineers].sort((a, b) => b.attrs.debugging - a.attrs.debugging)[0];
  const s: GameState = {
    version: 1,
    seed,
    company,
    level: "EM",
    quarter: 1,
    week: 1,
    phase: "plan",
    engineers,
    projects,
    stakeholders: makeStakeholders(rng),
    techDebt: rng.int(24, 36),
    oncallLoad: rng.int(30, 45),
    stress: 30,
    capital: 20,
    reputation: 50,
    packet: 0,
    firings: 0,
    strongStreak: 0,
    partialStreak: 0,
    history: [],
    facts: [],
    inbox: [],
    plan: { choices: {}, oneOnOnes: [], focus: false, spend: [], oncallId: oncall.id },
    capacity: BASE_SLOTS.EM,
    recentTypes: [],
    quarterEvents: [],
    arcs: [],
    arcHistory: [],
    directorPlan: null,
    inboxSource: { by: "random" },
    pendingPostmortem: null,
    incidentMultiplier: 1,
    departuresThisQuarter: 0,
    checkinFocus: null,
    lastWeek: null,
    review: null,
    offers: [],
    pendingOffer: null,
    runEnd: null,
    stats: { projectsShipped: 0, incidents: 0, promisesKept: 0, promisesBroken: 0, departed: [] },
    nextId: 100,
  };
  fillInbox(s);
  return s;
}

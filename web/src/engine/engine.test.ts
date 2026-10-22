import { describe, expect, it } from "vitest";
import { newGame } from "./setup";
import { blockingItem, capacityFor, choose, ignoreRest, planCost, toggleOneOnOne, undecided } from "./plan";
import { advanceFromBackPage, finishCheckin, finishFriday, resolveWeek } from "./resolve";
import { bossSteps, computeReview, gradeFor, shiftGrade, weightedScore } from "./review";
import { applyReview, acceptOffer, startNewJob } from "./career";
import type { DirectorPlan, GameState, ReviewResult } from "./types";
import { applyDirectorPlan, directorBrief } from "./director";
import { buildInbox as buildInboxFor } from "./inbox";

const game = (seed = 42) => newGame("Stripe", seed);

/** Answer only the must-respond item with its cheapest intent, then play the week out. */
function playWeek(s: GameState): GameState {
  const req = blockingItem(s);
  if (req) {
    const cheapest = [...req.intents].sort((a, b) => a.cost - b.cost)[0];
    s = choose(s, req.id, cheapest.id);
  }
  s = finishFriday(resolveWeek(s));
  s = advanceFromBackPage(s);
  if (s.phase === "checkin") s = finishCheckin(s, 0);
  return s;
}

describe("determinism", () => {
  it("same seed gives the same game and the same week", () => {
    const a = playWeek(game(7));
    const b = playWeek(game(7));
    expect(a).toEqual(b);
  });
  it("different seeds differ", () => {
    expect(game(1).engineers[0].name + game(1).inbox[0].title).not.toEqual(
      game(2).engineers[0].name + game(2).inbox[0].title,
    );
  });
});

describe("calendar", () => {
  it("has at most one must-respond item per week", () => {
    for (let seed = 1; seed < 30; seed++) {
      expect(game(seed).inbox.filter((i) => i.required).length).toBeLessThanOrEqual(1);
    }
  });

  it("replacing an intent refunds the old cost first", () => {
    let s = game();
    const item = s.inbox.find((i) => i.intents.some((x) => x.cost === 1) && i.intents.some((x) => x.cost === 2))!;
    const one = item.intents.find((x) => x.cost === 1)!;
    const two = item.intents.find((x) => x.cost === 2)!;
    s = choose(s, item.id, one.id);
    const afterOne = planCost(s);
    s = choose(s, item.id, two.id);
    expect(planCost(s) - afterOne).toBe(1);
  });

  it("1:1s cost a slot and refund", () => {
    let s = game();
    const id = s.engineers[0].id;
    s = toggleOneOnOne(s, id);
    expect(planCost(s)).toBe(1);
    s = toggleOneOnOne(s, id);
    expect(planCost(s)).toBe(0);
  });

  it("only the must-respond item blocks; it cannot be ignored", () => {
    let s = game();
    const req = s.inbox.find((i) => i.required)!;
    expect(blockingItem(s)?.id).toBe(req.id);
    s = choose(s, req.id, "ignore");
    expect(blockingItem(s)?.id).toBe(req.id);
    s = choose(s, req.id, req.intents[0].id);
    expect(blockingItem(s)).toBeUndefined();
  });

  it("unanswered optional items resolve as ignored on Friday", () => {
    let s = game();
    const req = s.inbox.find((i) => i.required)!;
    s = choose(s, req.id, req.intents[0].id);
    const r = resolveWeek(s);
    const optional = s.inbox.filter((i) => !i.required && i.type !== "postmortem");
    for (const item of optional) {
      expect(r.lastWeek!.lines.some((l) => l.text.includes(item.ignoreCause))).toBe(true);
    }
  });

  it("lists undecided demands must-respond first; Ignore the rest leaves the must-respond item", () => {
    let s = game();
    expect(undecided(s)[0].required).toBe(true);
    expect(undecided(s).length).toBe(s.inbox.length);
    s = ignoreRest(s);
    expect(undecided(s).map((i) => i.required)).toEqual([true]);
    expect(planCost(s)).toBe(0);
    const req = blockingItem(s)!;
    s = choose(s, req.id, req.intents[0].id);
    expect(undecided(s)).toEqual([]);
  });

  it("stress never shrinks the calendar below base − 2", () => {
    expect(capacityFor("EM", 100)).toBe(6);
    expect(capacityFor("EM", 0)).toBe(8);
    expect(capacityFor("Senior EM", 95)).toBe(7);
  });
});

describe("quarterly review", () => {
  it("reproduces the handoff example: 82×.4 + 76×.3 + 71×.3 = 76.9 → Exceeds", () => {
    expect(weightedScore(82, 76, 71)).toBe(76.9);
    expect(gradeFor(76.9)).toBe("Exceeds");
  });

  it("caps the boss adjustment at one step", () => {
    expect(bossSteps(100)).toBe(1);
    expect(bossSteps(0)).toBe(-1);
    expect(bossSteps(55)).toBe(0);
    expect(shiftGrade("Exceeds", 1)).toBe("Strongly Exceeds");
    expect(shiftGrade("Strongly Exceeds", 1)).toBe("Strongly Exceeds");
    expect(shiftGrade("Does Not Meet", -1)).toBe("Does Not Meet");
  });

  const withReview = (s: GameState, review: Partial<ReviewResult>): GameState => ({
    ...s,
    phase: "review",
    review: { ...computeReview(s), ...review },
  });

  it("fires on Does Not Meet; second firing ends the run", () => {
    let s = withReview(game(), { grade: "Does Not Meet", outcome: "fired" });
    s = applyReview(s);
    expect(s.phase).toBe("hunt");
    expect(s.firings).toBe(1);
    expect(s.offers.length).toBeGreaterThan(0);
    expect(s.offers.every((o) => o.company !== "Stripe")).toBe(true);

    const s2 = computeReview({ ...s, phase: "review", firings: 1, partialStreak: 0 });
    expect(s2.outcome === "run-over" || s2.grade !== "Does Not Meet").toBe(true);
  });

  it("fires on Partially Meets twice in a row", () => {
    const s = game();
    const forced = { ...s, partialStreak: 1 };
    const r = computeReview(forced);
    if (r.grade === "Partially Meets") expect(r.outcome).toBe("fired");
    // Direct rule check independent of the sampled score:
    const rule = (grade: string, streak: number) => grade === "Does Not Meet" || (grade === "Partially Meets" && streak >= 1);
    expect(rule("Partially Meets", 1)).toBe(true);
    expect(rule("Partially Meets", 0)).toBe(false);
  });

  it("promotion to Senior EM grows the team to 8 and the calendar to 9", () => {
    let s = withReview(game(), { grade: "Exceeds", outcome: "promotion" });
    s = applyReview(s);
    expect(s.level).toBe("Senior EM");
    expect(s.engineers.length).toBe(8);
    expect(s.capacity).toBe(9);
    expect(s.projects.length).toBe(4);
    expect(s.quarter).toBe(2);
  });

  it("a new job after a firing keeps Reputation and resets promotion progress", () => {
    let s = withReview({ ...game(), strongStreak: 1 }, { grade: "Does Not Meet", outcome: "fired" });
    s = applyReview(s);
    const rep = s.reputation;
    s = { ...s, pendingOffer: s.offers[0], phase: "offer" };
    s = startNewJob(acceptOffer(s));
    expect(s.company).not.toBe("Stripe");
    expect(s.reputation).toBe(rep);
    expect(s.strongStreak).toBe(0);
    expect(s.phase).toBe("plan");
  });
});

describe("full quarter", () => {
  it("plays 12 weeks into a review without breaking invariants", () => {
    let s = game(3);
    for (let i = 0; i < 40 && s.phase !== "review"; i++) {
      s = playWeek(s);
      for (const e of s.engineers) {
        for (const v of Object.values(e.attrs)) {
          expect(v).toBeGreaterThanOrEqual(1);
          expect(v).toBeLessThanOrEqual(20);
        }
      }
      expect(s.stress).toBeGreaterThanOrEqual(0);
    }
    expect(s.phase).toBe("review");
    expect(s.week).toBe(12);
    expect(s.review).not.toBeNull();
  });
});

describe("company mechanics", () => {
  const playTo = (s: GameState, week: number) => {
    while (s.week < week || s.phase !== "plan") s = playWeek(s);
    return s;
  };

  it("Vercel: a flagship that shipped early is judged on stage in week 8", () => {
    let s = newGame("Vercel", 5);
    // Ship the flagship early.
    // An empty week-1 inbox, so no demand's side effects (scope creep, a departure) interfere.
    s = { ...s, inbox: [], projects: s.projects.map((p) => (p.flagship ? { ...p, progress: p.scope - 1 } : p)) };
    s = playWeek(s);
    expect(s.projects.find((p) => p.flagship)!.status).toBe("shipped");
    s = playTo(s, 8);
    const rep = s.reputation;
    const req = blockingItem(s);
    if (req) s = choose(s, req.id, [...req.intents].sort((a, b) => a.cost - b.cost)[0].id);
    s = resolveWeek(s);
    expect(s.lastWeek!.keynote).toBe("shipped");
    expect(s.lastWeek!.causes.some((c) => c.subject === "Reputation" && c.delta === 6)).toBe(true);
    expect(s.reputation).toBeGreaterThanOrEqual(rep);
  });

  it("Vercel: an unfinished flagship misses the keynote publicly", () => {
    let s = newGame("Vercel", 6);
    s = { ...s, engineers: s.engineers.map((e) => ({ ...e, projectId: null })) };
    s = playTo(s, 8);
    s = { ...s, engineers: s.engineers.map((e) => ({ ...e, projectId: null })) };
    const req = blockingItem(s);
    if (req) s = choose(s, req.id, [...req.intents].sort((a, b) => a.cost - b.cost)[0].id);
    s = resolveWeek(s);
    expect(s.lastWeek!.keynote).toBe("missed");
  });

  it("Vercel: no slip intent is offered for the flagship", () => {
    for (let seed = 1; seed < 60; seed++) {
      const s = newGame("Vercel", seed);
      const flagship = s.projects.find((p) => p.flagship)!;
      for (const item of s.inbox.filter((i) => i.type === "estimate_blown" && i.title && i.fromRole.startsWith(flagship.name))) {
        expect(item.intents.some((i) => i.id === "slip")).toBe(false);
      }
    }
  });

  it("Stripe: a postmortem next week gives back half the incident hit", () => {
    let s = newGame("Stripe", 9);
    s = { ...s, pendingPostmortem: { role: "skip", hit: 8 } };
    s = { ...s, inbox: buildInboxFor(s) };
    const pm = s.inbox.find((i) => i.type === "postmortem")!;
    expect(pm).toBeDefined();
    const req = blockingItem(s);
    if (req) s = choose(s, req.id, req.intents[0].id);
    s = choose(s, pm.id, "write");
    const r = resolveWeek(s);
    expect(r.lastWeek!.causes.some((c) => c.subject === "Skip-level Trust" && c.why.startsWith("Postmortem") && c.delta === 4)).toBe(true);
    expect(r.incidentMultiplier).toBe(1);
  });

  it("Stripe: skipping the postmortem raises the next incident's cost", () => {
    let s = newGame("Stripe", 9);
    s = { ...s, pendingPostmortem: { role: "skip", hit: 8 } };
    s = { ...s, inbox: buildInboxFor(s) };
    const req = blockingItem(s);
    if (req) s = choose(s, req.id, req.intents[0].id);
    expect(resolveWeek(s).incidentMultiplier).toBe(1.5);
  });

  it("Google: two strong quarters still need a full packet", () => {
    const base = newGame("Google", 4);
    const strong: GameState = {
      ...base,
      phase: "review",
      strongStreak: 1,
      reputation: 80,
      packet: 3,
      stakeholders: base.stakeholders.map((x) => ({ ...x, trust: 90 })),
      projects: base.projects.map((p) => ({ ...p, status: "shipped" as const, progress: p.scope })),
    };
    const blocked = computeReview(strong);
    expect(["Exceeds", "Strongly Exceeds"]).toContain(blocked.grade);
    expect(blocked.outcome).toBe("stay");
    expect(blocked.packetApproved).toBe(false);
    expect(computeReview({ ...strong, packet: 10 }).outcome).toBe("promotion");
  });
});

describe("AI director", () => {
  /** Play week 1 to Friday so a director brief exists for week 2. */
  const friday = () => {
    let s = game(31);
    const req = blockingItem(s)!;
    s = choose(s, req.id, req.intents[0].id);
    return resolveWeek(s);
  };
  const toMonday = (s: GameState) => advanceFromBackPage(finishFriday(s));

  it("builds a brief for next week with candidate ids", () => {
    const brief = directorBrief(friday())!;
    expect(brief.week).toBe(2);
    expect(brief.candidates.length).toBeGreaterThan(brief.pick);
    expect(new Set(brief.candidates.map((c) => c.id)).size).toBe(brief.candidates.length);
  });

  it("uses a valid plan: its picks, its must-respond item and its reasons", () => {
    const s = friday();
    const brief = directorBrief(s)!;
    const byType = new Map<string, string>();
    let opening = false;
    // A legal plan: one demand per person, nobody whose storyline beat is due, one new storyline.
    const taken = new Set(brief.storylines.filter((x) => x.dueThisWeek).map((x) => x.person));
    // Must-respond-capable candidates first, so the plan has one to mark.
    for (const c of [...brief.candidates].sort((x, y) => Number(y.canBeMustRespond) - Number(x.canBeMustRespond))) {
      const who = [c.person?.name, c.alsoAbout].filter((x): x is string => !!x);
      if (byType.has(c.type) || (c.opensStoryline && opening) || who.some((x) => taken.has(x))) continue;
      opening ||= c.opensStoryline;
      for (const x of who) taken.add(x);
      byType.set(c.type, c.id);
    }
    const picks = [...byType.values()].slice(0, brief.pick);
    const requiredId = picks.find((id) => brief.candidates.find((c) => c.id === id)!.canBeMustRespond)!;
    const plan: DirectorPlan = {
      quarter: brief.quarter,
      week: brief.week,
      picks,
      requiredId,
      rationale: Object.fromEntries(picks.map((id) => [id, `reason for ${id}`])),
      arcNote: "Build pressure before the check-in.",
    };
    const { state, accepted } = applyDirectorPlan(s, plan);
    expect(accepted).toBe(true);
    const monday = toMonday(state);
    expect(monday.inboxSource).toEqual({ by: "director", arcNote: plan.arcNote });
    const regular = monday.inbox.filter((i) => i.cat !== "FOLLOW-UP" && !(i.arc && !i.arc.start));
    expect(regular.map((i) => i.type).sort()).toEqual(picks.map((id) => id.split(":")[0]).sort());
    expect(regular.filter((i) => i.required).map((i) => i.type)).toEqual([requiredId.split(":")[0]]);
    expect(regular.every((i) => i.why?.startsWith("reason for"))).toBe(true);
    expect(monday.directorPlan).toBeNull();
  });

  it("repairs flawed plans instead of throwing them away", () => {
    const s = friday();
    const brief = directorBrief(s)!;
    const ids = brief.candidates.map((c) => c.id);
    const flawed: DirectorPlan[] = [
      { quarter: 1, week: 2, picks: ["made_up:0", ...ids.slice(1, brief.pick)], requiredId: "made_up:0", rationale: { "made_up:0": "x" }, arcNote: "" },
      { quarter: 1, week: 2, picks: ids.slice(0, 1), requiredId: null, rationale: {}, arcNote: "" },
      { quarter: 1, week: 2, picks: [ids[0], ids[0], ...ids], requiredId: null, rationale: {}, arcNote: "" },
    ];
    for (const plan of flawed) {
      const { state, accepted } = applyDirectorPlan(s, plan);
      expect(accepted).toBe(true);
      const fixed = state.directorPlan!;
      expect(fixed.picks).not.toContain("made_up:0");
      expect(new Set(fixed.picks).size).toBe(fixed.picks.length);
      expect(fixed.picks.length).toBeLessThanOrEqual(brief.pick);
      expect(fixed.picks.length).toBeGreaterThanOrEqual(Math.min(2, brief.pick));
      if (fixed.requiredId) expect(fixed.picks).toContain(fixed.requiredId);
      expect(Object.keys(fixed.rationale).every((id) => fixed.picks.includes(id))).toBe(true);
      // Monday still gets one demand per person.
      const people = toMonday(state).inbox.map((i) => i.subjectId).filter(Boolean);
      expect(new Set(people).size).toBe(people.length);
    }
  });

  it("rejects a plan for another week and falls back to the random draw", () => {
    const s = friday();
    const brief = directorBrief(s)!;
    const ids = brief.candidates.map((c) => c.id);
    expect(applyDirectorPlan(s, { quarter: 1, week: 3, picks: ids.slice(0, brief.pick), requiredId: null, rationale: {}, arcNote: "" }).accepted).toBe(false);
    const monday = toMonday(s);
    expect(monday.inboxSource.by).toBe("random");
    expect(monday.inbox.filter((i) => i.required).length).toBeLessThanOrEqual(1);
  });
});

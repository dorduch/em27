import { describe, expect, it } from "vitest";
import { EVENT_TYPES, promiseFollowUp, postmortemFollowUp, type EventCtx } from "@/content/events";
import { STORYLINES } from "@/content/storylines";
import { classifyHint } from "./hints";
import { makeRng } from "./rng";
import { newGame } from "./setup";
import { blockingItem, choose } from "./plan";
import { advanceFromBackPage, finishCheckin, finishFriday, resolveWeek, startWeek } from "./resolve";
import { newQuarter } from "./career";
import { stripPacket } from "./inbox";
import type { CompanyId, GameState } from "./types";

const COMPANIES: CompanyId[] = ["Vercel", "Stripe", "Google"];

/** A spread of realistic states: every company, several seeds, weeks 1–12. */
function states(): GameState[] {
  const out: GameState[] = [];
  for (const c of COMPANIES) {
    for (const seed of [1, 7, 42]) {
      let s = newGame(c, seed);
      s = { ...s, stats: { ...s.stats, incidents: 2 } };
      while (s.phase !== "review") {
        out.push(s);
        // The passive policy rarely ships, so also cover the same week with a launch behind it.
        if (s.week >= 7) out.push({ ...s, projects: s.projects.map((p, i) => (i === 0 ? { ...p, status: "shipped" as const, progress: p.scope } : p)) });
        const req = blockingItem(s);
        if (req) s = choose(s, req.id, req.intents[0].id);
        s = advanceFromBackPage(finishFriday(resolveWeek(s)));
        if (s.phase === "checkin") s = finishCheckin(s, 0);
      }
    }
  }
  return out;
}

const ctxFor = (s: GameState): EventCtx => ({
  s,
  skip: s.stakeholders.find((x) => x.role === "skip")!,
  pm: s.stakeholders.find((x) => x.role === "pm")!,
  peer: s.stakeholders.find((x) => x.role === "peer")!,
});

describe("event content", () => {
  const all = states();

  it("has 16 one-off event types and storylines with unique ids that the director route accepts", () => {
    expect(EVENT_TYPES.length).toBe(16);
    const ids = [...EVENT_TYPES.map((t) => t.id), ...STORYLINES.map((x) => x.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(`${id}:0`).toMatch(/^[a-z0-9_]+:\d$/);
  });

  it("every event builds in every state where setup succeeds, and every hint is classified", () => {
    const unknown = new Set<string>();
    const built = new Set<string>();
    for (const s of all) {
      for (const t of EVENT_TYPES) {
        const ctx = t.setup(ctxFor(s), makeRng(1, t.id));
        if (!ctx) continue;
        const body = t.build(ctx);
        built.add(t.id);
        expect(body.intents.length).toBeGreaterThanOrEqual(2);
        const segs = [...body.intents.flatMap((i) => stripPacket(i.hints).split(" · ")), ...body.ignoreHint.split(" · ")];
        for (const seg of segs) if (classifyHint(seg) === "unknown") unknown.add(`${t.id}: ${seg}`);
        // No option is free of downside: every 0-slot intent has at least one bad or neutral hint.
        for (const i of body.intents.filter((x) => x.cost === 0)) {
          const v = i.hints.split(" · ").map(classifyHint);
          expect(v.some((x) => x === "bad" || x === "neutral"), `${t.id}/${i.id} is free with no downside`).toBe(true);
        }
      }
    }
    expect([...unknown]).toEqual([]);
    expect(built.size).toBe(EVENT_TYPES.length);
  });

  it("classifies follow-up hints too", () => {
    const s = all[0];
    const f = { id: "f1", kind: "promise" as const, subjectId: s.engineers[0].id, text: "x", quarter: 1, createdWeek: 1, dueWeek: 5, status: "open" as const, payloadHint: "Tech Debt ↓↓ · Progress ↓" };
    const segs = [promiseFollowUp(f, s.engineers[0], 5), postmortemFollowUp(s.engineers[0])].flatMap((b) => [
      ...b.intents.flatMap((i) => i.hints.split(" · ")),
      ...b.ignoreHint.split(" · "),
    ]);
    expect(segs.filter((x) => classifyHint(x) === "unknown")).toEqual([]);
  });

  it("strips the packet hint outside Google, including when it stands alone", () => {
    expect(stripPacket("Skip Trust ↑ · Packet evidence")).toBe("Skip Trust ↑");
    expect(stripPacket("Packet evidence")).toBe("");
    expect(stripPacket("Morale ↑ · Packet evidence · Tech Debt ↑")).toBe("Morale ↑ · Tech Debt ↑");
  });

  it("keeps once-per-quarter events to one appearance per quarter", () => {
    for (const c of COMPANIES) {
      for (const seed of [3, 11, 19, 27]) {
        let s = newGame(c, seed);
        const seen: Record<string, number> = {};
        while (s.phase !== "review") {
          for (const i of s.inbox) seen[i.type] = (seen[i.type] ?? 0) + 1;
          const req = blockingItem(s);
          if (req) s = choose(s, req.id, req.intents[0].id);
          s = advanceFromBackPage(finishFriday(resolveWeek(s)));
          if (s.phase === "checkin") s = finishCheckin(s, 0);
        }
        for (const id of ["ai_mandate", "skip_feedback", "keynote_oneup", "postmortem_name"]) {
          expect(seen[id] ?? 0, `${c}/${seed}/${id}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("promises", () => {
  it("keeping a promise applies its payload (the build fix actually happens)", () => {
    let s = newGame("Stripe", 5);
    const e = s.engineers[0];
    s = {
      ...s,
      techDebt: 40,
      facts: [{ id: "f9", kind: "promise", subjectId: e.id, text: "build fix", quarter: 1, createdWeek: 1, dueWeek: 2, status: "open", payload: [{ k: "meter", m: "techDebt", d: -12 }], payloadHint: "Tech Debt ↓↓" }],
    };
    s = startWeek({ ...s, phase: "back" }, 2);
    const due = s.inbox.find((i) => i.type === "promise_due")!;
    expect(due.intents.find((i) => i.id === "deliver")!.hints).toContain("Tech Debt ↓↓");
    const req = blockingItem(s);
    if (req) s = choose(s, req.id, req.intents[0].id);
    s = choose(s, due.id, "deliver");
    const r = resolveWeek(s);
    expect(r.lastWeek!.causes.some((c) => c.subject === "Tech Debt" && c.why === "Promise kept" && c.delta === -12)).toBe(true);
    expect(r.facts.find((f) => f.id === "f9")!.status).toBe("kept");
  });

  it("carries a promise made in week 12 into week 2 of the next quarter", () => {
    let s = newGame("Google", 8);
    const e = s.engineers[1];
    s = { ...s, week: 12, phase: "review", facts: [{ id: "f12", kind: "promise", subjectId: e.id, text: "late promise", quarter: 1, createdWeek: 12, dueWeek: 12, status: "open" }] };
    s = newQuarter(s);
    const f = s.facts.find((x) => x.id === "f12")!;
    expect(f.quarter).toBe(2);
    expect(f.dueWeek).toBe(2);
    s = startWeek({ ...s, phase: "back" }, 2);
    expect(s.inbox.some((i) => i.type === "promise_due" && i.factId === "f12")).toBe(true);
  });
});

describe("Stripe postmortem options", () => {
  const withPostmortem = (choice: string) => {
    let s = newGame("Stripe", 13);
    s = startWeek({ ...s, phase: "back", pendingPostmortem: { role: "skip", hit: 8 } }, 2);
    const pm = s.inbox.find((i) => i.type === "postmortem")!;
    expect(pm.intents.map((i) => i.id)).toEqual(expect.arrayContaining(["write", "present"]));
    const req = blockingItem(s);
    if (req) s = choose(s, req.id, req.intents[0].id);
    if (choice !== "ignore") s = choose(s, pm.id, choice);
    return resolveWeek(s);
  };
  it("presenting gives back the full hit plus skip Trust", () => {
    const r = withPostmortem("present");
    expect(r.lastWeek!.causes.some((c) => c.subject === "Skip-level Trust" && c.why.startsWith("Postmortem presented") && c.delta === 8)).toBe(true);
  });
  it("writing gives back half", () => {
    const r = withPostmortem("write");
    expect(r.lastWeek!.causes.some((c) => c.subject === "Skip-level Trust" && c.delta === 4 && c.why.startsWith("Postmortem"))).toBe(true);
  });
  it("skipping raises the next incident's cost", () => {
    expect(withPostmortem("ignore").incidentMultiplier).toBe(1.5);
  });
});

describe("forecast", () => {
  it("projects the finish week from current staffing", async () => {
    const { forecast, forecastMove, forecastLabel } = await import("./forecast");
    const s = newGame("Vercel", 4);
    const p = { ...s.projects[0], progress: 50, scope: 100, dueWeek: 6, status: "active" as const };
    const eng = s.engineers.map((e, i) => ({ ...e, projectId: i < 2 ? p.id : null, attrs: { ...e.attrs, coding: 10, morale: 20, energy: 20 } }));
    const f = forecast(p, eng, 0, 3);
    expect(f.weekly).toBe(20); // 2 × 10 × 1.0 output factor
    expect(f.finishWeek).toBe(5); // 50 left at 20/wk: Fridays of weeks 3, 4, 5
    expect(f.kind).toBe("on-track");
    expect(forecast(p, eng.map((e) => ({ ...e, projectId: null })), 0, 3).kind).toBe("stalled");
    expect(forecastLabel(forecast(p, eng.map((e) => ({ ...e, projectId: null })), 0, 3))).toContain("Nobody on it");
    const moved = forecastMove({ ...s, projects: [p, ...s.projects.slice(1)], engineers: eng, techDebt: 0, week: 3 }, eng[0].id, s.projects[1].id);
    expect(moved[p.id].weekly).toBe(10);
    expect(moved[s.projects[1].id].team).toBeGreaterThanOrEqual(1);
  });
});

describe("event premises", () => {
  const pool = async (s: GameState) => (await import("./inbox")).candidatePool(s).map((c) => c.type.id);
  /** Week 5 of a fresh game with every project ahead of schedule and fully staffed. */
  const base = (company: CompanyId = "Stripe") => {
    const s = newGame(company, 11);
    return {
      ...s,
      week: 5,
      phase: "plan" as const,
      projects: s.projects.map((p) => ({ ...p, progress: Math.min(p.scope - 1, 90) })),
    };
  };
  const pick = (s: GameState, id: string) => EVENT_TYPES.find((t) => t.id === id)!.setup(ctxFor(s), makeRng(3, id));

  it("only offers a blown estimate for a project that is actually behind", () => {
    const ahead = base();
    expect(pick(ahead, "estimate_blown")).toBeNull();
    expect(EVENT_TYPES.find((t) => t.id === "estimate_blown")!.weight(ahead)).toBe(0);
    const late = { ...ahead, projects: ahead.projects.map((p, i) => (i === 1 ? { ...p, progress: 0 } : p)) };
    expect(pick(late, "estimate_blown")?.project?.id).toBe(late.projects[1].id);
  });

  it("needs active projects for rolling tickets and giant PRs", () => {
    const s = base();
    const idle = { ...s, projects: s.projects.map((p) => ({ ...p, status: "shipped" as const, progress: p.scope })) };
    expect(pick(idle, "underperformer")).toBeNull();
    expect(pick(idle, "slop_pr")).toBeNull();
  });

  it("credits a peer only for a launch you shipped, named, once per project", async () => {
    const s = base();
    expect(pick(s, "peer_credit")).toBeNull();
    const launched = { ...s, projects: s.projects.map((p, i) => (i === 0 ? { ...p, status: "shipped" as const, progress: p.scope } : p)) };
    const ctx = pick(launched, "peer_credit")!;
    expect(EVENT_TYPES.find((t) => t.id === "peer_credit")!.build(ctx).body).toContain(launched.projects[0].name);
    expect(await pool({ ...launched, quarterEvents: [`peer_credit@${launched.projects[0].id}`] })).not.toContain("peer_credit");
  });

  it("sends someone staffed on the project to negotiate scope or demo the flagship", () => {
    for (const [company, id] of [["Stripe", "scope_creep"], ["Vercel", "keynote_oneup"]] as const) {
      const ctx = pick({ ...base(company), week: 3 }, id)!;
      expect(ctx.subject?.projectId).toBe(ctx.project!.id);
    }
  });

  it("settles the build for the quarter once it is fixed or promised", async () => {
    let s: GameState = base();
    const build = EVENT_TYPES.find((t) => t.id === "tech_debt")!;
    const body = build.build(build.setup(ctxFor(s), makeRng(1, "tech_debt"))!);
    for (const intent of ["approve", "later"]) {
      const effects = body.intents.find((i) => i.id === intent)!.effects;
      expect(effects).toContainEqual({ k: "settle", type: "tech_debt" });
    }
    s = { ...s, inbox: [{ ...body, id: "i1", type: "tech_debt", cat: "DELIVERY", required: false }] };
    s = choose(s, "i1", "approve");
    const after = advanceFromBackPage(finishFriday(resolveWeek(s)));
    expect(after.quarterEvents).toContain("tech_debt@settled");
    expect(await pool(after)).not.toContain("tech_debt");
  });

  it("only blames the pager on the person who carries it", async () => {
    const { beatCtx } = await import("@/content/storylines");
    const burnout = STORYLINES.find((x) => x.id === "burnout")!;
    const s = base();
    const e = { ...s.engineers[0], attrs: { ...s.engineers[0].attrs, energy: 8 } };
    const at = (oncallId: string | null) => {
      const st = { ...s, engineers: [e, ...s.engineers.slice(1)], plan: { ...s.plan, oncallId } };
      return burnout.beats.signs.build(beatCtx({ ...ctxFor(st), subject: e }, { storyline: "burnout", subjectId: e.id, flags: [] })!);
    };
    expect(at(e.id).title).toContain("pager");
    expect(at(e.id).intents.map((i) => i.id)).toContain("pager");
    const off = at(s.engineers[1].id);
    expect(off.title).not.toContain("pager");
    expect(off.intents.map((i) => i.id)).not.toContain("pager");
  });

  it("tells the director who is on call and who works on what", async () => {
    const { directorBrief } = await import("./director");
    let s = newGame("Stripe", 31);
    const req = blockingItem(s)!;
    s = resolveWeek(choose(s, req.id, req.intents[0].id));
    const brief = directorBrief(s)!;
    const oncall = s.engineers.find((e) => e.id === s.plan.oncallId)!;
    expect(brief.onCall).toBe(oncall.name);
    expect(brief.team.filter((t) => t.onCall).map((t) => t.name)).toEqual([oncall.name]);
    for (const p of brief.projects.filter((x) => x.status === "active")) {
      expect(p.staff.length).toBeGreaterThan(0);
      expect(p.forecastFinishWeek).not.toBeUndefined();
    }
  });
});

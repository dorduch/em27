import { describe, expect, it } from "vitest";
import { EVENT_TYPES, type EventCtx } from "@/content/events";
import { beatCtx, STORYLINES } from "@/content/storylines";
import { classifyHint } from "./hints";
import { candidatePool, MAX_ARCS, randomPicks, stripPacket } from "./inbox";
import { blockingItem, choose } from "./plan";
import { makeRng } from "./rng";
import { advanceFromBackPage, finishCheckin, finishFriday, resolveWeek } from "./resolve";
import { newGame } from "./setup";
import type { CompanyId, Effect, GameState } from "./types";

const COMPANIES: CompanyId[] = ["Vercel", "Stripe", "Google"];

const ctxFor = (s: GameState): EventCtx => ({
  s,
  skip: s.stakeholders.find((x) => x.role === "skip")!,
  pm: s.stakeholders.find((x) => x.role === "pm")!,
  peer: s.stakeholders.find((x) => x.role === "peer")!,
});

/**
 * Is something the player can see guaranteed to change? Story bookkeeping, hidden Loyalty,
 * scouting (may find nothing) and the Google-only packet don't count, and a chance only
 * counts when both of its outcomes do something visible.
 */
function reacts(effects: Effect[]): boolean {
  return effects.some((e) => {
    if (e.k === "chance") return reacts(e.then) && reacts(e.else ?? []);
    if (e.k === "meter") return e.m !== "packet";
    return !["arc", "arcEnd", "arcFlag", "loyalty", "scout"].includes(e.k);
  });
}

/** A spread of realistic states: every company, several seeds, weeks 1–12. */
function states(): GameState[] {
  const out: GameState[] = [];
  for (const c of COMPANIES) {
    for (const seed of [1, 7, 42]) {
      playQuarter(c, seed, (s) => void out.push(s));
    }
  }
  return out;
}

/** Does every path through these effects either schedule the next beat or end the storyline? */
function continues(effects: Effect[]): boolean {
  if (effects.some((e) => e.k === "arc" || e.k === "arcEnd")) return true;
  return effects.some((e) => e.k === "chance" && continues(e.then) && continues(e.else ?? []));
}

const targets = (effects: Effect[]): string[] =>
  effects.flatMap((e) => (e.k === "arc" ? [e.to] : e.k === "chance" ? [...targets(e.then), ...targets(e.else ?? [])] : []));

/** Play a quarter, choosing the cheapest option on the must-respond item. Calls `look` each Monday. */
function playQuarter(c: CompanyId, seed: number, look: (s: GameState) => void, pick: (s: GameState) => GameState = (s) => s): GameState {
  let s = newGame(c, seed);
  while (s.phase !== "review") {
    look(s);
    s = pick(s);
    const req = blockingItem(s);
    if (req && !s.plan.choices[req.id]) s = choose(s, req.id, [...req.intents].sort((a, b) => a.cost - b.cost)[0].id);
    s = advanceFromBackPage(finishFriday(resolveWeek(s)));
    if (s.phase === "checkin") s = finishCheckin(s, 0);
  }
  return s;
}

describe("storylines", () => {
  it("every beat builds, has real choices, classified hints, and a reaction on every choice", () => {
    for (const s of states()) {
      for (const sl of STORYLINES) {
        for (const [id, beat] of Object.entries(sl.beats)) {
          for (const [n, e] of s.engineers.entries()) {
            const other = s.engineers[(n + 1) % s.engineers.length];
            const project = s.projects[n % s.projects.length];
            for (const flags of [[], ["committed", "evidence", "lead", "traded", "checked", "prepared", "warned", "reassured", "held"]]) {
              const body = beat.build(beatCtx(ctxFor(s), { storyline: sl.id, subjectId: e.id, otherId: other.id, projectId: project?.id, flags })!);
              expect(body.intents.length, `${sl.id}.${id}`).toBeGreaterThanOrEqual(2);
              const segs = [...body.intents.flatMap((i) => stripPacket(i.hints).split(" · ")), ...body.ignoreHint.split(" · ")];
              for (const seg of segs) expect(classifyHint(seg), `${sl.id}.${id}: ${seg}`).not.toBe("unknown");
              for (const i of body.intents) {
                expect(reacts(i.effects), `${sl.id}.${id}/${i.id} changes nothing`).toBe(true);
                expect(continues(i.effects), `${sl.id}.${id}/${i.id} neither continues nor ends`).toBe(true);
                for (const t of targets(i.effects)) expect(sl.beats[t], `${sl.id}.${id} → ${t}`).toBeDefined();
              }
              expect(reacts(body.ignoreEffects), `${sl.id}.${id}/ignore changes nothing`).toBe(true);
              expect(continues(body.ignoreEffects), `${sl.id}.${id}/ignore neither continues nor ends`).toBe(true);
            }
          }
        }
      }
    }
  });

  it("every one-off event choice, ignoring included, changes something", () => {
    const silent = new Set<string>();
    for (const s of states()) {
      for (const t of EVENT_TYPES) {
        const ctx = t.setup(ctxFor(s), makeRng(1, t.id));
        if (!ctx) continue;
        const body = t.build(ctx);
        for (const i of body.intents) if (!reacts(i.effects)) silent.add(`${t.id}/${i.id}`);
        if (!reacts(body.ignoreEffects)) silent.add(`${t.id}/ignore`);
      }
    }
    expect([...silent].sort()).toEqual([]);
  });

  it("storylines start, move on over several weeks, and never outlive their person", () => {
    let multiBeat = 0;
    for (const c of COMPANIES) {
      for (const seed of [2, 9, 14, 21]) {
        const beatsByArc: Record<string, string[]> = {};
        playQuarter(c, seed, (s) => {
          const ids = new Set(s.engineers.map((e) => e.id));
          for (const i of s.inbox) {
            if (i.subjectId) expect(ids.has(i.subjectId), `${c}/${seed} w${s.week} ${i.type}`).toBe(true);
            if (!i.arc) continue;
            expect(s.arcs.some((a) => a.id === i.arc!.id), `${i.type} has a running storyline`).toBe(true);
            (beatsByArc[i.arc.id] ??= []).push(i.arc.beat);
          }
          // One storyline per person, and never more than the level allows.
          expect(new Set(s.arcs.map((a) => a.subjectId)).size).toBe(s.arcs.length);
          expect(new Set(s.arcs.flatMap((a) => [a.subjectId, a.otherId].filter(Boolean))).size).toBe(s.arcs.reduce((n, a) => n + (a.otherId ? 2 : 1), 0));
          expect(s.arcs.length).toBeLessThanOrEqual(MAX_ARCS[s.level]);
        });
        for (const beats of Object.values(beatsByArc)) if (beats.length >= 2) multiBeat++;
      }
    }
    expect(multiBeat).toBeGreaterThan(4);
  });

  it("never opens two storylines about one person, or two storylines in one week", () => {
    let s = newGame("Google", 3);
    // One engineer who is both ambitious enough for the promo and tired enough for burnout.
    s = { ...s, engineers: s.engineers.map((e, i) => (i === 0 ? { ...e, level: 5, attrs: { ...e.attrs, ambition: 18, energy: 3 } } : { ...e, attrs: { ...e.attrs, ambition: 5 } })) };
    const pool = candidatePool(s);
    const openings = pool.filter((c) => c.storyline);
    expect(new Set(openings.map((c) => c.ctx.subject!.id)).size).toBe(openings.length);
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { picks } = randomPicks({ ...s, seed }, candidatePool({ ...s, seed }));
      expect(picks.filter((id) => STORYLINES.some((x) => id.startsWith(`${x.id}:`))).length).toBeLessThanOrEqual(1);
    }
  });

  it("one-offs never repeat in consecutive weeks, and quarterly ones happen once a quarter", () => {
    const quarterly = new Set(EVENT_TYPES.filter((t) => t.oncePer === "quarter").map((t) => t.id));
    for (const c of COMPANIES) {
      for (const seed of [4, 8, 15]) {
        const lastSeen: Record<string, number> = {};
        const count: Record<string, number> = {};
        playQuarter(c, seed, (s) => {
          for (const i of s.inbox) {
            if (i.arc || i.cat === "FOLLOW-UP") continue;
            const key = EVENT_TYPES.find((t) => t.id === i.type)?.oncePer === "project" ? `${i.type}@${i.projectId}` : i.type;
            if (lastSeen[key] !== undefined) expect(s.week - lastSeen[key], `${c}/${seed} w${s.week} ${key}`).toBeGreaterThanOrEqual(2);
            lastSeen[key] = s.week;
            count[i.type] = (count[i.type] ?? 0) + 1;
          }
        });
        for (const t of quarterly) expect(count[t] ?? 0, `${c}/${seed} ${t}`).toBeLessThanOrEqual(1);
        // Everything else at most once per third of the quarter.
        for (const [t, n] of Object.entries(count)) if (!EVENT_TYPES.find((x) => x.id === t)?.oncePer) expect(n, `${c}/${seed} ${t}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it("choices steer the story: ignoring a promo request leads to the recruiter, committing leads to the packet", () => {
    const follow = (choice: string | "ignore") => {
      const seen: string[] = [];
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
        let arcId: string | null = null;
        playQuarter("Google", seed, (s) => {
          for (const i of s.inbox) if (i.arc && i.arc.id === arcId) seen.push(i.arc.beat);
        }, (s) => {
          const open = s.inbox.find((i) => i.arc?.start && i.arc.storyline === "promo");
          // A must-respond item can't be ignored, so only follow optional openings when ignoring.
          if (!open || arcId || (choice === "ignore" && open.required)) return s;
          arcId = open.arc!.id;
          return choice === "ignore" ? s : choose(s, open.id, choice);
        });
        if (seen.length) break;
      }
      return seen;
    };
    expect(follow("commit")[0]).toBe("evidence");
    expect(follow("ignore")[0]).toBe("recruiter");
  });
});

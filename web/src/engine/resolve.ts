// Friday: resolves the locked plan into new state, commentary lines and causes.

import { COMPANIES, KEYNOTE_WEEK } from "@/content/companies";
import { TRAIT_LABEL } from "@/content/people";
import { beatCtx, storylineById } from "@/content/storylines";
import { baseCtx, fillInbox, now, rememberTypes, settledKey } from "./inbox";
import {
  capacityFor,
  FOCUS_RELIEF,
  OVERBOOK_STRESS,
  planCost,
  produce,
  WEEKLY_STRESS_DECAY,
} from "./plan";
import { forecast } from "./forecast";
import { makeRng, type Rng } from "./rng";
import { makeEngineer, makeFollowOn, TEAM_SIZE } from "./setup";
import type {
  ArcState,
  AttrKey,
  Cause,
  Effect,
  Engineer,
  FridayLine,
  GameState,
  StakeholderRole,
  WeekResult,
} from "./types";
import { computeReview } from "./review";

const ATTR_LABEL: Record<AttrKey, string> = {
  coding: "Coding",
  debugging: "Debugging",
  communication: "Communication",
  ambition: "Ambition",
  morale: "Morale",
  energy: "Energy",
};
const ROLE_LABEL: Record<StakeholderRole, string> = { skip: "Skip-level", pm: "PM", peer: "Peer EM" };
const METER_LABEL = {
  techDebt: "Tech Debt",
  oncallLoad: "On-call Load",
  stress: "Your Stress",
  capital: "Political Capital",
  reputation: "Reputation",
  packet: "Promo packet",
} as const;

export const OUTPUT_PER_CODING = 1.0;
const LOG_LIMIT = 8;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const first = (e: Engineer) => e.name.split(" ")[0];
const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export function engineerOutput(e: Engineer, techDebt: number): number {
  const mf = 0.6 + (0.4 * e.attrs.morale) / 20;
  const ef = 0.5 + (0.5 * e.attrs.energy) / 20;
  return e.attrs.coding * OUTPUT_PER_CODING * mf * ef * (1 - techDebt / 250);
}

class Resolver {
  causes: Cause[] = [];
  lines: FridayLine[] = [];
  hires = 0;
  minute = 9 * 60 + 5;
  /** The storyline the item being resolved belongs to, and whether a choice moved it on. */
  arc: ArcState | undefined;
  arcMoved = false;

  constructor(
    public d: GameState,
    public rng: Rng,
  ) {}

  time(step = 25): string {
    const t = this.minute;
    this.minute = Math.min(17 * 60 + 55, this.minute + step);
    return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  }

  line(text: string, cause: string, tone?: "good" | "bad", step?: number) {
    this.lines.push({ time: this.time(step), text, cause, tone });
  }

  cause(subject: string, delta: number, why: string, e?: Engineer) {
    if (!delta) return;
    const c: Cause = { subject, delta, why, week: this.d.week, quarter: this.d.quarter };
    this.causes.push(c);
    if (e) e.log = [c, ...e.log].slice(0, LOG_LIMIT);
  }

  eng(id: string) {
    return this.d.engineers.find((e) => e.id === id);
  }

  attr(e: Engineer, a: AttrKey, d: number, why: string) {
    const before = e.attrs[a];
    e.attrs[a] = clamp(before + d, 1, 20);
    this.cause(`${first(e)}’s ${ATTR_LABEL[a]}`, e.attrs[a] - before, why, e);
  }

  trust(role: StakeholderRole, d: number, why: string) {
    const st = this.d.stakeholders.find((x) => x.role === role)!;
    const before = st.trust;
    st.trust = clamp(before + d, 0, 100);
    this.cause(`${ROLE_LABEL[role]} Trust`, st.trust - before, why);
  }

  meter(m: keyof typeof METER_LABEL, d: number, why: string) {
    const hi = m === "capital" ? 999 : 100;
    const before = this.d[m];
    this.d[m] = clamp(before + d, 0, hi);
    if (m === "packet" && this.d.company !== "Google") return;
    this.cause(METER_LABEL[m], this.d[m] - before, why);
  }

  reveal(e: Engineer, why: string): string | null {
    e.scout += 1;
    const hidden = e.traits.filter((t) => !e.revealed.includes(t));
    if (e.scout === 2 && !e.loyaltyKnown) {
      e.loyaltyKnown = true;
      return `Loyalty is ${e.loyalty}`;
    }
    if (hidden.length && e.scout !== 2) {
      e.revealed.push(hidden[0]);
      this.cause(`${first(e)}: trait found`, 1, `${TRAIT_LABEL[hidden[0]]} · ${why}`, e);
      return TRAIT_LABEL[hidden[0]];
    }
    if (!e.loyaltyKnown) {
      e.loyaltyKnown = true;
      return `Loyalty is ${e.loyalty}`;
    }
    return null;
  }

  leave(e: Engineer, why: string, how: "quit" | "cut" | "transfer" = "quit") {
    this.d.engineers = this.d.engineers.filter((x) => x.id !== e.id);
    this.d.departuresThisQuarter += 1;
    this.d.stats.departed.push(e.name);
    this.cause(`${first(e)} left the team`, -1, why);
    const said = how === "cut" ? "is cut in the reorg" : how === "transfer" ? "transfers to another team" : "hands in their notice";
    this.line(`${e.name} ${said}. <b class="bad">Headcount −1.</b>`, why, "bad");
    this.handOffPager(e);
    for (const o of this.d.engineers) this.attr(o, "morale", -1, `${first(e)} left`);
  }

  /** Whoever carried the pager is gone or away: the best-rested strong debugger picks it up, so it is never silently empty. */
  handOffPager(from: Engineer) {
    if (this.d.plan.oncallId !== from.id) return;
    const next = this.d.engineers
      .filter((x) => x.id !== from.id)
      .sort((a, b) => b.attrs.debugging + b.attrs.energy - (a.attrs.debugging + a.attrs.energy))[0];
    this.d.plan.oncallId = next?.id ?? null;
    if (next) this.line(`${first(next)} picks up the pager from ${first(from)}.`, "On-call hand-off", undefined);
  }

  endArc(arc: ArcState, outcome: string) {
    this.d.arcs = this.d.arcs.filter((a) => a.id !== arc.id);
    this.d.arcHistory.push({ storyline: arc.storyline, subjectId: arc.subjectId, outcome, ended: now(this.d) });
  }

  apply(effects: Effect[], why: string): string[] {
    const notes: string[] = [];
    for (const ef of effects) {
      switch (ef.k) {
        case "attr": {
          const e = this.eng(ef.who);
          if (e) this.attr(e, ef.attr, ef.d, why);
          break;
        }
        case "teamAttr":
          for (const e of this.d.engineers) this.attr(e, ef.attr, ef.d, why);
          break;
        case "loyalty": {
          const e = this.eng(ef.who);
          if (e) {
            const before = e.loyalty;
            e.loyalty = clamp(e.loyalty + ef.d, 1, 20);
            if (e.loyaltyKnown) this.cause(`${first(e)}’s Loyalty`, e.loyalty - before, why, e);
          }
          break;
        }
        case "trust":
          this.trust(ef.role, ef.d, why);
          break;
        case "meter":
          this.meter(ef.m, ef.d, why);
          break;
        case "progress": {
          const p = this.d.projects.find((x) => x.id === ef.project && x.status === "active");
          if (p) {
            const before = p.progress;
            p.progress = clamp(p.progress + ef.d, 0, p.scope);
            this.cause(`${p.name} progress`, p.progress - before, why);
          }
          break;
        }
        case "scope": {
          const p = this.d.projects.find((x) => x.id === ef.project && x.status === "active");
          if (p) {
            p.scope = Math.max(p.progress + 5, p.scope + ef.d);
            this.cause(`${p.name} scope`, ef.d, why);
          }
          break;
        }
        case "deadline": {
          const p = this.d.projects.find((x) => x.id === ef.project && x.status === "active");
          if (!p) break;
          if (p.flagship && this.d.company === "Vercel") {
            notes.push("the keynote date does not move");
          } else {
            p.dueWeek += ef.d;
            this.cause(`${p.name} deadline`, ef.d, why);
          }
          break;
        }
        case "promise": {
          this.d.facts.push({
            id: `f${this.d.nextId++}`,
            kind: "promise",
            subjectId: ef.who,
            text: ef.text,
            quarter: this.d.quarter,
            createdWeek: this.d.week,
            dueWeek: Math.min(12, this.d.week + ef.dueIn),
            status: "open",
            payload: ef.payload,
            payloadHint: ef.payloadHint,
          });
          break;
        }
        case "keep":
        case "break": {
          const f = this.d.facts.find((x) => x.id === ef.factId);
          if (f && f.status === "open") {
            f.status = ef.k === "keep" ? "kept" : "broken";
            if (ef.k === "keep") this.d.stats.promisesKept++;
            else this.d.stats.promisesBroken++;
          }
          break;
        }
        case "scout": {
          const e = this.eng(ef.who);
          if (e) {
            const found = this.reveal(e, why);
            if (found) notes.push(`found: ${found}`);
          }
          break;
        }
        case "leave": {
          const e = this.eng(ef.who);
          if (e) this.leave(e, why, ef.how);
          break;
        }
        case "assign": {
          const e = this.eng(ef.who);
          if (e && this.d.projects.some((p) => p.id === ef.project && p.status === "active")) {
            e.projectId = ef.project;
            delete e.awayFrom;
          }
          break;
        }
        case "away": {
          const e = this.eng(ef.who);
          if (e) {
            if (e.projectId) e.awayFrom = e.projectId;
            e.projectId = null;
            this.handOffPager(e);
          }
          break;
        }
        case "hire":
          this.hires++;
          break;
        case "settle": {
          const key = settledKey(ef.type);
          if (!this.d.quarterEvents.includes(key)) this.d.quarterEvents.push(key);
          break;
        }
        case "levelUp": {
          const e = this.eng(ef.who);
          if (e && e.level < 7) {
            e.level += 1;
            this.cause(`${first(e)}’s level`, 1, why, e);
            this.line(`${e.name} is promoted to L${e.level}.`, why, "good");
          }
          break;
        }
        case "arc":
          if (this.arc) {
            this.arc.beat = ef.to;
            this.arc.due = now(this.d) + this.rng.int(ef.wait[0], ef.wait[1]);
            this.arcMoved = true;
          }
          break;
        case "arcEnd":
          if (this.arc) {
            this.endArc(this.arc, ef.outcome);
            this.arcMoved = true;
          }
          break;
        case "arcFlag":
          if (this.arc && !this.arc.flags.includes(ef.flag)) this.arc.flags.push(ef.flag);
          break;
        case "chance": {
          const hit = this.rng.chance(ef.p);
          if (hit) notes.push(ef.note.toLowerCase());
          else if (ef.miss) notes.push(ef.miss.toLowerCase());
          notes.push(...this.apply(hit ? ef.then : (ef.else ?? []), why));
          break;
        }
      }
    }
    return notes;
  }
}

const GOOD_HEADLINES = [
  "A quiet week.<br>Suspiciously quiet.",
  "The plan met production.<br>The plan won.",
  "Small wins.<br>They still count.",
];
const BAD_HEADLINES = [
  "Everything was on fire.<br>Including the roadmap.",
  "“Let’s take the learnings<br>into next week.”",
  "The calendar had opinions.<br>So did the pager.",
];

export function resolveWeek(s: GameState): GameState {
  if (s.phase !== "plan") return s;
  const rng = makeRng(s.seed, s.quarter, s.week, "resolve");
  return produce(s, (d) => {
    const r = new Resolver(d, rng);
    const used = planCost(s);
    const cap = s.capacity;
    let keynote: WeekResult["keynote"];
    const departedBefore = d.stats.departed.length;
    r.line("The plan is locked. The calendar has opinions.", `Week ${d.week} · ${used}/${cap} slots booked`);

    // 1. Inbox decisions. Unanswered optional items resolve as ignored.
    // Plain decisions are folded into one line so Friday gets to the outcomes faster.
    const calls: string[] = [];
    const slid: string[] = [];
    for (const item of s.inbox) {
      const choice = s.plan.choices[item.id] ?? "ignore";
      r.arc = item.arc ? d.arcs.find((a) => a.id === item.arc!.id) : undefined;
      r.arcMoved = false;
      if (item.type === "postmortem") {
        const pm = d.pendingPostmortem;
        const oncallEng = d.plan.oncallId ? r.eng(d.plan.oncallId) : undefined;
        if (pm && choice === "present") {
          r.trust(pm.role, pm.hit, "Postmortem presented at the incident review");
          r.trust("skip", 2, "Owned the incident in the room");
          r.line("You present the postmortem yourself. The room relaxes.", "Incident review → Trust restored", "good");
        } else if (pm && choice === "write") {
          r.trust(pm.role, Math.ceil(pm.hit / 2), "Postmortem halved the incident hit");
          r.line("The postmortem lands. Clear owners, clear fixes.", "Incident review → Trust partly restored", "good");
        } else if (pm && choice === "delegate" && oncallEng) {
          r.attr(oncallEng, "energy", -2, "Wrote the postmortem");
          if (rng.chance(oncallEng.attrs.communication / 20)) {
            r.trust(pm.role, Math.ceil(pm.hit / 2), `${first(oncallEng)}’s postmortem landed`);
            r.line(`${first(oncallEng)}’s postmortem is clear and blameless.`, "Communication → Trust partly restored", "good");
          } else {
            r.line(`${first(oncallEng)}’s postmortem reads like a stack trace. Nobody is reassured.`, "Communication too low → no Trust back", "bad");
          }
        } else {
          d.incidentMultiplier += 0.5;
          r.line("Nobody wrote the postmortem. The next incident will cost more.", "Skipped review → incident cost ↑", "bad");
        }
        d.pendingPostmortem = null;
        continue;
      }
      if (choice === "ignore") {
        const notes = r.apply(item.ignoreEffects, item.ignoreCause);
        if (!item.ignoreEffects.length && !notes.length) slid.push(item.ignoreCause);
        else r.line(`${item.ignoreCause}${notes.length ? ` (${notes.join(", ")})` : ""}.`, "Ignored demand → resolved", item.ignoreEffects.length ? "bad" : undefined);
      } else {
        const intent = item.intents.find((i) => i.id === choice)!;
        const notes = r.apply(intent.effects, intent.cause);
        if (notes.length) r.line(`${intent.cause} (${notes.join(", ")}).`, `${item.from} → your response`);
        else calls.push(intent.cause);
      }
      // A storyline beat that didn't schedule another one is over.
      if (r.arc && !r.arcMoved && d.arcs.includes(r.arc)) r.endArc(r.arc, "faded");
      r.arc = undefined;
    }
    if (calls.length) r.line(`Your calls: ${calls.join("; ")}.`, "Your decisions → applied");
    // 1b. Storylines still open wear on people while they wait. One you just answered doesn't.
    const answered = new Set(s.inbox.map((i) => i.arc?.id).filter(Boolean));
    for (const arc of [...d.arcs]) {
      if (answered.has(arc.id)) continue;
      const sl = storylineById(arc.storyline);
      const ctx = sl?.simmer && beatCtx(baseCtx(d), arc);
      const cost = ctx && sl.simmer!(ctx, arc.beat);
      if (!cost) continue;
      r.apply(cost.effects, cost.why);
      r.line(`${cost.why}.`, `${sl.title} → still unresolved`, "bad");
    }
    if (slid.length) r.line(`Let slide: ${slid.join("; ")}.`, "Ignored, no immediate cost");

    // 2. 1:1s: morale and scouting.
    for (const id of s.plan.oneOnOnes) {
      const e = r.eng(id);
      if (!e) continue;
      r.attr(e, "morale", 1, "1:1 with you");
      const found = r.reveal(e, "1:1");
      r.line(`1:1 with ${first(e)}.${found ? ` You learn something: <b>${found}</b>.` : " Good conversation, nothing new."}`, "1:1 → scouting", found ? "good" : undefined);
    }

    // 2b. Political Capital actions.
    for (const id of s.plan.spend) {
      if (id === "no-meetings") {
        r.meter("capital", -8, "No-meeting week");
        for (const e of d.engineers) r.attr(e, "energy", 2, "No-meeting week");
        r.trust("pm", -3, "No-meeting week");
        r.line("A whole week without meetings. People remember what focus feels like.", "Political Capital → team Energy", "good");
      } else if (id === "backfill") {
        r.meter("capital", -15, "Fought for a backfill");
        r.trust("skip", -3, "Fought for a backfill");
        const won = rng.chance(0.8);
        if (won) r.hires++;
        r.line(won ? "The backfill is approved." : "The backfill is “deferred to next planning cycle”.", "Political Capital → headcount", won ? "good" : "bad");
      }
    }

    // 3. Projects.
    const startActive = d.projects.filter((p) => p.status === "active").map((p) => p.id);
    const gains: Record<string, { gain: number; team: number }> = {};
    const luck = rng.int(-2, 2);
    const activeWithTeam = d.projects.filter((p) => p.status === "active" && d.engineers.some((e) => e.projectId === p.id));
    const luckProject = activeWithTeam.length ? rng.pick(activeWithTeam) : null;
    for (const p of d.projects.filter((x) => x.status === "active")) {
      const team = d.engineers.filter((e) => e.projectId === p.id);
      let gain = Math.round(team.reduce((n, e) => n + engineerOutput(e, d.techDebt), 0));
      if (p === luckProject) gain = Math.max(0, gain + luck);
      const before = p.progress;
      p.progress = Math.min(p.scope, p.progress + gain);
      gains[p.id] = { gain: p.progress - before, team: team.length };
      if (team.length) {
        r.cause(`${p.name} progress`, p.progress - before, `${team.map(first).join(" + ")} on the work`);
        // The same forecast the Projects screen shows, from next week at today's staffing.
        const onTrack = p.progress >= p.scope || forecast(p, d.engineers, d.techDebt, d.week + 1).kind === "on-track";
        r.line(
          `${p.name}: ${team.map(first).join(" and ")} add ${p.progress - before} points. <b class="${onTrack ? "good" : "bad"}">${onTrack ? "On track." : "Behind."}</b>`,
          "Staffing → delivery",
          onTrack ? "good" : "bad",
        );
      } else {
        r.line(`${p.name}: nobody assigned. <b class="bad">No progress.</b>`, "Staffing → delivery", "bad");
      }
    }
    for (const e of d.engineers) {
      if (!e.projectId) r.attr(e, "energy", 2, "A week off the critical path");
    }

    // 4. Ships and deadlines.
    const shippedNames: string[] = [];
    const missedNames: string[] = [];
    for (const p of d.projects.filter((x) => x.status === "active")) {
      if (p.progress >= p.scope) {
        const late = d.week > p.dueWeek;
        p.status = late ? "late-shipped" : "shipped";
        d.stats.projectsShipped++;
        r.trust(p.owner, late ? 2 : 6, `${p.name} shipped${late ? " late" : ""}`);
        r.meter("reputation", 2, `${p.name} shipped`);
        r.meter("capital", 4, `${p.name} shipped`);
        r.meter("packet", 3, `${p.name} launch evidence`);
        const team = d.engineers.filter((x) => x.projectId === p.id);
        for (const e of team) {
          e.projectId = null;
          r.attr(e, "morale", 2, `${p.name} shipped`);
        }
        shippedNames.push(p.name);
        r.line(`${p.name} ships${late ? ", late" : ""}. <b class="good">Released.</b>`, "Delivery → Trust and Reputation", "good");
        // The backlog refills: the same team rolls onto the next thing, as a stretch goal.
        const weekly = team.reduce((n, e) => n + engineerOutput(e, d.techDebt), 0);
        const next = makeFollowOn(rng, d.company, p, d.week, d.projects.map((x) => x.name), `p${d.nextId++}`, weekly);
        if (next) {
          d.projects.push(next);
          for (const e of team) e.projectId = next.id;
          const owner = d.stakeholders.find((x) => x.role === next.owner)!;
          r.line(
            `Next up from ${owner.name.split(" ")[0]}: ${next.name}. ${team.length ? `${team.map(first).join(" and ")} roll onto it. ` : ""}A stretch goal, due week ${next.dueWeek}.`,
            "Shipped → the backlog refills",
          );
        }
      } else if (d.week >= p.dueWeek && !p.stretch) {
        p.status = "missed";
        r.trust(p.owner, -8, `${p.name} missed its date`);
        r.meter("reputation", -3, `${p.name} missed its date`);
        for (const e of d.engineers.filter((x) => x.projectId === p.id)) e.projectId = null;
        missedNames.push(p.name);
        r.line(`${p.name} misses week ${p.dueWeek}. <b class="bad">Deadline missed.</b>`, "Delivery → Trust", "bad");
      }
    }

    // 4b. Vercel keynote: the flagship is judged on stage in week 8, whenever it shipped.
    const flagship = d.projects.find((p) => p.flagship);
    if (d.company === "Vercel" && d.week === KEYNOTE_WEEK && flagship) {
      keynote = flagship.status === "shipped" ? "shipped" : "missed";
      if (keynote === "shipped") {
        r.meter("reputation", 6, "Shipped on stage at the keynote");
        r.line(`${flagship.name} demos live on stage. <b class="good">Reputation ↑.</b>`, "Keynote → Reputation", "good");
      } else {
        r.meter("reputation", -6, "Empty demo slot at the keynote");
        r.trust("skip", -6, "Empty demo slot at the keynote");
        r.line("The keynote demo slot is empty. Everyone noticed. <b class=\"bad\">Reputation ↓.</b>", "Missed keynote → public miss", "bad");
      }
    }

    // 5. On-call and incidents.
    let escalated = false;
    let incident: WeekResult["incident"];
    const oncall = d.plan.oncallId ? r.eng(d.plan.oncallId) : undefined;
    if (oncall) r.attr(oncall, "energy", -1, "On call this week");
    const pIncident = COMPANIES[d.company].incidentBase + d.techDebt / 250 + d.oncallLoad / 400;
    if (rng.chance(pIncident)) {
      d.stats.incidents++;
      incident = { oncallId: oncall?.id ?? null, escalated: false };
      const who = oncall ? `${first(oncall)} is on call (Debugging ${oncall.attrs.debugging}, Energy ${oncall.attrs.energy})` : "Nobody is on call";
      r.line(`PagerDuty fires. ${who}…`, "Incident roll · Tech Debt and On-call Load raise the odds", undefined, 15);
      const pFix = oncall ? 0.3 + (oncall.attrs.debugging / 20) * 0.5 + (oncall.attrs.energy / 20) * 0.15 : 0;
      if (oncall && rng.chance(pFix)) {
        r.meter("oncallLoad", 2, "Incident contained quickly");
        r.attr(oncall, "energy", -1, "Incident response");
        r.line("The runbook works. Back to green in 18 minutes.", "Debugging + Energy → quick recovery", "good");
      } else {
        const stripe = d.company === "Stripe";
        const hit = Math.round(4 * (stripe ? 2 : 1) * d.incidentMultiplier);
        r.meter("techDebt", 3, "Rollback after escalation");
        r.meter("oncallLoad", 8, "Long incident");
        r.meter("stress", 4, "Pulled into the incident");
        r.trust("skip", -hit, stripe ? "Incident (double Trust cost at this company)" : "Customer-facing incident");
        if (oncall) r.attr(oncall, "energy", -3, "Three-hour incident");
        if (stripe) d.pendingPostmortem = { role: "skip", hit };
        escalated = true;
        incident!.escalated = true;
        r.line(`…it escalates to you. Rollback takes three hours. <b class="bad">Tech Debt +3.</b>`, oncall ? "Fix roll missed → long recovery" : "No one on call → long recovery", "bad");
      }
    } else {
      r.meter("oncallLoad", -3, "A quiet week on the pager");
      r.line("The pager stays quiet.", "No incident this week", "good");
    }

    // 6. Condition drift and resignations.
    for (const e of [...d.engineers]) {
      if (e.attrs.energy <= 5) r.attr(e, "morale", -1, "Running on empty");
      else if (e.attrs.morale < 10 && e.attrs.energy >= 10 && rng.chance(0.5)) r.attr(e, "morale", 1, "A calmer week");
      if (e.attrs.morale <= 3 && e.loyalty <= 9 && rng.chance(0.35)) r.leave(e, "Morale and Loyalty too low");
    }

    // 7. Hires.
    const max = d.level === "Director" ? 0 : TEAM_SIZE[d.level];
    const used2 = new Set(d.engineers.map((e) => e.name));
    for (let i = 0; i < r.hires && d.engineers.length < max; i++) {
      const hire = makeEngineer(rng, `e${d.nextId++}`, used2);
      hire.tenure = "new";
      hire.level = Math.min(hire.level, 5);
      d.engineers.push(hire);
      r.line(`${hire.name} accepts the offer. Starts Monday, unassigned.`, "Hiring → headcount", "good");
    }

    // 8. You.
    const over = Math.max(0, used - cap);
    if (over) r.meter("stress", over * OVERBOOK_STRESS, `Overbooked by ${over} slot${over > 1 ? "s" : ""}`);
    if (s.plan.focus) r.meter("stress", -FOCUS_RELIEF, "Focus time");
    r.meter("stress", -WEEKLY_STRESS_DECAY, "The weekend");
    r.meter("capital", 2, "Steady delivery");

    if (luck) r.line(`Luck: a dependency arrives ${luck > 0 ? "early" : "late"}. ${Math.abs(luck)} point${Math.abs(luck) > 1 ? "s" : ""} ${luck > 0 ? "gained" : "lost"}.`, "Small variance, separate from your decisions", luck > 0 ? "good" : "bad", 10);

    const goodN = r.lines.filter((l) => l.tone === "good").length;
    const badN = r.lines.filter((l) => l.tone === "bad").length;
    const good = goodN >= badN;
    const leftThisWeek = d.stats.departed.slice(departedBefore);
    // The headline reports what actually happened, most newsworthy first.
    const headline =
      keynote === "shipped"
        ? `On stage, on time.<br>${flagship!.name} is live.`
        : keynote === "missed"
          ? "An empty stage.<br>A very full Slack."
          : leftThisWeek.length
            ? `${leftThisWeek[0]} resigns.<br>The calendar invite says “Catch up :)”.`
            : shippedNames.length
              ? `${shippedNames[0]} ships.<br>${escalated ? "The pager had notes." : "Nobody cried. Mostly."}`
              : missedNames.length
                ? `${missedNames[0]} misses its date.<br>The retro is already booked.`
                : escalated
                  ? "The pager won this week.<br>Rollback by teatime."
                  : rng.pick(good ? GOOD_HEADLINES : BAD_HEADLINES);
    const projects = d.projects
      .filter((p) => startActive.includes(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        gain: gains[p.id]?.gain ?? 0,
        team: gains[p.id]?.team ?? 0,
        progress: p.progress,
        scope: p.scope,
        dueWeek: p.dueWeek,
        status: p.status,
      }));
    d.lastWeek = {
      quarter: d.quarter,
      week: d.week,
      slotsUsed: used,
      capacity: cap,
      lines: r.lines,
      causes: r.causes.filter((c) => c.delta !== 0),
      luck,
      headline,
      recap: good
        ? `${goodN} things went right this week, ${badN} went wrong. For one Friday, that counts.`
        : `${badN} things went wrong this week. Someone has already scheduled a retro about the retro.`,
      good,
      keynote,
      incident,
      projects,
    };
    d.phase = "friday";
  });
}

export function finishFriday(s: GameState): GameState {
  if (s.phase !== "friday") return s;
  return produce(s, (d) => {
    d.phase = "back";
  });
}

/** Back page → next Monday, the week-6 check-in, or the quarterly review. */
export function advanceFromBackPage(s: GameState): GameState {
  if (s.phase !== "back") return s;
  if (s.week === 5) return produce(s, (d) => void (d.phase = "checkin"));
  if (s.week >= 12) {
    return produce(s, (d) => {
      d.review = computeReview(d);
      d.phase = "review";
    });
  }
  return startWeek(s, s.week + 1);
}

export function finishCheckin(s: GameState, focus: number): GameState {
  if (s.phase !== "checkin") return s;
  const next = startWeek(s, 6);
  return produce(next, (d) => void (d.checkinFocus = focus));
}

export function startWeek(s: GameState, week: number): GameState {
  return produce(s, (d) => {
    d.recentTypes = rememberTypes(d);
    d.week = week;
    d.phase = "plan";
    d.capacity = capacityFor(d.level, d.stress);
    const oncall = d.plan.oncallId && d.engineers.some((e) => e.id === d.plan.oncallId) ? d.plan.oncallId : null;
    d.plan = { choices: {}, oneOnOnes: [], focus: false, spend: [], oncallId: oncall };
    fillInbox(d);
  });
}

export { fmt as formatDelta };

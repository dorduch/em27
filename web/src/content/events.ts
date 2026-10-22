// Hand-written event types. Each defines the mechanics (intents, costs, effects,
// ignored outcome) and template text. The LLM may reword text; it never changes effects.
//
// Balance rules: every option has a real cost, no option is free of downside, and
// ignoring is a choice with its own outcome. Hint segments use the vocabulary that
// engine/hints.ts classifies (tested), so the UI can colour them good or bad.

import type {
  Category,
  Effect,
  Engineer,
  Fact,
  GameState,
  IntentSpec,
  Project,
  Stakeholder,
} from "@/engine/types";
import { forecast } from "@/engine/forecast";
import type { Rng } from "@/engine/rng";

export interface EventCtx {
  s: GameState;
  subject?: Engineer;
  other?: Engineer;
  project?: Project;
  fact?: Fact;
  skip: Stakeholder;
  pm: Stakeholder;
  peer: Stakeholder;
}

export interface EventBody {
  from: string;
  fromRole: string;
  title: string;
  body: string;
  intents: IntentSpec[];
  ignoreHint: string;
  ignoreEffects: Effect[];
  ignoreCause: string;
}

export interface EventType {
  id: string;
  cat: Category;
  /** Can this event be the week's single must-respond item? */
  canBeRequired: boolean;
  /**
   * A one-off needs a three-week gap before it can come back (so at most three a quarter). Events
   * tied to the quarterly calendar (the QBR deck, the keynote) happen once a quarter. An event
   * that recurs about different things (another project blowing its estimate) is counted per
   * project or person instead.
   */
  oncePer?: "project" | "subject" | "quarter";
  weight: (s: GameState) => number;
  setup: (ctx: EventCtx, rng: Rng) => EventCtx | null;
  build: (ctx: EventCtx) => EventBody;
}

export const first = (e: Engineer) => e.name.split(" ")[0];
export const active = (s: GameState) => s.projects.filter((p) => p.status === "active");
export const levelTitle = (e: Engineer) => `${e.level >= 5 ? "Senior Engineer" : "Engineer"} · L${e.level}`;
export const by = <T,>(arr: T[], f: (x: T) => number) => [...arr].sort((a, b) => f(b) - f(a));
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Hidden-Loyalty-driven odds. The number never appears in hint text. */
export const loyaltyOdds = (e: Engineer, base: number) => clamp(base + e.loyalty / 25, 0.15, 0.92);
const seenThisQuarter = (s: GameState, id: string) => (s.quarterEvents ?? []).includes(id);
export const projectOf = (s: GameState, e: Engineer) => s.projects.find((p) => p.id === e.projectId && p.status === "active");
/** Too tired to be handed one more thing: helper options skip them. */
const spent = (e: Engineer) => e.attrs.energy <= 8;
/** The best communicator staffed on a project, with energy to spare: who you'd send to negotiate or demo it. */
const voiceOf = (s: GameState, p: Project) => by(s.engineers.filter((e) => e.projectId === p.id && !spent(e)), (e) => e.attrs.communication)[0];
const shipped = (p: Project) => p.status === "shipped" || p.status === "late-shipped";
/** Behind as the Projects screen shows it: at current staffing it won’t ship by its due week. */
const behind = (s: GameState, p: Project) => !p.stretch && ["behind", "stalled"].includes(forecast(p, s.engineers, s.techDebt, s.week).kind);
/** The player dealt with the situation, so the event stays away for the rest of the quarter. */
const settle = (type: string): Effect => ({ k: "settle", type });
/** Not yet used this quarter for this person or project (see EventType.oncePer), so setup never picks a spent target. */
const fresh = (s: GameState, type: string, id: string) => !(s.quarterEvents ?? []).includes(`${type}@${id}`);

export const E = {
  attr: (who: string, attr: "coding" | "debugging" | "communication" | "ambition" | "morale" | "energy", d: number): Effect => ({ k: "attr", who, attr, d }),
  loyalty: (who: string, d: number): Effect => ({ k: "loyalty", who, d }),
  trust: (role: "skip" | "pm" | "peer", d: number): Effect => ({ k: "trust", role, d }),
  meter: (m: "techDebt" | "oncallLoad" | "stress" | "capital" | "reputation" | "packet", d: number): Effect => ({ k: "meter", m, d }),
  progress: (project: string, d: number): Effect => ({ k: "progress", project, d }),
  scope: (project: string, d: number): Effect => ({ k: "scope", project, d }),
  team: (attr: "morale" | "energy", d: number): Effect => ({ k: "teamAttr", attr, d }),
  leave: (who: string, how?: "quit" | "cut" | "transfer"): Effect => ({ k: "leave", who, ...(how ? { how } : {}) }),
  away: (who: string): Effect => ({ k: "away", who }),
  assign: (who: string, project: string): Effect => ({ k: "assign", who, project }),
  chance: (p: number, note: string, then: Effect[], els: Effect[] = [], miss?: string): Effect => ({ k: "chance", p, note, then, else: els, ...(miss ? { miss } : {}) }),
};

export const EVENT_TYPES: EventType[] = [
  /* ---------------------------------- PEOPLE ---------------------------------- */
  {
    id: "poaching",
    cat: "PEOPLE",
    canBeRequired: true,
    oncePer: "quarter",
    weight: (s) => (s.engineers.length >= 4 ? 2 : 0),
    setup: (ctx, rng) => {
      const pool = by(ctx.s.engineers, (e) => e.attrs.coding + e.attrs.ambition).slice(0, 3);
      return pool.length ? { ...ctx, subject: rng.pick(pool) } : null;
    },
    build: ({ subject: e }) => ({
      from: e!.name,
      fromRole: levelTitle(e!),
      title: "A recruiter slid into my DMs",
      body: `${first(e!)} mentions, very casually, that a well-funded startup offered “staff-level scope” and a number with a lot of zeros. “I haven’t decided anything.”`,
      intents: [
        {
          id: "counter",
          label: "Fight for a retention bonus",
          cost: 2,
          hints: "Political Capital ↓ · Chance they stay",
          effects: [
            E.meter("capital", -6),
            E.chance(loyaltyOdds(e!, 0.45), "Bonus kept them", [E.loyalty(e!.id, 3), E.attr(e!.id, "morale", 2)], [E.leave(e!.id)]),
          ],
          cause: "Counter-offer",
        },
        {
          id: "growth",
          label: "Talk about growth, not money",
          cost: 1,
          hints: "Chance they stay · Morale risk · Reveals a trait or Loyalty",
          effects: [
            { k: "scout", who: e!.id, d: 1 },
            E.chance(loyaltyOdds(e!, 0.2), "The growth plan landed", [E.loyalty(e!.id, 2), E.attr(e!.id, "morale", 1)], [E.attr(e!.id, "morale", -2)], "Growth talk didn’t land"),
          ],
          cause: "A growth conversation",
        },
        {
          id: "wish",
          label: "Wish them well, mean it",
          cost: 0,
          hints: "Reputation ↑ · Leave risk",
          effects: [
            E.attr(e!.id, "morale", 1),
            E.meter("reputation", 1),
            E.chance(0.25, "They took the offer", [E.leave(e!.id)]),
          ],
          cause: "Gracious, but no counter-offer",
        },
      ],
      ignoreHint: "Morale ↓ · Loyalty ↓ · Leave risk",
      ignoreEffects: [E.attr(e!.id, "morale", -2), E.loyalty(e!.id, -3), E.chance(0.35, "They took the offer", [E.leave(e!.id)])],
      ignoreCause: "Recruiter conversation ignored",
    }),
  },
  {
    id: "candidate",
    cat: "PEOPLE",
    canBeRequired: false,
    weight: (s) => (s.engineers.length < (s.level === "Senior EM" ? 8 : 6) ? 5 : 0),
    setup: (ctx) => {
      const helper = by(ctx.s.engineers, (e) => e.attrs.communication)[0];
      return { ...ctx, subject: helper };
    },
    build: ({ subject: h }) => ({
      from: "Rae Cooper",
      fromRole: "Recruiting partner",
      title: "Mixed signals from the final loop",
      body: "You are short a person. The candidate aced system design and bombed the coding round. Recruiting needs a yes or no by Thursday, which is also when every other thing is happening.",
      intents: [
        {
          id: "join",
          label: "Do a follow-up interview yourself",
          cost: 1,
          hints: "Hiring chance · Stress ↑",
          effects: [E.meter("stress", 2), E.chance(0.7, "Offer accepted", [{ k: "hire" }])],
          cause: "You ran the tie-breaker interview",
        },
        ...(h
          ? [
              {
                id: "delegate",
                label: `Ask ${first(h)} to run the tie-breaker`,
                cost: 0,
                hints: `Hiring chance · ${first(h)} Energy ↓`,
                effects: [E.attr(h.id, "energy", -2), E.chance(0.45, "Offer accepted", [{ k: "hire" }])],
                cause: `${first(h)} ran the tie-breaker`,
              },
            ]
          : []),
        {
          id: "pass",
          label: "Hold the bar, keep the seat empty",
          cost: 0,
          hints: "Reputation ↑ · Stress ↑",
          effects: [E.meter("reputation", 1), E.meter("stress", 2)],
          cause: "Held the hiring bar",
        },
      ],
      ignoreHint: "Political Capital ↓",
      ignoreEffects: [E.meter("capital", -2)],
      ignoreCause: "Recruiting reprioritized your req",
    }),
  },
  {
    id: "underperformer",
    cat: "PEOPLE",
    canBeRequired: false,
    oncePer: "subject",
    // Rolling tickets need tickets: only someone staffed on an active project.
    weight: (s) => (s.engineers.some((e) => e.attrs.coding <= 11 && projectOf(s, e)) ? 2 : 0),
    setup: (ctx) => {
      const e = by(ctx.s.engineers.filter((x) => projectOf(ctx.s, x) && fresh(ctx.s, "underperformer", x.id)), (x) => -x.attrs.coding)[0];
      return e && e.attrs.coding <= 11 ? { ...ctx, subject: e } : null;
    },
    build: ({ subject: e, s }) => ({
      from: "Your own notes",
      fromRole: "1:1 doc, private",
      title: `${first(e!)}’s tickets keep rolling over`,
      body: `Three sprints in a row, the same two tickets. ${first(e!)} says they are “basically done”. The rest of the team has noticed.`,
      intents: [
        {
          id: "coach",
          label: "Set up weekly coaching",
          cost: 2,
          hints: "Morale ↑ · Chance Coding ↑",
          effects: [E.attr(e!.id, "morale", 2), E.chance(0.5, "It clicked", [E.attr(e!.id, "coding", 1)])],
          cause: "Weekly coaching started",
        },
        {
          id: "expectations",
          label: "Write down clear expectations",
          cost: 1,
          hints: "Coding ↑ · Morale ↓",
          effects: [E.attr(e!.id, "coding", 1), E.attr(e!.id, "morale", -2)],
          cause: "Expectations put in writing",
        },
        ...(s.engineers.length >= 4
          ? [
              {
                id: "pip",
                label: "Start a formal PIP with HR",
                cost: 1,
                hints: "Political Capital ↓ · Leave risk",
                effects: [
                  E.meter("capital", -5),
                  E.chance(0.5, "They turned it around", [E.attr(e!.id, "coding", 2)], [E.leave(e!.id)]),
                ],
                cause: "Performance plan started",
              } as IntentSpec,
            ]
          : []),
      ],
      ignoreHint: "Team Morale ↓",
      ignoreEffects: [E.team("morale", -1)],
      ignoreCause: "Rolling tickets nobody addressed",
    }),
  },
  {
    id: "rto_badge",
    cat: "PEOPLE",
    canBeRequired: false,
    oncePer: "quarter",
    weight: (s) => (s.engineers.length >= 4 && s.engineers.some((e) => e.loyalty <= 12) ? 1 : 0),
    setup: (ctx) => {
      const e = by(
        ctx.s.engineers.filter((x) => x.loyalty <= 12),
        (x) => x.attrs.coding,
      )[0];
      return e ? { ...ctx, subject: e } : null;
    },
    build: ({ subject: e }) => ({
      from: "People Ops",
      fromRole: "Badge dashboard",
      title: "The badge data is now a dashboard",
      body: `Sorted ascending. ${first(e!)} is at the top: 1.2 days a week in the office, and the most merged PRs on the team.`,
      intents: [
        {
          id: "talk",
          label: "Have the talk",
          cost: 1,
          hints: "Skip Trust ↑ · Morale ↓ · Leave risk",
          effects: [E.trust("skip", 3), E.attr(e!.id, "morale", -3), E.loyalty(e!.id, -2), E.chance(0.15, "They started interviewing", [E.leave(e!.id)])],
          cause: "Had the office-days talk",
        },
        {
          id: "exception",
          label: "Quietly file an exception",
          cost: 1,
          hints: "Political Capital ↓ · Loyalty ↑ · Trust risk",
          effects: [E.meter("capital", -5), E.loyalty(e!.id, 3), E.chance(0.3, "HR noticed", [E.trust("skip", -4)])],
          cause: "Filed a quiet exception",
        },
        {
          id: "worth",
          label: "Make office days worth it",
          cost: 2,
          hints: "Team Morale ↑ · Stress ↑",
          effects: [E.team("morale", 1), E.meter("stress", 3), E.trust("skip", 1)],
          cause: "Design reviews and lunch on Tuesdays",
        },
      ],
      ignoreHint: "Morale ↓ · Loyalty ↓ · Skip Trust ↓",
      ignoreEffects: [E.attr(e!.id, "morale", -4), E.loyalty(e!.id, -2), E.trust("skip", -2)],
      ignoreCause: "HR emailed them directly",
    }),
  },

  /* --------------------------------- DELIVERY --------------------------------- */
  {
    id: "scope_creep",
    cat: "DELIVERY",
    canBeRequired: true,
    oncePer: "project", // the same "live dashboard for the demo" only lands once on a project
    weight: (s) => (active(s).length ? 3 : 0),
    setup: (ctx, rng) => {
      const ps = active(ctx.s).filter((p) => fresh(ctx.s, "scope_creep", p.id));
      if (!ps.length) return null;
      const p = rng.pick(ps);
      return { ...ctx, project: p, subject: voiceOf(ctx.s, p) };
    },
    build: ({ project: p, pm, subject: h }) => ({
      from: pm.name,
      fromRole: "Product Manager",
      title: "One small addition to scope",
      body: `${p!.name} needs a live dashboard for the demo. ${pm.name.split(" ")[0]} says it is “basically the same data, just in a different shape.” The deadline has not moved.`,
      intents: [
        {
          id: "negotiate",
          label: "Negotiate the scope down",
          cost: 2,
          hints: "Deadline protected · PM Trust ↓",
          effects: [E.trust("pm", -1)],
          cause: "Scope negotiated, deadline kept",
        },
        {
          id: "agree",
          label: "Agree to the dashboard",
          cost: 1,
          hints: "PM Trust ↑↑ · Scope ↑ · Delivery risk",
          effects: [E.trust("pm", 6), E.scope(p!.id, 15)],
          cause: "Dashboard added to scope",
        },
        ...(h
          ? [
              {
                id: "delegate",
                label: `Let ${first(h)} handle the tradeoff`,
                cost: 0,
                hints: `Depends on Communication · ${first(h)} Energy ↓`,
                effects: [
                  E.attr(h.id, "energy", -2),
                  E.chance(Math.min(0.9, h.attrs.communication / 20), "Negotiation landed", [E.trust("pm", 2)], [E.scope(p!.id, 10)], "Product won that one"),
                ],
                cause: `${first(h)} negotiated with product`,
              },
            ]
          : []),
      ],
      ignoreHint: "Scope ↑ · PM Trust ↓",
      ignoreEffects: [E.trust("pm", -3), E.scope(p!.id, 8)],
      ignoreCause: "Silence read as a yes",
    }),
  },
  {
    id: "tech_debt",
    cat: "DELIVERY",
    canBeRequired: false,
    weight: (s) => (s.techDebt >= 30 ? 4 : 1),
    setup: (ctx) => {
      const e = by(ctx.s.engineers, (x) => x.attrs.debugging)[0];
      const p = active(ctx.s)[0];
      return e ? { ...ctx, subject: e, project: p } : null;
    },
    build: ({ subject: e, project: p, s }) => {
      // Fixing it, or promising to, settles the build for the quarter: the promise brings it back when due.
      const fix: Effect[] = [E.meter("techDebt", -12), ...(p ? [E.progress(p.id, -6)] : []), settle("tech_debt")];
      return {
        from: e!.name,
        fromRole: levelTitle(e!),
        title: "Can we please fix the build?",
        body: `CI takes 41 minutes and fails one run in five. ${first(e!)} has a plan and a sprint-sized estimate. Tech Debt is ${s.techDebt}/100.`,
        intents: [
          {
            id: "approve",
            label: "Give it a sprint",
            cost: 1,
            hints: `Tech Debt ↓↓${p ? " · Progress ↓" : ""}`,
            effects: fix,
            cause: "Build fix sprint",
          },
          {
            id: "later",
            label: "Promise it next month",
            cost: 0,
            hints: `Promise due wk ${Math.min(12, s.week + 4)}`,
            effects: [
              {
                k: "promise",
                who: e!.id,
                text: `${first(e!)}: the build fix gets its sprint.`,
                dueIn: 4,
                payload: fix,
                payloadHint: `Tech Debt ↓↓${p ? " · Progress ↓" : ""}`,
              },
              settle("tech_debt"),
            ],
            cause: "Build fix promised for later",
          },
        ],
        ignoreHint: "Tech Debt ↑",
        ignoreEffects: [E.meter("techDebt", 4)],
        ignoreCause: "Flaky CI left alone",
      };
    },
  },
  {
    id: "estimate_blown",
    cat: "DELIVERY",
    canBeRequired: true,
    oncePer: "project",
    // Only a project that is actually behind its schedule; one that is ahead gets no crisis.
    weight: (s) => (s.week >= 3 && active(s).some((p) => behind(s, p)) ? 4 : 0),
    setup: (ctx) => {
      const ps = active(ctx.s).filter((p) => behind(ctx.s, p) && fresh(ctx.s, "estimate_blown", p.id));
      if (!ps.length) return null;
      const p = by(ps, (x) => expectedProgress(x, ctx.s.week) - x.progress)[0];
      return { ...ctx, project: p };
    },
    build: ({ project: p, s }) => {
      const team = s.engineers.filter((e) => e.projectId === p!.id);
      return {
        from: "Sprint review",
        fromRole: `${p!.name} · due week ${p!.dueWeek}`,
        title: "The estimate was a belief",
        body: `${p!.name} is at ${Math.round((p!.progress / p!.scope) * 100)}% with ${Math.max(1, p!.dueWeek - s.week + 1)} week${p!.dueWeek - s.week + 1 === 1 ? "" : "s"} left. Someone says “we just need to push a bit.”`,
        intents: [
          {
            id: "cut",
            label: "Cut scope with the PM",
            cost: 1,
            hints: "Scope ↓ · PM Trust ↓",
            effects: [E.scope(p!.id, -12), E.trust("pm", -3)],
            cause: "Scope cut to protect the date",
          },
          {
            id: "crunch",
            label: "Ask the team to crunch",
            cost: 1,
            hints: "Progress ↑ · Team Energy ↓",
            effects: [E.progress(p!.id, 10), ...team.map((e) => E.attr(e.id, "energy", -3))],
            cause: "Crunch week",
          },
          {
            id: "borrow",
            label: "Borrow two engineers from another team",
            cost: 1,
            hints: "PM Trust ↑ · Progress ↓",
            effects: [E.trust("pm", 2), E.progress(p!.id, -5)],
            cause: "Borrowed engineers spent the week ramping up",
          },
          // The Vercel keynote date cannot move, so a slip is not on offer for the flagship there.
          ...(p!.flagship && s.company === "Vercel"
            ? []
            : [
                {
                  id: "slip",
                  label: "Tell the skip-level it will slip",
                  cost: 2,
                  hints: "Deadline +2 weeks · Skip Trust ↓",
                  effects: [E.trust("skip", -4), { k: "deadline", project: p!.id, d: 2 } as Effect],
                  cause: "Slip communicated early",
                } as IntentSpec,
              ]),
        ],
        ignoreHint: "Stress ↑",
        ignoreEffects: [E.meter("stress", 2)],
        ignoreCause: "Blown estimate not addressed",
      };
    },
  },
  {
    id: "dependency_late",
    cat: "DELIVERY",
    canBeRequired: false,
    oncePer: "project", // one late endpoint per project; a workaround is not built twice
    weight: (s) => (active(s).length ? 2 : 0),
    setup: (ctx, rng) => {
      const ps = active(ctx.s).filter((p) => fresh(ctx.s, "dependency_late", p.id));
      return ps.length ? { ...ctx, project: rng.pick(ps) } : null;
    },
    build: ({ project: p, peer }) => ({
      from: peer.name,
      fromRole: "Peer EM",
      title: "Our API will be “a bit” late",
      body: `${peer.name.split(" ")[0]}’s team owns the endpoint ${p!.name} depends on. “A bit” has historically meant three weeks.`,
      intents: [
        {
          id: "escalate",
          label: "Escalate to both skip-levels",
          cost: 1,
          hints: "Peer Trust ↓ · Delivery risk",
          effects: [E.trust("peer", -5), E.chance(0.6, "They delivered", [], [E.progress(p!.id, -4)], "Still late")],
          cause: "Dependency escalated",
        },
        {
          id: "workaround",
          label: "Build a temporary workaround",
          cost: 2,
          hints: "Progress protected · Tech Debt ↑",
          effects: [E.meter("techDebt", 5)],
          cause: "Temporary workaround shipped",
        },
        {
          id: "wait",
          label: "Wait it out, politely",
          cost: 0,
          hints: "Progress ↓ · Peer Trust ↑",
          effects: [E.progress(p!.id, -5), E.trust("peer", 3)],
          cause: "Waited on the dependency",
        },
      ],
      ignoreHint: "Progress ↓",
      ignoreEffects: [E.progress(p!.id, -7)],
      ignoreCause: "Blocked on another team",
    }),
  },
  {
    id: "slop_pr",
    cat: "DELIVERY",
    canBeRequired: false,
    // The PR is for a project the author is staffed on. A PR-size rule settles it for the quarter.
    weight: (s) => (s.engineers.some((e) => e.attrs.ambition >= 12 && e.attrs.debugging <= 11 && projectOf(s, e)) && s.engineers.length >= 3 ? 2 : 0),
    setup: (ctx) => {
      const a = by(
        ctx.s.engineers.filter((e) => e.attrs.ambition >= 12 && e.attrs.debugging <= 11 && projectOf(ctx.s, e)),
        (e) => e.attrs.ambition,
      )[0];
      const o = by(
        ctx.s.engineers.filter((e) => e !== a),
        (e) => e.attrs.debugging,
      )[0];
      if (!a || !o) return null;
      return { ...ctx, subject: a, other: o, project: projectOf(ctx.s, a) };
    },
    build: ({ subject: a, other: o, project: p }) => ({
      from: a!.name,
      fromRole: levelTitle(a!),
      title: "+4,212 / −38, titled “small refactor”",
      body: `Three LGTM emoji in six minutes. ${first(o!)} is reading it line by line, silently, and has stopped answering Slack.`,
      intents: [
        {
          id: "review",
          label: `Ask ${first(o!)} to review it properly`,
          cost: 0,
          hints: `${first(o!)} Energy ↓ · Progress ↑`,
          effects: [E.attr(o!.id, "energy", -3), ...(p ? [E.progress(p.id, 3)] : [])],
          cause: `${first(o!)} reviewed the giant PR`,
        },
        {
          id: "block",
          label: "Block it and set a PR-size rule",
          cost: 1,
          hints: `${first(a!)} Morale ↓ · Tech Debt ↓`,
          effects: [E.attr(a!.id, "morale", -2), E.attr(o!.id, "morale", 1), E.meter("techDebt", -3), settle("slop_pr")],
          cause: "PR-size rule introduced",
        },
        {
          id: "merge",
          label: "Merge it, CI is green",
          cost: 0,
          hints: "Progress ↑ · Tech Debt ↑ · On-call Load ↑",
          effects: [...(p ? [E.progress(p.id, 6)] : []), E.meter("techDebt", 7), E.meter("oncallLoad", 5)],
          cause: "Merged on green",
        },
      ],
      ignoreHint: "Tech Debt ↑ · Morale ↓",
      ignoreEffects: [E.meter("techDebt", 5), E.attr(o!.id, "morale", -1)],
      ignoreCause: "It merged anyway",
    }),
  },
  {
    id: "keynote_oneup",
    cat: "DELIVERY",
    canBeRequired: false,
    oncePer: "quarter",
    weight: (s) =>
      s.company === "Vercel" && s.week < 8 && s.projects.some((p) => p.flagship && p.status === "active") && !seenThisQuarter(s, "keynote_oneup") ? 3 : 0,
    setup: (ctx) => {
      const p = ctx.s.projects.find((x) => x.flagship && x.status === "active");
      // Someone on the flagship demos it; anyone can step in if nobody is staffed.
      const e = p && (voiceOf(ctx.s, p) ?? by(ctx.s.engineers, (x) => x.attrs.communication)[0]);
      return p && e ? { ...ctx, project: p, subject: e } : null;
    },
    build: ({ project: p, subject: e }) => ({
      from: "The CEO",
      fromRole: "Quote-tweet, one emoji",
      title: "A competitor launched your keynote feature",
      body: `On a Tuesday. The CEO quote-tweeted it with a single 👀. ${p!.name} is still due on stage in week 8.`,
      intents: [
        {
          id: "add",
          label: "Add the thing they didn’t do",
          cost: 1,
          hints: "Skip Trust ↑ · Scope ↑",
          effects: [E.scope(p!.id, 15), E.trust("skip", 4)],
          cause: "Added a differentiator to the keynote",
        },
        {
          id: "demo",
          label: `Same feature, better demo with ${first(e!)}`,
          cost: 2,
          hints: `${first(e!)} Energy ↓ · Depends on Communication`,
          effects: [E.attr(e!.id, "energy", -2), E.chance(e!.attrs.communication / 20, "The demo was the story", [E.meter("reputation", 3)])],
          cause: "Rehearsed a better demo",
        },
        {
          id: "preview",
          label: "Ship it tonight as a “preview”",
          cost: 1,
          hints: "Reputation ↑ · Tech Debt ↑ · On-call Load ↑",
          effects: [E.meter("reputation", 2), E.meter("techDebt", 6), E.meter("oncallLoad", 6)],
          cause: "Shipped a preview the same night",
        },
      ],
      ignoreHint: "Scope ↑↑ · Skip Trust ↓",
      ignoreEffects: [E.scope(p!.id, 20), E.trust("skip", -2)],
      ignoreCause: "The CEO scoped the response personally",
    }),
  },
  {
    id: "postmortem_name",
    cat: "DELIVERY",
    canBeRequired: false,
    oncePer: "quarter",
    // Only after a real escalation last Friday, and the name in bold is whoever carried the pager then.
    weight: (s) => (s.company === "Stripe" && s.lastWeek?.incident?.escalated && !seenThisQuarter(s, "postmortem_name") ? 3 : 0),
    setup: (ctx) => {
      const e = ctx.s.engineers.find((x) => x.id === ctx.s.lastWeek?.incident?.oncallId);
      return e ? { ...ctx, subject: e } : null;
    },
    build: ({ subject: e, s }) => ({
      from: "Merchant success",
      fromRole: "Escalation thread",
      title: "The CFO wants to know who",
      body: `Draft three of the postmortem has ${first(e!)}’s name in the timeline, in bold. The merchant’s CFO is asking “who” in all caps.`,
      intents: [
        {
          id: "blameless",
          label: "Rewrite it blameless, own it yourself",
          cost: 1,
          hints: "Loyalty ↑ · Skip Trust ↓",
          effects: [E.trust("skip", -3), E.loyalty(e!.id, 4), E.attr(e!.id, "morale", 2)],
          cause: "Took the blame off the timeline",
        },
        {
          id: "name",
          label: "Leave the name in",
          cost: 0,
          hints: "Skip Trust ↑ · Morale ↓ · On-call Load ↑",
          effects: [E.trust("skip", 2), E.attr(e!.id, "morale", -4), E.loyalty(e!.id, -3), E.meter("oncallLoad", 5)],
          cause: "The name stayed in the postmortem",
        },
        {
          id: "actions",
          label: "Turn it into owned action items",
          cost: 2,
          hints: `Tech Debt ↓ · Promise due wk ${Math.min(12, s.week + 3)}`,
          effects: [
            E.meter("techDebt", -5),
            E.attr(e!.id, "debugging", 1),
            {
              k: "promise",
              who: e!.id,
              text: `${first(e!)}: the incident action items get closed.`,
              dueIn: 3,
              payload: [E.meter("oncallLoad", -6), E.meter("techDebt", -3)],
              payloadHint: "On-call Load ↓ · Tech Debt ↓",
            },
          ],
          cause: "Owned action items",
        },
      ],
      ignoreHint: "Morale ↓ · Loyalty ↓",
      ignoreEffects: [E.attr(e!.id, "morale", -2), E.loyalty(e!.id, -2)],
      ignoreCause: "The draft went out as it was",
    }),
  },

  /* --------------------------------- POLITICS --------------------------------- */
  {
    id: "quick_deck",
    cat: "POLITICS",
    canBeRequired: true,
    oncePer: "quarter",
    weight: (s) => 3 * (s.company === "Google" ? 1.3 : 1),
    setup: (ctx) => ctx,
    build: ({ skip }) => ({
      from: skip.name,
      fromRole: "Skip-level",
      title: "A quick deck for the QBR",
      body: "“Nothing fancy. Five slides on impact, risks, headcount, the roadmap and the roadmap’s roadmap. Before Thursday?”",
      intents: [
        {
          id: "build",
          label: "Build the five-slide version",
          cost: 2,
          hints: "Skip Trust ↑ · Packet evidence",
          effects: [E.trust("skip", 6), E.meter("packet", 1)],
          cause: "QBR deck delivered",
        },
        {
          id: "reuse",
          label: "Send the existing weekly update",
          cost: 0,
          hints: "Time saved · Stress ↓ · Trust risk",
          effects: [E.meter("stress", -1), E.chance(0.5, "Good enough", [], [E.trust("skip", -4)], "They wanted the deck")],
          cause: "Weekly update sent instead",
        },
        {
          id: "pushback",
          label: "Push back on the timing",
          cost: 1,
          hints: "Stress ↓ · Political Capital ↓ · Skip Trust ↓",
          effects: [E.meter("stress", -4), E.meter("capital", -4), E.trust("skip", -2)],
          cause: "Negotiated the deck deadline",
        },
      ],
      ignoreHint: "Skip Trust ↓",
      ignoreEffects: [E.trust("skip", -6)],
      ignoreCause: "No deck on Thursday",
    }),
  },
  {
    id: "ceo_ask",
    cat: "POLITICS",
    canBeRequired: false,
    oncePer: "quarter",
    weight: (s) => 2 * (s.company === "Vercel" ? 1.5 : 1),
    setup: (ctx) => ({ ...ctx, project: active(ctx.s)[0] }),
    build: ({ project: p }) => ({
      from: "The CEO",
      fromRole: "Office of the CEO",
      title: "“Can we make it agentic?”",
      body: "A forwarded screenshot, no context. “Can we get something like this in for the demo?” The screenshot is from a completely different industry.",
      intents: [
        {
          id: "doc",
          label: "Write a small exploration doc",
          cost: 2,
          hints: "Reputation ↑ · Delivery risk",
          effects: [E.meter("reputation", 2), ...(p ? [E.progress(p.id, -3)] : [])],
          cause: "Agent exploration doc",
        },
        {
          id: "triage",
          label: "Ask the PM to triage it",
          cost: 0,
          hints: "PM Trust ↓ · Time saved",
          effects: [E.trust("pm", -3)],
          cause: "CEO ask passed to product",
        },
        {
          id: "prototype",
          label: "Build a throwaway agent prototype",
          cost: 3,
          hints: "Skip Trust ↑ · Reputation ↑ · Tech Debt ↑",
          effects: [E.trust("skip", 5), E.meter("reputation", 2), E.meter("techDebt", 6)],
          cause: "Throwaway agent prototype",
        },
      ],
      ignoreHint: "Political Capital ↓ · May fade away · Trust risk",
      ignoreEffects: [E.meter("capital", -2), E.chance(0.7, "Quietly forgotten", [], [E.trust("skip", -4)], "The CEO asked again")],
      ignoreCause: "CEO ask left unanswered",
    }),
  },
  {
    id: "peer_credit",
    cat: "POLITICS",
    canBeRequired: false,
    // Credit needs a launch to steal: once per project your team shipped this quarter.
    oncePer: "project",
    weight: (s) => (s.projects.some(shipped) ? 2 * (s.company === "Google" ? 1.4 : 1) : 0),
    setup: (ctx) => {
      const p = ctx.s.projects.find((x) => shipped(x) && fresh(ctx.s, "peer_credit", x.id));
      return p ? { ...ctx, project: p } : null;
    },
    build: ({ peer, project: p }) => ({
      from: peer.name,
      fromRole: "Peer EM",
      title: "“Great collab, team!”",
      body: `${peer.name.split(" ")[0]}’s all-hands slide shows ${p!.name} under their team’s name. Several people reacted with the rocket emoji.`,
      intents: [
        {
          id: "confront",
          label: "Correct the record, privately",
          cost: 1,
          hints: "Peer Trust ↓ · Reputation ↑",
          effects: [E.trust("peer", -6), E.meter("reputation", 1)],
          cause: "Credit corrected with the peer EM",
        },
        {
          id: "kudos",
          label: "Post public kudos to your team",
          cost: 1,
          hints: "Team Morale ↑ · Packet evidence · Peer Trust ↓",
          effects: [E.team("morale", 1), E.meter("packet", 1), E.trust("peer", -2)],
          cause: "Public kudos for the team",
        },
        {
          id: "letgo",
          label: "Let it go",
          cost: 0,
          hints: "Reputation ↓ · Peer Trust ↑",
          effects: [E.meter("reputation", -2), E.trust("peer", 3)],
          cause: "Let the credit slide",
        },
      ],
      ignoreHint: "Reputation ↓↓",
      ignoreEffects: [E.meter("reputation", -3)],
      ignoreCause: "Credit taken, unchallenged",
    }),
  },
  {
    id: "ai_mandate",
    cat: "POLITICS",
    canBeRequired: true,
    oncePer: "quarter",
    weight: (s) => (s.week >= 2 && !seenThisQuarter(s, "ai_mandate") ? 1.5 : 0),
    setup: (ctx) => {
      const e = by(ctx.s.engineers, (x) => x.attrs.coding)[0];
      return e ? { ...ctx, subject: e } : null;
    },
    build: ({ subject: e, skip }) => ({
      from: skip.name,
      fromRole: "Skip-level",
      title: "Bottom quartile on the token leaderboard",
      body: "Leadership says AI usage “isn’t a performance metric”. It is on the performance slide, next to your team’s name.",
      intents: [
        {
          id: "mandate",
          label: "Mandate daily AI usage",
          cost: 0,
          hints: "Skip Trust ↑ · Team Morale ↓ · Tech Debt ↑",
          effects: [E.trust("skip", 4), E.team("morale", -1), E.meter("techDebt", 5)],
          cause: "Mandated daily AI usage",
        },
        {
          id: "pilot",
          label: `Run a real pilot with ${first(e!)}`,
          cost: 2,
          hints: `Skip Trust ↑ · ${first(e!)} Energy ↓ · Tech Debt ↓`,
          effects: [E.trust("skip", 2), E.attr(e!.id, "energy", -2), E.meter("reputation", 1), E.meter("techDebt", -2)],
          cause: "Ran a real AI pilot",
        },
        {
          id: "data",
          label: "Push back with delivery data",
          cost: 1,
          hints: "Team Morale ↑ · Political Capital ↓ · Skip Trust ↓",
          effects: [E.meter("capital", -5), E.trust("skip", -2), E.team("morale", 1)],
          cause: "Pushed back with delivery data",
        },
      ],
      ignoreHint: "Skip Trust ↓ · Trust risk",
      ignoreEffects: [E.trust("skip", -4), E.chance(0.5, "Your name is on the slide", [E.trust("skip", -3)])],
      ignoreCause: "The leaderboard got discussed without you",
    }),
  },
  {
    id: "skip_feedback",
    cat: "POLITICS",
    canBeRequired: false,
    oncePer: "quarter",
    weight: (s) => (s.week >= 3 && !seenThisQuarter(s, "skip_feedback") ? 1.5 : 0),
    setup: (ctx) => ctx,
    build: ({ skip }) => ({
      from: skip.name,
      fromRole: "After the skip-level 1:1s",
      title: "“The team doesn’t know the strategy”",
      body: "The skip-levels “went great”. One note, no names, which tells you exactly which name.",
      intents: [
        {
          id: "who",
          label: "Ask who said it",
          cost: 0,
          hints: "Skip Trust ↓ · Team Morale ↓",
          effects: [E.trust("skip", -5), E.team("morale", -1)],
          cause: "Asked who said it",
        },
        {
          id: "doc",
          label: "Write the team strategy doc",
          cost: 2,
          hints: "Skip Trust ↑ · Team Morale ↑ · Stress ↑",
          effects: [E.trust("skip", 4), E.team("morale", 1), E.meter("stress", 4)],
          cause: "Wrote the team strategy doc",
        },
        {
          id: "invite",
          label: "Bring the skip to your team meeting",
          cost: 1,
          hints: "Political Capital ↓ · Coin flip",
          effects: [E.meter("capital", -2), E.chance(0.6, "It went well", [E.trust("skip", 3), E.team("morale", 1)], [E.trust("skip", -2)], "It went sideways")],
          cause: "Brought the skip-level to team meeting",
        },
      ],
      ignoreHint: "Skip Trust ↓ · Stress ↑",
      ignoreEffects: [E.trust("skip", -4), E.meter("stress", 2)],
      ignoreCause: "The feedback stayed in the air",
    }),
  },

  /* ------------------------- THE BACK HALF OF A QUARTER ------------------------- */
  // Planning, perf season and the end-of-quarter rituals: they arrive from week 6 on, when the
  // once-a-quarter politics are spent, so the second half is as busy as the first.
  {
    id: "headcount_plan",
    cat: "POLITICS",
    canBeRequired: true,
    oncePer: "quarter",
    weight: (s) => (s.week >= 7 ? 3 : 0),
    setup: (ctx) => ctx,
    build: ({ skip }) => ({
      from: skip.name,
      fromRole: "Skip-level · planning",
      title: "Next quarter’s headcount sheet",
      body: `${skip.name.split(" ")[0]}’s sheet has one row per team and a column called “Justification (one line)”. Planning locks on Friday.`,
      intents: [
        {
          id: "case",
          label: "Write a real case, with delivery data",
          cost: 2,
          hints: "Political Capital ↑ · Skip Trust ↑ · Stress ↑",
          effects: [E.meter("capital", 6), E.trust("skip", 3), E.meter("stress", 3)],
          cause: "Made a data-backed headcount case",
        },
        {
          id: "trade",
          label: "Offer to drop a project for a hire",
          cost: 1,
          hints: "Political Capital ↑ · PM Trust ↓",
          effects: [E.meter("capital", 4), E.trust("pm", -4)],
          cause: "Traded roadmap for headcount",
        },
        {
          id: "flat",
          label: "Ask for flat headcount",
          cost: 0,
          hints: "Time saved · Political Capital ↓",
          effects: [E.meter("capital", -2)],
          cause: "Asked for flat headcount",
        },
      ],
      ignoreHint: "Skip Trust ↓ · Political Capital ↓",
      ignoreEffects: [E.trust("skip", -3), E.meter("capital", -3)],
      ignoreCause: "Headcount row left blank",
    }),
  },
  {
    id: "holiday_oncall",
    cat: "PEOPLE",
    canBeRequired: false,
    oncePer: "quarter",
    weight: (s) => (s.week >= 6 && s.plan.oncallId && s.engineers.length >= 3 ? 2 + s.oncallLoad / 40 : 0),
    setup: (ctx) => {
      const e = ctx.s.engineers.find((x) => x.id === ctx.s.plan.oncallId);
      return e ? { ...ctx, subject: e } : null;
    },
    build: ({ subject: e }) => ({
      from: e!.name,
      fromRole: `${levelTitle(e!)} · on call`,
      title: "Nobody wants the holiday rotation",
      body: `The long weekend falls on ${first(e!)}’s week. ${first(e!)} has written “family plans”, in quotes, in the rotation doc.`,
      intents: [
        {
          id: "cover",
          label: "Take the pager yourself",
          cost: 1,
          hints: "Team Morale ↑ · Stress ↑",
          effects: [E.team("morale", 1), E.attr(e!.id, "energy", 1), E.meter("stress", 4)],
          cause: "Covered the holiday pager yourself",
        },
        {
          id: "comp",
          label: "Give comp days for it",
          cost: 0,
          hints: `${first(e!)} Energy ↑ · Political Capital ↓`,
          effects: [E.attr(e!.id, "energy", 2), E.attr(e!.id, "morale", 1), E.meter("capital", -4)],
          cause: "Comp days for the holiday shift",
        },
        {
          id: "rota",
          label: "Hold the rotation as written",
          cost: 0,
          hints: `${first(e!)} Morale ↓ · On-call Load ↓`,
          effects: [E.attr(e!.id, "morale", -2), E.meter("oncallLoad", -2)],
          cause: "The rotation held",
        },
      ],
      ignoreHint: "Morale ↓ · Loyalty ↓",
      ignoreEffects: [E.attr(e!.id, "morale", -1), E.loyalty(e!.id, -1)],
      ignoreCause: "The rotation fight was left to the team",
    }),
  },
  {
    id: "offsite",
    cat: "PEOPLE",
    canBeRequired: false,
    oncePer: "quarter",
    weight: (s) => (s.week >= 6 && s.week <= 11 ? 2 : 0),
    setup: (ctx) => ({ ...ctx, project: active(ctx.s)[0] }),
    build: ({ project: p }) => ({
      from: "People Ops",
      fromRole: "Offsite planning",
      title: "The offsite has a trust fall",
      body: "Two days, one venue with a ropes course, and an agenda slot called “Teams: present your learnings”. Attendance is “strongly encouraged”.",
      intents: [
        {
          id: "run",
          label: "Go, and run a real retro there",
          cost: 2,
          hints: "Team Morale ↑ · Team Energy ↑ · Stress ↑",
          effects: [E.team("morale", 2), E.team("energy", 1), E.meter("stress", 3)],
          cause: "A real retro at the offsite",
        },
        {
          id: "send",
          label: "Send the team, skip it yourself",
          cost: 0,
          hints: "Team Morale ↑ · Skip Trust ↓",
          effects: [E.team("morale", 1), E.trust("skip", -3)],
          cause: "The team went without you",
        },
        {
          id: "decline",
          label: "Decline for everyone: there’s a deadline",
          cost: 1,
          hints: `${p ? "Progress ↑ · " : ""}Team Morale ↓ · Skip Trust ↓`,
          effects: [...(p ? [E.progress(p.id, 4)] : []), E.team("morale", -1), E.trust("skip", -2)],
          cause: "Skipped the offsite for the roadmap",
        },
      ],
      ignoreHint: "Skip Trust ↓",
      ignoreEffects: [E.trust("skip", -4)],
      ignoreCause: "Nobody RSVP’d",
    }),
  },
  {
    id: "peer_feedback",
    cat: "PEOPLE",
    canBeRequired: true,
    oncePer: "quarter",
    weight: (s) => (s.week >= 8 ? 3 : 0),
    setup: (ctx) => ctx,
    build: ({ s }) => ({
      from: "People Ops",
      fromRole: "Performance cycle",
      title: "Peer feedback is due Friday",
      body: `${s.engineers.length} engineers, three questions each, and a form that times out after twenty minutes.`,
      intents: [
        {
          id: "write",
          label: "Write every one properly",
          cost: 2,
          hints: "Team Morale ↑ · Loyalty ↑ · Stress ↑",
          effects: [E.team("morale", 1), ...s.engineers.map((e) => E.loyalty(e.id, 1)), E.meter("stress", 4)],
          cause: "Wrote real feedback for everyone",
        },
        {
          id: "self",
          label: "Ask for self-reviews first",
          cost: 1,
          hints: "Time saved · Team Energy ↓",
          effects: [E.team("energy", -1)],
          cause: "Self-reviews first",
        },
        {
          id: "template",
          label: "Reuse last cycle’s phrasing",
          cost: 0,
          hints: "Stress ↓ · Morale risk",
          effects: [E.meter("stress", -2), E.chance(0.5, "Nobody noticed", [], [E.team("morale", -1)], "Someone noticed")],
          cause: "Recycled feedback",
        },
      ],
      ignoreHint: "Morale ↓ · Skip Trust ↓",
      ignoreEffects: [E.team("morale", -1), E.trust("skip", -3)],
      ignoreCause: "Feedback went in late",
    }),
  },
  {
    id: "game_day",
    cat: "DELIVERY",
    canBeRequired: false,
    oncePer: "quarter",
    weight: (s) => (s.week >= 4 && s.oncallLoad >= 35 ? 2 : 0),
    setup: (ctx) => {
      const e = by(ctx.s.engineers.filter((x) => !spent(x)), (x) => x.attrs.debugging)[0];
      return e ? { ...ctx, subject: e, project: active(ctx.s)[0] } : null;
    },
    build: ({ subject: e, project: p }) => ({
      from: "Reliability desk",
      fromRole: "Game day",
      title: "A game day, this Thursday",
      body: `The SRE team wants to unplug things on purpose and see who notices. ${first(e!)} has volunteered the team, enthusiastically.`,
      intents: [
        {
          id: "run",
          label: "Run it properly",
          cost: 2,
          hints: `On-call Load ↓↓ · Debugging ↑${p ? " · Progress ↓" : ""}`,
          effects: [E.meter("oncallLoad", -10), E.attr(e!.id, "debugging", 1), ...(p ? [E.progress(p.id, -4)] : [])],
          cause: "Ran a proper game day",
        },
        {
          id: "lead",
          label: `Let ${first(e!)} run it`,
          cost: 0,
          hints: `On-call Load ↓ · ${first(e!)} Energy ↓`,
          effects: [E.meter("oncallLoad", -5), E.attr(e!.id, "energy", -3)],
          cause: `${first(e!)} ran the game day`,
        },
        {
          id: "postpone",
          label: "Postpone it to next quarter",
          cost: 0,
          hints: "Time saved · Incident risk",
          effects: [E.meter("oncallLoad", 3)],
          cause: "Game day postponed",
        },
      ],
      ignoreHint: "On-call Load ↑",
      ignoreEffects: [E.meter("oncallLoad", 4)],
      ignoreCause: "The game day ran without a plan",
    }),
  },
  {
    id: "customer_escalation",
    cat: "DELIVERY",
    canBeRequired: true,
    oncePer: "project",
    weight: (s) => (s.week >= 3 && active(s).some((p) => s.engineers.some((e) => e.projectId === p.id)) ? 2 : 0),
    setup: (ctx, rng) => {
      const ps = active(ctx.s).filter((p) => voiceOf(ctx.s, p) && fresh(ctx.s, "customer_escalation", p.id));
      if (!ps.length) return null;
      const p = rng.pick(ps);
      return { ...ctx, project: p, subject: voiceOf(ctx.s, p) };
    },
    build: ({ project: p, subject: e, pm }) => ({
      from: pm.name,
      fromRole: "Product Manager",
      title: "A big customer found the bug",
      body: `An enterprise customer hit a bug in ${p!.name} during their own launch. ${pm.name.split(" ")[0]} opened a shared Slack channel, and fourteen people joined in the first minute.`,
      intents: [
        {
          id: "swarm",
          label: "Swarm it with the whole team",
          cost: 1,
          hints: "PM Trust ↑ · Progress ↓ · Team Energy ↓",
          effects: [E.trust("pm", 4), E.progress(p!.id, -8), E.team("energy", -1)],
          cause: "Swarmed the customer bug",
        },
        {
          id: "owner",
          label: `${first(e!)} owns the fix`,
          cost: 0,
          hints: `PM Trust ↑ · ${first(e!)} Energy ↓`,
          effects: [E.trust("pm", 2), E.attr(e!.id, "energy", -3)],
          cause: `${first(e!)} fixed it for the customer`,
        },
        {
          id: "workaround",
          label: "Ship a documented workaround",
          cost: 1,
          hints: "Tech Debt ↑ · Reputation ↓",
          effects: [E.meter("techDebt", 4), E.meter("reputation", -1)],
          cause: "Workaround documented for the customer",
        },
      ],
      ignoreHint: "PM Trust ↓↓ · Reputation ↓",
      ignoreEffects: [E.trust("pm", -6), E.meter("reputation", -2)],
      ignoreCause: "The customer escalated to the CEO",
    }),
  },
  {
    id: "okr_grades",
    cat: "POLITICS",
    canBeRequired: false,
    oncePer: "quarter",
    weight: (s) => (s.week >= 10 ? 3 : 0),
    setup: (ctx) => ctx,
    build: ({ skip }) => ({
      from: skip.name,
      fromRole: "Skip-level · quarter end",
      title: "Grade your OKRs by Thursday",
      body: `Every key result needs a number between 0 and 1. ${skip.name.split(" ")[0]} adds that 0.7 is “the new 1.0”.`,
      intents: [
        {
          id: "story",
          label: "Write the story behind each grade",
          cost: 2,
          hints: "Skip Trust ↑ · Packet evidence · Stress ↑",
          effects: [E.trust("skip", 4), E.meter("packet", 1), E.meter("stress", 2)],
          cause: "OKRs graded, with the story",
        },
        {
          id: "honest",
          label: "Grade them honestly",
          cost: 1,
          hints: "Reputation ↑ · Skip Trust ↓",
          effects: [E.meter("reputation", 2), E.trust("skip", -1)],
          cause: "Honest OKR grades",
        },
        {
          id: "round",
          label: "Round everything up to 0.7",
          cost: 0,
          hints: "Skip Trust ↑ · Trust risk",
          effects: [E.trust("skip", 2), E.chance(0.6, "Nobody checked", [], [E.trust("skip", -5)], "Someone checked")],
          cause: "OKRs rounded up",
        },
      ],
      ignoreHint: "Skip Trust ↓",
      ignoreEffects: [E.trust("skip", -4)],
      ignoreCause: "Your OKRs were graded for you",
    }),
  },
  {
    id: "self_review",
    cat: "POLITICS",
    canBeRequired: true,
    oncePer: "quarter",
    weight: (s) => (s.week >= 11 ? 4 : 0),
    setup: (ctx) => ctx,
    build: ({ skip }) => ({
      from: skip.name,
      fromRole: "Skip-level · your review",
      title: "Your self-review is due",
      body: `Before Friday’s conversation, ${skip.name.split(" ")[0]} wants your own view of the quarter: what shipped, what didn’t, and what you’d do differently. Two pages, max.`,
      intents: [
        {
          id: "evidence",
          label: "Write it with evidence: launches, numbers, people",
          cost: 2,
          hints: "Skip Trust ↑ · Packet evidence · Stress ↑",
          effects: [E.trust("skip", 4), E.meter("packet", 1), E.meter("stress", 3)],
          cause: "Self-review written with evidence",
        },
        {
          id: "team",
          label: "Ask the team for their highlights",
          cost: 1,
          hints: "Skip Trust ↑ · Team Energy ↓",
          effects: [E.trust("skip", 2), E.team("energy", -1)],
          cause: "Self-review built from the team’s highlights",
        },
        {
          id: "short",
          label: "One honest paragraph",
          cost: 0,
          hints: "Time saved · Trust risk",
          effects: [E.meter("stress", -1), E.chance(0.5, "Short and sharp", [], [E.trust("skip", -3)], "Too short to land")],
          cause: "A one-paragraph self-review",
        },
      ],
      ignoreHint: "Skip Trust ↓",
      ignoreEffects: [E.trust("skip", -4)],
      ignoreCause: "No self-review on file",
    }),
  },
  {
    id: "demo_day",
    cat: "PEOPLE",
    canBeRequired: false,
    oncePer: "quarter",
    // Strongest the week after a launch, while it's still news.
    weight: (s) => ((s.lastWeek?.projects ?? []).some((p) => p.status === "shipped" || p.status === "late-shipped") ? 4 : s.projects.some(shipped) ? 1 : 0),
    setup: (ctx) => {
      const latest = (ctx.s.lastWeek?.projects ?? []).find((p) => p.status === "shipped" || p.status === "late-shipped");
      const p = ctx.s.projects.find((x) => x.id === latest?.id) ?? [...ctx.s.projects].reverse().find(shipped);
      const e = by(ctx.s.engineers, (x) => x.attrs.ambition)[0];
      return p && e ? { ...ctx, project: p, subject: e } : null;
    },
    build: ({ project: p, subject: e }) => ({
      from: e!.name,
      fromRole: levelTitle(e!),
      title: "Can we demo it at all-hands?",
      body: `${p!.name} shipped, and ${first(e!)} wants five minutes at all-hands to show it off. The agenda already runs forty minutes over.`,
      intents: [
        {
          id: "slot",
          label: "Get them the slot",
          cost: 1,
          hints: "Morale ↑ · Reputation ↑ · Political Capital ↓",
          effects: [E.attr(e!.id, "morale", 2), E.meter("reputation", 2), E.meter("capital", -2)],
          cause: "A demo at all-hands",
        },
        {
          id: "video",
          label: "Record a demo video instead",
          cost: 1,
          hints: "Reputation ↑ · Morale ↓",
          effects: [E.meter("reputation", 1), E.attr(e!.id, "morale", -1)],
          cause: "A demo video, recorded",
        },
        {
          id: "no",
          label: "Not this time",
          cost: 0,
          hints: "Time saved · Morale ↓",
          effects: [E.attr(e!.id, "morale", -2)],
          cause: "No demo this time",
        },
      ],
      ignoreHint: "Morale ↓",
      ignoreEffects: [E.attr(e!.id, "morale", -1)],
      ignoreCause: "The demo request was left on read",
    }),
  },
];

/** Linear expected progress for a project at the start of `week`. */
export function expectedProgress(p: Project, week: number): number {
  const span = Math.max(1, p.dueWeek - p.startWeek + 1);
  const done = Math.min(span, Math.max(0, week - p.startWeek));
  return Math.round((p.scope * done) / span);
}

/** Follow-up for a promise that comes due this week. Keeping it applies what was promised. */
export function promiseFollowUp(f: Fact, e: Engineer | undefined, week: number): EventBody {
  const name = e ? first(e) : "They";
  return {
    from: e?.name ?? "Your own promise",
    fromRole: `Promise from week ${f.createdWeek}`,
    title: `“You said week ${week}. It’s week ${week}.”`,
    body: `${f.text} ${name} has the calendar invite open and is waiting to hear what happens next.`,
    intents: [
      {
        id: "deliver",
        label: "Keep the promise",
        cost: 2,
        hints: `Morale ↑ · Loyalty ↑ · Promise kept${f.payloadHint ? ` · ${f.payloadHint}` : ""}`,
        effects: [
          ...(e ? [E.attr(e.id, "morale", 3), E.loyalty(e.id, 3)] : []),
          ...(f.payload ?? []),
          { k: "keep", factId: f.id },
        ],
        cause: "Promise kept",
      },
      {
        id: "renege",
        label: "Explain why it has to wait",
        cost: 1,
        hints: "Morale ↓ · Loyalty ↓ · Promise broken",
        effects: [...(e ? [E.attr(e.id, "morale", -3), E.loyalty(e.id, -2)] : []), { k: "break", factId: f.id }],
        cause: "Promise postponed, honestly",
      },
    ],
    ignoreHint: "Promise broken · Morale ↓↓ · Loyalty ↓↓",
    ignoreEffects: [...(e ? [E.attr(e.id, "morale", -5), E.loyalty(e.id, -4)] : []), { k: "break", factId: f.id }],
    ignoreCause: "Promise quietly broken",
  };
}

/** Stripe: last week's incident needs a review. The resolver applies the Trust outcome by intent. */
export function postmortemFollowUp(oncall?: Engineer): EventBody {
  return {
    from: "Reliability desk",
    fromRole: "Incident review",
    title: "The rollback needs a postmortem",
    body: "“What failed, what changed, and who owns the follow-up?” At this company, incidents cost double Trust. A review this week wins some of it back.",
    intents: [
      {
        id: "write",
        label: "Write the postmortem yourself",
        cost: 1,
        hints: "Half the Trust back · Incident cost protected",
        effects: [],
        cause: "Postmortem written",
      },
      ...(oncall
        ? [
            {
              id: "delegate",
              label: `Have ${first(oncall)} write it`,
              cost: 0,
              hints: `${first(oncall)} Energy ↓ · Depends on Communication`,
              effects: [],
              cause: `${first(oncall)} wrote the postmortem`,
            },
          ]
        : []),
      {
        id: "present",
        label: "Write it and present it at the incident review",
        cost: 2,
        hints: "All the Trust back · Skip Trust ↑",
        effects: [],
        cause: "Postmortem presented",
      },
    ],
    ignoreHint: "Incident cost ↑",
    ignoreEffects: [],
    ignoreCause: "Postmortem skipped",
  };
}

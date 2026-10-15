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
  weight: (s: GameState) => number;
  setup: (ctx: EventCtx, rng: Rng) => EventCtx | null;
  build: (ctx: EventCtx) => EventBody;
}

const first = (e: Engineer) => e.name.split(" ")[0];
const active = (s: GameState) => s.projects.filter((p) => p.status === "active");
const levelTitle = (e: Engineer) => `${e.level >= 5 ? "Senior Engineer" : "Engineer"} · L${e.level}`;
const by = <T,>(arr: T[], f: (x: T) => number) => [...arr].sort((a, b) => f(b) - f(a));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Hidden-Loyalty-driven odds. The number never appears in hint text. */
const loyaltyOdds = (e: Engineer, base: number) => clamp(base + e.loyalty / 25, 0.15, 0.92);
const seenThisQuarter = (s: GameState, id: string) => (s.quarterEvents ?? []).includes(id);
const projectOf = (s: GameState, e: Engineer) => s.projects.find((p) => p.id === e.projectId && p.status === "active");

const E = {
  attr: (who: string, attr: "coding" | "debugging" | "communication" | "ambition" | "morale" | "energy", d: number): Effect => ({ k: "attr", who, attr, d }),
  loyalty: (who: string, d: number): Effect => ({ k: "loyalty", who, d }),
  trust: (role: "skip" | "pm" | "peer", d: number): Effect => ({ k: "trust", role, d }),
  meter: (m: "techDebt" | "oncallLoad" | "stress" | "capital" | "reputation" | "packet", d: number): Effect => ({ k: "meter", m, d }),
  progress: (project: string, d: number): Effect => ({ k: "progress", project, d }),
  scope: (project: string, d: number): Effect => ({ k: "scope", project, d }),
  team: (attr: "morale" | "energy", d: number): Effect => ({ k: "teamAttr", attr, d }),
  leave: (who: string): Effect => ({ k: "leave", who }),
  chance: (p: number, note: string, then: Effect[], els: Effect[] = []): Effect => ({ k: "chance", p, note, then, else: els }),
};

export const EVENT_TYPES: EventType[] = [
  /* ---------------------------------- PEOPLE ---------------------------------- */
  {
    id: "promo_request",
    cat: "PEOPLE",
    canBeRequired: true,
    weight: (s) => (s.engineers.some((e) => e.attrs.ambition >= 13 && e.level >= 4) ? 3 : 0),
    setup: (ctx, rng) => {
      const pool = ctx.s.engineers.filter((e) => e.attrs.ambition >= 13 && e.level >= 4);
      if (!pool.length) return null;
      return { ...ctx, subject: rng.pick(by(pool, (e) => e.attrs.ambition).slice(0, 2)) };
    },
    build: ({ subject: e, s }) => {
      const p = projectOf(s, e!) ?? active(s)[0];
      return {
        from: e!.name,
        fromRole: levelTitle(e!),
        title: "“Got a sec?”",
        body: `${first(e!)}’s calendar shows a 45-minute “dentist appointment” for the third time this month. ${first(e!)} asks whether the promo packet is still happening this cycle.`,
        intents: [
          {
            id: "commit",
            label: "Commit to the promo, in writing",
            cost: 1,
            hints: `Morale ↑ · Promise due wk ${Math.min(12, s.week + 6)}`,
            effects: [
              E.attr(e!.id, "morale", 3),
              {
                k: "promise",
                who: e!.id,
                text: `${first(e!)}: promotion packet this cycle.`,
                dueIn: 6,
                payload: [E.meter("capital", -6), E.meter("packet", 1)],
                payloadHint: "Political Capital ↓",
              },
            ],
            cause: "Written promotion commitment",
          },
          {
            id: "honest",
            label: "Be honest: it won’t make this calibration",
            cost: 1,
            hints: "Morale ↓ · Loyalty ↑ · Reveals a trait or Loyalty",
            effects: [E.attr(e!.id, "morale", -2), E.loyalty(e!.id, 2), { k: "scout", who: e!.id, d: 1 }],
            cause: "An honest conversation about calibration",
          },
          {
            id: "redirect",
            label: `Offer tech lead on ${p ? p.name : "the next project"}`,
            cost: 1,
            hints: "Ambition ✓ · Project risk",
            effects: [E.attr(e!.id, "morale", 2), ...(p ? [E.progress(p.id, -4)] : [])],
            cause: "Tech lead role instead of a promise",
          },
        ],
        ignoreHint: "Morale ↓ · Loyalty ↓",
        ignoreEffects: [E.attr(e!.id, "morale", -3), E.loyalty(e!.id, -2)],
        ignoreCause: "Promotion question left unanswered",
      };
    },
  },
  {
    id: "burnout",
    cat: "PEOPLE",
    canBeRequired: true,
    weight: (s) => (s.engineers.some((e) => e.attrs.energy <= 9) ? 4 : 1),
    setup: (ctx) => {
      const e = by(ctx.s.engineers, (x) => -x.attrs.energy)[0];
      return e ? { ...ctx, subject: e } : null;
    },
    build: ({ subject: e, s }) => {
      const p = projectOf(s, e!);
      const onCall = s.plan.oncallId === e!.id;
      return {
        from: e!.name,
        fromRole: levelTitle(e!),
        title: "The pager is still in my dreams",
        body: `“I’m fine” arrives at 02:14. ${first(e!)}’s Energy is ${e!.attrs.energy}/20${p ? ` and ${first(e!)} is still on ${p.name}` : ""}${onCall ? ", and on call this week" : ""}.`,
        intents: [
          {
            id: "checkin",
            label: "Book a proper check-in",
            cost: 1,
            hints: "Morale ↑ · Reveals a trait or Loyalty",
            effects: [E.attr(e!.id, "morale", 2), { k: "scout", who: e!.id, d: 1 }],
            cause: "A real check-in, not a status update",
          },
          {
            id: "offload",
            label: "Re-plan the critical path without them",
            cost: 1,
            hints: p ? `Energy ↑ · Progress ↓` : "Energy ↑",
            effects: [E.attr(e!.id, "energy", 4), ...(p ? [E.progress(p.id, -6)] : [])],
            cause: "Moved off the critical path",
          },
          {
            id: "pager",
            label: "Take them off the pager for a month",
            cost: 0,
            hints: "Energy ↑ · On-call Load ↑",
            effects: [E.attr(e!.id, "energy", 2), E.meter("oncallLoad", 6)],
            cause: "Off the pager for a month",
          },
          {
            id: "runbook",
            label: "Pair on the runbook together",
            cost: 2,
            hints: "On-call Load ↓ · Debugging ↑",
            effects: [E.meter("oncallLoad", -8), E.attr(e!.id, "debugging", 1), E.attr(e!.id, "energy", 1)],
            cause: "Runbook pairing session",
          },
        ],
        ignoreHint: "Energy ↓ · Burnout risk",
        ignoreEffects: [E.attr(e!.id, "energy", -2), E.attr(e!.id, "morale", -1)],
        ignoreCause: "Burnout signs went unanswered",
      };
    },
  },
  {
    id: "poaching",
    cat: "PEOPLE",
    canBeRequired: true,
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
          hints: "Chance they stay · Reveals a trait or Loyalty",
          effects: [
            { k: "scout", who: e!.id, d: 1 },
            E.chance(loyaltyOdds(e!, 0.2), "The growth plan landed", [E.loyalty(e!.id, 2)], [E.attr(e!.id, "morale", -2)]),
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
      ignoreHint: "Loyalty ↓ · Leave risk",
      ignoreEffects: [E.loyalty(e!.id, -3), E.chance(0.35, "They took the offer", [E.leave(e!.id)])],
      ignoreCause: "Recruiter conversation ignored",
    }),
  },
  {
    id: "conflict",
    cat: "PEOPLE",
    canBeRequired: false,
    weight: (s) => (s.engineers.length >= 4 ? 2 : 0),
    setup: (ctx, rng) => {
      const [a, b] = rng.shuffle(ctx.s.engineers);
      return a && b ? { ...ctx, subject: a, other: b } : null;
    },
    build: ({ subject: a, other: b }) => ({
      from: a!.name,
      fromRole: levelTitle(a!),
      title: `A 40-comment PR thread with ${first(b!)}`,
      body: `It started as a naming nit. It is now about values. ${first(a!)} and ${first(b!)} have stopped reacting to each other’s Slack messages.`,
      intents: [
        {
          id: "mediate",
          label: "Get them in a room together",
          cost: 2,
          hints: "Morale ↑↑ · Loyalty ↑ · Reveals a trait or Loyalty",
          effects: [
            E.attr(a!.id, "morale", 2),
            E.attr(b!.id, "morale", 2),
            E.loyalty(a!.id, 1),
            E.loyalty(b!.id, 1),
            { k: "scout", who: a!.id, d: 1 },
          ],
          cause: "Mediated the PR standoff",
        },
        {
          id: "lint",
          label: "Adopt a style guide, not a verdict",
          cost: 1,
          hints: "Morale ↑ · Tech Debt ↓",
          effects: [E.attr(a!.id, "morale", 1), E.attr(b!.id, "morale", 1), E.meter("techDebt", -1)],
          cause: "A lint rule ended the debate",
        },
        {
          id: "rule",
          label: "Make the call yourself",
          cost: 0,
          hints: `${first(a!)} Morale ↑ · ${first(b!)} Morale ↓`,
          effects: [E.attr(a!.id, "morale", 1), E.attr(b!.id, "morale", -2)],
          cause: "Manager decided the naming debate",
        },
      ],
      ignoreHint: "Morale ↓ for both",
      ignoreEffects: [E.attr(a!.id, "morale", -2), E.attr(b!.id, "morale", -2)],
      ignoreCause: "PR feud left to simmer",
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
    weight: (s) => (s.engineers.some((e) => e.attrs.coding <= 11) ? 2 : 0),
    setup: (ctx) => {
      const e = by(ctx.s.engineers, (x) => -x.attrs.coding)[0];
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
    id: "notice_backfill",
    cat: "PEOPLE",
    canBeRequired: true,
    // Only when someone is genuinely unhappy: low Loyalty and low Morale.
    weight: (s) =>
      s.engineers.length >= 4 && s.week >= 3 && !seenThisQuarter(s, "notice_backfill") && s.engineers.some((e) => e.loyalty <= 9 && e.attrs.morale <= 10) ? 1 : 0,
    setup: (ctx) => {
      const e = by(
        ctx.s.engineers.filter((x) => x.loyalty <= 9 && x.attrs.morale <= 10),
        (x) => -x.loyalty,
      )[0];
      return e ? { ...ctx, subject: e } : null;
    },
    build: ({ subject: e }) => ({
      from: e!.name,
      fromRole: levelTitle(e!),
      title: "Two weeks’ notice",
      body: `${first(e!)} gives notice. Finance replies to your backfill request with a calendar invite titled “Headcount philosophy”.`,
      intents: [
        {
          id: "counter",
          label: "Counter-offer",
          cost: 2,
          hints: "Political Capital ↓↓ · Chance they stay",
          effects: [E.meter("capital", -8), E.chance(loyaltyOdds(e!, 0), "They stayed, for now", [E.loyalty(e!.id, 3)], [E.leave(e!.id)])],
          cause: "Counter-offer made",
        },
        {
          id: "backfill",
          label: "Accept it, fight for the backfill",
          cost: 1,
          hints: "Political Capital ↓ · Hiring chance",
          effects: [E.leave(e!.id), E.meter("capital", -4), E.chance(0.5, "Backfill approved", [{ k: "hire" }])],
          cause: "Accepted the notice, fought for the seat",
        },
        {
          id: "handover",
          label: "Accept it, two weeks of handover docs",
          cost: 1,
          hints: "Tech Debt ↑ · Morale ↑",
          effects: [E.attr(e!.id, "morale", 2), E.leave(e!.id), E.meter("techDebt", 2)],
          cause: "A proper handover",
        },
      ],
      ignoreHint: "Tech Debt ↑↑ · Team Morale ↓",
      ignoreEffects: [E.leave(e!.id), E.meter("techDebt", 8), E.team("morale", -1)],
      ignoreCause: "Tribal knowledge walked out the door",
    }),
  },
  {
    id: "rto_badge",
    cat: "PEOPLE",
    canBeRequired: false,
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
    weight: (s) => (active(s).length ? 3 : 0),
    setup: (ctx, rng) => {
      const ps = active(ctx.s);
      if (!ps.length) return null;
      const helper = by(ctx.s.engineers, (e) => e.attrs.communication)[0];
      return { ...ctx, project: rng.pick(ps), subject: helper };
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
                  E.chance(Math.min(0.9, h.attrs.communication / 20), "Negotiation landed", [E.trust("pm", 2)], [E.scope(p!.id, 10)]),
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
      const fix: Effect[] = [E.meter("techDebt", -12), ...(p ? [E.progress(p.id, -6)] : [])];
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
    weight: (s) => (s.week < 3 ? 0 : active(s).some((p) => p.progress < expectedProgress(p, s.week)) ? 4 : 1),
    setup: (ctx) => {
      const ps = active(ctx.s);
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
        body: `${p!.name} is at ${Math.round((p!.progress / p!.scope) * 100)}% with ${Math.max(0, p!.dueWeek - s.week)} weeks left. Someone says “we just need to push a bit.”`,
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
    weight: (s) => (active(s).length ? 2 : 0),
    setup: (ctx, rng) => {
      const ps = active(ctx.s);
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
          effects: [E.trust("peer", -5), E.chance(0.6, "They delivered", [], [E.progress(p!.id, -4)])],
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
    weight: (s) => (s.engineers.some((e) => e.attrs.ambition >= 12 && e.attrs.debugging <= 11) && s.engineers.length >= 3 ? 2 : 0),
    setup: (ctx) => {
      const a = by(
        ctx.s.engineers.filter((e) => e.attrs.ambition >= 12 && e.attrs.debugging <= 11),
        (e) => e.attrs.ambition,
      )[0];
      const o = by(
        ctx.s.engineers.filter((e) => e !== a),
        (e) => e.attrs.debugging,
      )[0];
      if (!a || !o) return null;
      return { ...ctx, subject: a, other: o, project: projectOf(ctx.s, a) ?? active(ctx.s)[0] };
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
          effects: [E.attr(a!.id, "morale", -2), E.attr(o!.id, "morale", 1), E.meter("techDebt", -3)],
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
    weight: (s) =>
      s.company === "Vercel" && s.week < 8 && s.projects.some((p) => p.flagship && p.status === "active") && !seenThisQuarter(s, "keynote_oneup") ? 3 : 0,
    setup: (ctx) => {
      const p = ctx.s.projects.find((x) => x.flagship && x.status === "active");
      const e = by(ctx.s.engineers, (x) => x.attrs.communication)[0];
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
      ignoreCause: "The CEO scoped the response himself",
    }),
  },
  {
    id: "postmortem_name",
    cat: "DELIVERY",
    canBeRequired: false,
    weight: (s) => (s.company === "Stripe" && s.stats.incidents > 0 && !!s.plan.oncallId && !seenThisQuarter(s, "postmortem_name") ? 2 : 0),
    setup: (ctx) => {
      const e = ctx.s.engineers.find((x) => x.id === ctx.s.plan.oncallId);
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
  {
    id: "v2_rewrite",
    cat: "DELIVERY",
    canBeRequired: false,
    weight: (s) =>
      s.week <= 8 && s.engineers.some((e) => e.attrs.ambition >= 13) && !seenThisQuarter(s, "v2_rewrite") ? 1.5 * (s.company === "Google" ? 1.6 : 1) : 0,
    setup: (ctx) => {
      const e = by(
        ctx.s.engineers.filter((x) => x.attrs.ambition >= 13),
        (x) => x.attrs.ambition,
      )[0];
      return e ? { ...ctx, subject: e, project: projectOf(ctx.s, e) ?? active(ctx.s)[0] } : null;
    },
    build: ({ subject: e, project: p, s }) => ({
      from: e!.name,
      fromRole: levelTitle(e!),
      title: "A 14-page doc called “Service v2”",
      body: `v1 works. Maintaining v1 does not fit in a promo packet. ${first(e!)} has already picked the new framework.`,
      intents: [
        {
          id: "approve",
          label: "Approve the rewrite",
          cost: 1,
          hints: `Morale ↑ · Packet evidence · Tech Debt ↑ · Promise due wk ${Math.min(12, s.week + 4)}`,
          effects: [
            E.attr(e!.id, "morale", 3),
            E.meter("packet", 2),
            E.meter("techDebt", 6),
            ...(p ? [E.progress(p.id, -6)] : []),
            {
              k: "promise",
              who: e!.id,
              text: `${first(e!)}: v2 cuts over and v1 is turned off.`,
              dueIn: 4,
              payload: [E.meter("techDebt", -10), E.meter("oncallLoad", 8)],
              payloadHint: "Tech Debt ↓↓ · On-call Load ↑",
            },
          ],
          cause: "Approved the rewrite",
        },
        {
          id: "migrate",
          label: "Make it a migration plan with a design review",
          cost: 2,
          hints: "Tech Debt ↓ · Packet evidence · Morale ↓",
          effects: [E.meter("techDebt", -4), E.meter("packet", 1), E.attr(e!.id, "morale", -1)],
          cause: "Rewrite became a migration plan",
        },
        {
          id: "no",
          label: "No. Maintenance is the job.",
          cost: 0,
          hints: "Morale ↓ · Loyalty risk",
          effects: [E.attr(e!.id, "morale", -3), E.chance(0.3, "They took it personally", [E.loyalty(e!.id, -3)])],
          cause: "Said no to v2",
        },
      ],
      ignoreHint: "Tech Debt ↑ · Energy ↓",
      ignoreEffects: [E.meter("techDebt", 4), E.attr(e!.id, "energy", -2)],
      ignoreCause: "They built v2 in their 20% time anyway",
    }),
  },

  /* --------------------------------- POLITICS --------------------------------- */
  {
    id: "quick_deck",
    cat: "POLITICS",
    canBeRequired: true,
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
          hints: "Time saved · Trust risk",
          effects: [E.chance(0.5, "Good enough", [], [E.trust("skip", -4)])],
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
      ignoreHint: "May fade away · Trust risk",
      ignoreEffects: [E.chance(0.7, "Quietly forgotten", [], [E.trust("skip", -4)])],
      ignoreCause: "CEO ask left unanswered",
    }),
  },
  {
    id: "peer_credit",
    cat: "POLITICS",
    canBeRequired: false,
    weight: (s) => 2 * (s.company === "Google" ? 1.4 : 1),
    setup: (ctx) => ctx,
    build: ({ peer }) => ({
      from: peer.name,
      fromRole: "Peer EM",
      title: "“Great collab, team!”",
      body: `${peer.name.split(" ")[0]}’s all-hands slide shows your team’s launch under their team’s name. Several people reacted with the rocket emoji.`,
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
    id: "reorg_rumor",
    cat: "POLITICS",
    canBeRequired: false,
    weight: (s) => (s.week >= 3 ? 2 : 0),
    setup: (ctx) => ctx,
    build: ({ skip }) => ({
      from: "#random",
      fromRole: "Slack, 34 replies",
      title: "Is there a reorg?",
      body: "Someone saw a calendar invite titled “Org design (confidential)”. The team is now doing org design of its own, in threads.",
      intents: [
        {
          id: "reassure",
          label: "Tell the team at standup there’s nothing to it",
          cost: 1,
          hints: "Team Morale ↑ · Reputation risk",
          effects: [E.chance(0.7, "It really was nothing", [E.team("morale", 1)], [E.team("morale", -2), E.meter("reputation", -1)])],
          cause: "Reorg rumor addressed at standup",
        },
        {
          id: "ask",
          label: `Ask ${skip.name.split(" ")[0]} directly`,
          cost: 1,
          hints: "Skip Trust ↑ · Political Capital ↓",
          effects: [E.trust("skip", 2), E.meter("capital", -2)],
          cause: "Asked the skip-level directly",
        },
      ],
      ignoreHint: "Team Morale ↓",
      ignoreEffects: [E.team("morale", -1)],
      ignoreCause: "Reorg rumor left to the threads",
    }),
  },
  {
    id: "layoff_list",
    cat: "POLITICS",
    canBeRequired: true,
    weight: (s) =>
      s.week >= 4 && s.week <= 10 && s.engineers.length >= 4 && !seenThisQuarter(s, "layoff_list") ? 0.5 * (s.company === "Google" ? 1.5 : 1) : 0,
    setup: (ctx) => {
      const low = by(ctx.s.engineers, (e) => -e.attrs.coding)[0];
      const pricey = by(
        ctx.s.engineers.filter((e) => e !== low),
        (e) => e.level,
      )[0];
      return low && pricey ? { ...ctx, subject: low, other: pricey } : null;
    },
    build: ({ subject: low, other: pricey, skip }) => ({
      from: skip.name,
      fromRole: "Skip-level · confidential",
      title: "The spreadsheet has a column called “Impact if removed”",
      body: "You need to stack-rank your team and draw a line by Friday. It is “not a layoff list”.",
      intents: [
        {
          id: "rank",
          label: "Rank honestly and draw the line",
          cost: 2,
          hints: `Skip Trust ↑ · ${first(low!)} leaves · Team Morale ↓`,
          effects: [E.leave(low!.id), E.trust("skip", 4), E.team("morale", -1)],
          cause: "Drew the line on the spreadsheet",
        },
        {
          id: "fight",
          label: "Fight for zero cuts",
          cost: 2,
          hints: "Political Capital ↓↓ · Coin flip",
          effects: [E.meter("capital", -10), E.chance(0.45, "Zero cuts held", [], [E.leave(low!.id), E.trust("skip", -4)])],
          cause: "Fought for zero cuts",
        },
        {
          id: "warn",
          label: "Warn the team first",
          cost: 1,
          hints: `Team Morale ↑ · Skip Trust ↓↓ · ${first(low!)} leaves`,
          effects: [E.leave(low!.id), E.team("morale", 1), E.trust("skip", -8)],
          cause: "Warned the team before the list",
        },
      ],
      ignoreHint: `Skip Trust ↓ · ${first(pricey!)} leaves`,
      ignoreEffects: [E.leave(pricey!.id), E.trust("skip", -6)],
      ignoreCause: "Finance drew the line for you",
    }),
  },
  {
    id: "calibration_trade",
    cat: "POLITICS",
    canBeRequired: false,
    weight: (s) => (s.week >= 9 && s.engineers.length >= 2 && !seenThisQuarter(s, "calibration_trade") ? 1.5 * (s.company === "Google" ? 1.8 : 1) : 0),
    setup: (ctx) => {
      const [a, b] = by(ctx.s.engineers, (e) => e.attrs.coding);
      return a && b ? { ...ctx, subject: a, other: b } : null;
    },
    build: ({ subject: a, other: b, peer }) => ({
      from: "Calibration",
      fromRole: "Room 4B, no laptops",
      title: "One Exceeds, two people who earned it",
      body: `${first(a!)} and ${first(b!)} both had a great half. ${peer.name.split(" ")[0]}’s report also “had a great half”, according to ${peer.name.split(" ")[0]}.`,
      intents: [
        {
          id: "allin",
          label: `Go all-in for ${first(a!)}`,
          cost: 1,
          hints: `${first(a!)} Morale ↑ · ${first(b!)} Morale ↓`,
          effects: [E.attr(a!.id, "morale", 3), E.loyalty(a!.id, 2), E.attr(b!.id, "morale", -3)],
          cause: `Went all-in for ${first(a!)}`,
        },
        {
          id: "both",
          label: "Fight for both",
          cost: 2,
          hints: "Political Capital ↓ · Peer Trust ↓ · Coin flip",
          effects: [
            E.meter("capital", -8),
            E.trust("peer", -3),
            E.chance(0.4, "Both got it", [E.attr(a!.id, "morale", 2), E.attr(b!.id, "morale", 2)], [E.attr(a!.id, "morale", -1), E.attr(b!.id, "morale", -1)]),
          ],
          cause: "Fought for both in calibration",
        },
        {
          id: "trade",
          label: "Trade the slot for a favor",
          cost: 1,
          hints: "Peer Trust ↑ · Political Capital ↑ · Morale ↓",
          effects: [E.trust("peer", 6), E.meter("capital", 4), E.attr(a!.id, "morale", -2), E.attr(b!.id, "morale", -2)],
          cause: "Traded the Exceeds for a favor",
        },
      ],
      ignoreHint: "Morale ↓ for both",
      ignoreEffects: [E.attr(a!.id, "morale", -2), E.attr(b!.id, "morale", -2), E.meter("packet", -1)],
      ignoreCause: "Calibrated by people who’ve never met them",
    }),
  },
  {
    id: "ai_mandate",
    cat: "POLITICS",
    canBeRequired: true,
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
          effects: [E.meter("capital", -2), E.chance(0.6, "It went well", [E.trust("skip", 3), E.team("morale", 1)], [E.trust("skip", -2)])],
          cause: "Brought the skip-level to team meeting",
        },
      ],
      ignoreHint: "Skip Trust ↓ · Stress ↑",
      ignoreEffects: [E.trust("skip", -4), E.meter("stress", 2)],
      ignoreCause: "The feedback stayed in the air",
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

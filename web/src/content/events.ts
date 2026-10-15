// Hand-written event types. Each defines the mechanics (intents, costs, effects,
// ignored outcome) and template text. The LLM may reword text; it never changes effects.

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

export const EVENT_TYPES: EventType[] = [
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
      const p = s.projects.find((x) => x.id === e!.projectId) ?? active(s)[0];
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
              { k: "attr", who: e!.id, attr: "morale", d: 3 },
              { k: "promise", who: e!.id, text: `${first(e!)}: promotion packet this cycle.`, dueIn: 6 },
            ],
            cause: "Written promotion commitment",
          },
          {
            id: "honest",
            label: "Be honest: budget is frozen until next quarter",
            cost: 2,
            hints: "Morale ↓ · Loyalty ↑",
            effects: [
              { k: "attr", who: e!.id, attr: "morale", d: -2 },
              { k: "loyalty", who: e!.id, d: 2 },
            ],
            cause: "An honest conversation about the freeze",
          },
          {
            id: "redirect",
            label: `Offer tech lead on ${p ? p.name : "the next project"}`,
            cost: 1,
            hints: "Ambition ✓ · Project risk",
            effects: [
              { k: "attr", who: e!.id, attr: "morale", d: 2 },
              ...(p ? [{ k: "progress", project: p.id, d: -4 } as Effect] : []),
            ],
            cause: "Tech lead role instead of a promise",
          },
        ],
        ignoreHint: "Morale ↓ · may start interviewing",
        ignoreEffects: [
          { k: "attr", who: e!.id, attr: "morale", d: -3 },
          { k: "loyalty", who: e!.id, d: -2 },
        ],
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
      const p = s.projects.find((x) => x.id === e!.projectId);
      return {
        from: e!.name,
        fromRole: levelTitle(e!),
        title: "The pager is still in my dreams",
        body: `“I’m fine” arrives at 02:14. ${first(e!)}’s Energy is ${e!.attrs.energy}/20${p ? ` and ${first(e!)} is still on ${p.name}` : ""}.`,
        intents: [
          {
            id: "checkin",
            label: "Book a proper check-in",
            cost: 1,
            hints: "Energy ↑ · Morale ↑",
            effects: [
              { k: "attr", who: e!.id, attr: "energy", d: 3 },
              { k: "attr", who: e!.id, attr: "morale", d: 1 },
              { k: "scout", who: e!.id, d: 1 },
            ],
            cause: "A real check-in, not a status update",
          },
          {
            id: "offload",
            label: "Take them off the critical path",
            cost: 0,
            hints: p ? `Energy ↑ · ${p.name} progress ↓` : "Energy ↑",
            effects: [
              { k: "attr", who: e!.id, attr: "energy", d: 4 },
              ...(p ? [{ k: "progress", project: p.id, d: -6 } as Effect] : []),
            ],
            cause: "Moved off the critical path",
          },
          {
            id: "runbook",
            label: "Pair on the runbook together",
            cost: 2,
            hints: "On-call Load ↓ · Debugging ↑",
            effects: [
              { k: "meter", m: "oncallLoad", d: -8 },
              { k: "attr", who: e!.id, attr: "debugging", d: 1 },
              { k: "attr", who: e!.id, attr: "energy", d: 1 },
            ],
            cause: "Runbook pairing session",
          },
        ],
        ignoreHint: "Energy ↓ · Burnout risk",
        ignoreEffects: [
          { k: "attr", who: e!.id, attr: "energy", d: -2 },
          { k: "attr", who: e!.id, attr: "morale", d: -1 },
        ],
        ignoreCause: "Burnout signs went unanswered",
      };
    },
  },
  {
    id: "poaching",
    cat: "PEOPLE",
    canBeRequired: true,
    weight: () => 2,
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
          hints: "Loyalty ↑ · Political Capital ↓",
          effects: [
            { k: "loyalty", who: e!.id, d: 4 },
            { k: "attr", who: e!.id, attr: "morale", d: 2 },
            { k: "meter", m: "capital", d: -6 },
          ],
          cause: "Retention bonus approved",
        },
        {
          id: "growth",
          label: "Talk about growth, not money",
          cost: 1,
          hints: "Chance to keep them · depends on Loyalty",
          effects: [
            {
              k: "chance",
              p: 0.6,
              note: "Loyalty decides",
              then: [{ k: "loyalty", who: e!.id, d: 2 }],
              else: [{ k: "attr", who: e!.id, attr: "morale", d: -2 }],
            },
            { k: "scout", who: e!.id, d: 1 },
          ],
          cause: "A growth conversation",
        },
        {
          id: "wish",
          label: "Wish them well, mean it",
          cost: 0,
          hints: "Morale ↑ · Real risk they leave",
          effects: [
            { k: "attr", who: e!.id, attr: "morale", d: 1 },
            { k: "chance", p: 0.4, note: "They took the offer", then: [{ k: "leave", who: e!.id }] },
          ],
          cause: "Gracious, but no counter-offer",
        },
      ],
      ignoreHint: "Loyalty ↓ · They may leave",
      ignoreEffects: [
        { k: "loyalty", who: e!.id, d: -3 },
        { k: "chance", p: 0.3, note: "They took the offer", then: [{ k: "leave", who: e!.id }] },
      ],
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
          hints: "Morale ↑ for both",
          effects: [
            { k: "attr", who: a!.id, attr: "morale", d: 1 },
            { k: "attr", who: b!.id, attr: "morale", d: 1 },
            { k: "scout", who: a!.id, d: 1 },
          ],
          cause: "Mediated the PR standoff",
        },
        {
          id: "rule",
          label: "Make the call yourself",
          cost: 1,
          hints: `${first(a!)} Morale ↑ · ${first(b!)} Morale ↓`,
          effects: [
            { k: "attr", who: a!.id, attr: "morale", d: 1 },
            { k: "attr", who: b!.id, attr: "morale", d: -2 },
          ],
          cause: "Manager decided the naming debate",
        },
      ],
      ignoreHint: "Morale ↓ for both",
      ignoreEffects: [
        { k: "attr", who: a!.id, attr: "morale", d: -2 },
        { k: "attr", who: b!.id, attr: "morale", d: -2 },
      ],
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
      title: "A great candidate. One more loop.",
      body: "You are short a person. The candidate can only interview on Thursday, which is also when every other thing is happening.",
      intents: [
        {
          id: "join",
          label: "Join the final interview yourself",
          cost: 1,
          hints: "Strong hiring chance",
          effects: [{ k: "chance", p: 0.75, note: "Offer accepted", then: [{ k: "hire" }] }],
          cause: "You closed the candidate",
        },
        ...(h
          ? [
              {
                id: "delegate",
                label: `Delegate to ${first(h)}`,
                cost: 0,
                hints: `Hiring chance · ${first(h)} Energy ↓`,
                effects: [
                  { k: "attr", who: h.id, attr: "energy", d: -2 },
                  { k: "chance", p: 0.45, note: "Offer accepted", then: [{ k: "hire" }] },
                ] as Effect[],
                cause: `${first(h)} ran the final loop`,
              },
            ]
          : []),
      ],
      ignoreHint: "Candidate moves on",
      ignoreEffects: [],
      ignoreCause: "Candidate took another offer",
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
    build: ({ subject: e }) => ({
      from: "Your own notes",
      fromRole: "1:1 doc, private",
      title: `${first(e!)}’s tickets keep rolling over`,
      body: `Three sprints in a row, the same two tickets. ${first(e!)} says they are “basically done”. The rest of the team has noticed.`,
      intents: [
        {
          id: "coach",
          label: "Set up weekly coaching",
          cost: 2,
          hints: "Coding ↑ · Morale ↑",
          effects: [
            { k: "attr", who: e!.id, attr: "coding", d: 1 },
            { k: "attr", who: e!.id, attr: "morale", d: 1 },
          ],
          cause: "Weekly coaching started",
        },
        {
          id: "expectations",
          label: "Write down clear expectations",
          cost: 1,
          hints: "Coding ↑ · Morale ↓",
          effects: [
            { k: "attr", who: e!.id, attr: "coding", d: 1 },
            { k: "attr", who: e!.id, attr: "morale", d: -2 },
          ],
          cause: "Expectations put in writing",
        },
      ],
      ignoreHint: "Team Morale ↓",
      ignoreEffects: [{ k: "teamAttr", attr: "morale", d: -1 }],
      ignoreCause: "Rolling tickets nobody addressed",
    }),
  },
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
          hints: "Deadline protected · PM Trust ↑",
          effects: [{ k: "trust", role: "pm", d: 3 }],
          cause: "Scope negotiated, deadline kept",
        },
        {
          id: "agree",
          label: "Agree to the dashboard",
          cost: 1,
          hints: "PM Trust ↑↑ · Scope ↑ · Delivery risk",
          effects: [
            { k: "trust", role: "pm", d: 6 },
            { k: "scope", project: p!.id, d: 15 },
          ],
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
                  { k: "attr", who: h.id, attr: "energy", d: -2 },
                  {
                    k: "chance",
                    p: Math.min(0.9, h.attrs.communication / 20),
                    note: "Negotiation landed",
                    then: [{ k: "trust", role: "pm", d: 2 }],
                    else: [{ k: "scope", project: p!.id, d: 10 }],
                  },
                ] as Effect[],
                cause: `${first(h)} negotiated with product`,
              },
            ]
          : []),
      ],
      ignoreHint: "Scope grows anyway · PM Trust ↓",
      ignoreEffects: [
        { k: "trust", role: "pm", d: -3 },
        { k: "scope", project: p!.id, d: 8 },
      ],
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
    build: ({ subject: e, project: p, s }) => ({
      from: e!.name,
      fromRole: levelTitle(e!),
      title: "Can we please fix the build?",
      body: `CI takes 41 minutes and fails one run in five. ${first(e!)} has a plan and a sprint-sized estimate. Tech Debt is ${s.techDebt}/100.`,
      intents: [
        {
          id: "approve",
          label: "Give it a sprint",
          cost: 1,
          hints: `Tech Debt ↓↓${p ? ` · ${p.name} progress ↓` : ""}`,
          effects: [
            { k: "meter", m: "techDebt", d: -12 },
            ...(p ? [{ k: "progress", project: p.id, d: -6 } as Effect] : []),
          ],
          cause: "Build fix sprint",
        },
        {
          id: "later",
          label: "Promise it next month",
          cost: 0,
          hints: `Promise due wk ${Math.min(12, s.week + 4)}`,
          effects: [{ k: "promise", who: e!.id, text: `${first(e!)}: the build fix gets its sprint.`, dueIn: 4 }],
          cause: "Build fix promised for later",
        },
      ],
      ignoreHint: "Tech Debt ↑",
      ignoreEffects: [{ k: "meter", m: "techDebt", d: 4 }],
      ignoreCause: "Flaky CI left alone",
    }),
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
            effects: [
              { k: "scope", project: p!.id, d: -12 },
              { k: "trust", role: "pm", d: -3 },
            ],
            cause: "Scope cut to protect the date",
          },
          {
            id: "crunch",
            label: "Ask the team to crunch",
            cost: 1,
            hints: "Progress ↑ · Energy ↓ for the team",
            effects: [
              { k: "progress", project: p!.id, d: 10 },
              ...team.map((e) => ({ k: "attr", who: e.id, attr: "energy", d: -3 }) as Effect),
            ],
            cause: "Crunch week",
          },
          // The Vercel keynote date cannot move, so a slip is not on offer for the flagship there.
          ...(p!.flagship && s.company === "Vercel" ? [] : [{
            id: "slip",
            label: "Tell the skip-level it will slip",
            cost: 2,
            hints: "Deadline +2 weeks · Skip Trust ↓",
            effects: [
              { k: "trust", role: "skip", d: -4 },
              { k: "deadline", project: p!.id, d: 2 },
            ],
            cause: "Slip communicated early",
          } as IntentSpec]),
        ],
        ignoreHint: "Nothing changes. That is the problem.",
        ignoreEffects: [],
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
          hints: "Progress protected · Peer Trust ↓",
          effects: [{ k: "trust", role: "peer", d: -5 }],
          cause: "Dependency escalated",
        },
        {
          id: "workaround",
          label: "Build a temporary workaround",
          cost: 2,
          hints: "Progress protected · Tech Debt ↑",
          effects: [{ k: "meter", m: "techDebt", d: 5 }],
          cause: "Temporary workaround shipped",
        },
        {
          id: "wait",
          label: "Wait it out, politely",
          cost: 0,
          hints: `${p!.name} progress ↓ · Peer Trust ↑`,
          effects: [
            { k: "progress", project: p!.id, d: -7 },
            { k: "trust", role: "peer", d: 3 },
          ],
          cause: "Waited on the dependency",
        },
      ],
      ignoreHint: "Progress ↓",
      ignoreEffects: [{ k: "progress", project: p!.id, d: -7 }],
      ignoreCause: "Blocked on another team",
    }),
  },
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
          effects: [
            { k: "trust", role: "skip", d: 6 },
            { k: "meter", m: "packet", d: 1 },
          ],
          cause: "QBR deck delivered",
        },
        {
          id: "reuse",
          label: "Send the existing weekly update",
          cost: 0,
          hints: "Time saved · Trust risk",
          effects: [
            { k: "chance", p: 0.5, note: "Good enough", then: [], else: [{ k: "trust", role: "skip", d: -4 }] },
          ],
          cause: "Weekly update sent instead",
        },
        {
          id: "pushback",
          label: "Push back on the timing",
          cost: 1,
          hints: "Stress ↓ · Political Capital ↓",
          effects: [
            { k: "meter", m: "stress", d: -4 },
            { k: "meter", m: "capital", d: -4 },
          ],
          cause: "Negotiated the deck deadline",
        },
      ],
      ignoreHint: "Skip Trust ↓",
      ignoreEffects: [{ k: "trust", role: "skip", d: -6 }],
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
      title: "What if it had an AI button?",
      body: "A forwarded screenshot, no context. “Can we get something like this in for the demo?” The screenshot is from a completely different industry.",
      intents: [
        {
          id: "doc",
          label: "Write a small exploration doc",
          cost: 2,
          hints: "Reputation ↑ · Delivery risk",
          effects: [
            { k: "meter", m: "reputation", d: 2 },
            ...(p ? [{ k: "progress", project: p.id, d: -3 } as Effect] : []),
          ],
          cause: "AI exploration doc",
        },
        {
          id: "triage",
          label: "Ask the PM to triage it",
          cost: 0,
          hints: "PM Trust ↓ · Time saved",
          effects: [{ k: "trust", role: "pm", d: -3 }],
          cause: "CEO ask passed to product",
        },
        {
          id: "prototype",
          label: "Build a throwaway prototype",
          cost: 3,
          hints: "Skip Trust ↑ · Reputation ↑ · Tech Debt ↑",
          effects: [
            { k: "trust", role: "skip", d: 5 },
            { k: "meter", m: "reputation", d: 2 },
            { k: "meter", m: "techDebt", d: 6 },
          ],
          cause: "Throwaway AI prototype",
        },
      ],
      ignoreHint: "May fade away · No guaranteed cost",
      ignoreEffects: [
        { k: "chance", p: 0.7, note: "Quietly forgotten", then: [], else: [{ k: "trust", role: "skip", d: -4 }] },
      ],
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
          hints: "Peer Trust ↓ · Skip Trust ↑",
          effects: [
            { k: "trust", role: "peer", d: -6 },
            { k: "trust", role: "skip", d: 2 },
          ],
          cause: "Credit corrected with the peer EM",
        },
        {
          id: "kudos",
          label: "Post public kudos to your team",
          cost: 1,
          hints: "Team Morale ↑ · Packet evidence",
          effects: [
            { k: "teamAttr", attr: "morale", d: 1 },
            { k: "meter", m: "packet", d: 1 },
          ],
          cause: "Public kudos for the team",
        },
        {
          id: "letgo",
          label: "Let it go",
          cost: 0,
          hints: "Reputation ↓ · Peer Trust ↑",
          effects: [
            { k: "meter", m: "reputation", d: -2 },
            { k: "trust", role: "peer", d: 3 },
          ],
          cause: "Let the credit slide",
        },
      ],
      ignoreHint: "Reputation ↓",
      ignoreEffects: [{ k: "meter", m: "reputation", d: -2 }],
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
          label: "Address it at standup",
          cost: 1,
          hints: "Team Morale ↑",
          effects: [{ k: "teamAttr", attr: "morale", d: 1 }],
          cause: "Reorg rumor addressed openly",
        },
        {
          id: "ask",
          label: `Ask ${skip.name.split(" ")[0]} directly`,
          cost: 1,
          hints: "Skip Trust ↑ · Political Capital ↑",
          effects: [
            { k: "trust", role: "skip", d: 2 },
            { k: "meter", m: "capital", d: 3 },
          ],
          cause: "Asked the skip-level directly",
        },
      ],
      ignoreHint: "Team Morale ↓",
      ignoreEffects: [{ k: "teamAttr", attr: "morale", d: -1 }],
      ignoreCause: "Reorg rumor left to the threads",
    }),
  },
];

/** Linear expected progress for a project at the start of `week`. */
export function expectedProgress(p: Project, week: number): number {
  const span = Math.max(1, p.dueWeek - p.startWeek + 1);
  const done = Math.min(span, Math.max(0, week - p.startWeek));
  return Math.round((p.scope * done) / span);
}

/** Follow-up for a promise that comes due this week. Ignoring breaks it. */
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
        hints: "Morale ↑ · Loyalty ↑ · Promise kept",
        effects: [
          ...(e
            ? [
                { k: "attr", who: e.id, attr: "morale", d: 3 } as Effect,
                { k: "loyalty", who: e.id, d: 3 } as Effect,
              ]
            : []),
          { k: "keep", factId: f.id },
        ],
        cause: "Promise kept",
      },
      {
        id: "renege",
        label: "Explain why it has to wait",
        cost: 1,
        hints: "Morale ↓ · Loyalty ↓ · Promise broken",
        effects: [
          ...(e
            ? [
                { k: "attr", who: e.id, attr: "morale", d: -3 } as Effect,
                { k: "loyalty", who: e.id, d: -2 } as Effect,
              ]
            : []),
          { k: "break", factId: f.id },
        ],
        cause: "Promise postponed, honestly",
      },
    ],
    ignoreHint: "Promise broken · Morale ↓↓ · Loyalty ↓↓",
    ignoreEffects: [
      ...(e
        ? [
            { k: "attr", who: e.id, attr: "morale", d: -5 } as Effect,
            { k: "loyalty", who: e.id, d: -4 } as Effect,
          ]
        : []),
      { k: "break", factId: f.id },
    ],
    ignoreCause: "Promise quietly broken",
  };
}

export function postmortemFollowUp(): EventBody {
  return {
    from: "Reliability desk",
    fromRole: "Incident review",
    title: "The rollback needs a postmortem",
    body: "“What failed, what changed, and who owns the follow-up?” At this company, incidents cost double Trust. A written review this week halves the hit.",
    intents: [
      {
        id: "write",
        label: "Write the postmortem",
        cost: 1,
        hints: "Half the Trust hit back · Follow-up risk ↓",
        effects: [],
        cause: "Postmortem written",
      },
    ],
    ignoreHint: "Next incident costs more",
    ignoreEffects: [],
    ignoreCause: "Postmortem skipped",
  };
}

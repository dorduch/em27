// Storylines: multi-week arcs about one person. Each beat is an inbox item; every choice
// (ignoring included) has an immediate effect on people, projects or meters, and also
// decides which beat comes next and when. Beats re-check the live state when they come
// due (`route`), so the same storyline plays differently depending on what happened since.
//
// Same balance rules as events.ts: every option costs something, hints use the vocabulary
// engine/hints.ts classifies, and the LLM may reword text but never effects.

import type { ArcState, Category, Effect, Engineer, GameState, Project } from "@/engine/types";
import type { Rng } from "@/engine/rng";
import { E, active, by, first, levelTitle, loyaltyOdds, projectOf, type EventBody, type EventCtx } from "./events";

export interface BeatCtx extends EventCtx {
  subject: Engineer;
  flags: string[];
}

/** Who (and what) a storyline is about, fixed when it opens. */
export interface Cast {
  subject: Engineer;
  other?: Engineer;
  project?: Project;
}

/** What a due beat does: show itself, jump to another beat, wait a week, or close the storyline. */
export type Route = { show: true } | { goto: string } | { wait: true } | { end: string };

export interface Beat {
  /** Checked when the beat comes due, against the state at that moment. Defaults to showing. */
  route?: (ctx: BeatCtx) => Route;
  build: (ctx: BeatCtx) => EventBody;
}

export interface Storyline {
  id: string;
  title: string;
  cat: Category;
  canBeRequired: boolean; // can the opening beat be the week's must-respond item?
  /** How likely the storyline is to start for this person now. 0 = not eligible. */
  weight: (s: GameState, e: Engineer) => number;
  /** Who the storyline is about, chosen from engineers not already in a storyline. */
  cast: (s: GameState, free: Engineer[], rng: Rng) => Cast | null;
  start: string;
  beats: Record<string, Beat>;
  /** The second person may leave mid-story without ending it (a layoff is part of the story). */
  otherMayLeave?: boolean;
  /**
   * What an unresolved storyline costs every Friday while it waits on `beat`. Situations left
   * open wear on people, so stalling is a choice with a price.
   */
  simmer?: (ctx: BeatCtx, beat: string) => { why: string; effects: Effect[] } | null;
}

const next = (to: string, min: number, max = min): Effect => ({ k: "arc", to, wait: [min, max] });
const end = (outcome: string): Effect => ({ k: "arcEnd", outcome });
const flag = (f: string): Effect => ({ k: "arcFlag", flag: f });
const show: Route = { show: true };
/** Did this storyline end (for anyone) within the last `weeks` weeks? */
const recently = (s: GameState, storyline: string, weeks: number) => s.arcHistory.some((h) => h.storyline === storyline && h.ended > s.quarter * 12 + s.week - weeks);
const ended = (s: GameState, storyline: string, who: string, outcome?: string) =>
  s.arcHistory.some((h) => h.storyline === storyline && h.subjectId === who && (!outcome || h.outcome === outcome));

/* ------------------------------------------------------------------------------------ */
/* The Promo: an ambitious engineer wants the next level. Commit, be honest, or dodge.  */
/* ------------------------------------------------------------------------------------ */

const promo: Storyline = {
  id: "promo",
  title: "The Promo",
  cat: "PEOPLE",
  canBeRequired: true,
  weight: (s, e) => (e.tenure !== "new" && e.attrs.ambition >= 12 && e.level >= 3 && e.level < 7 && !ended(s, "promo", e.id) && !recently(s, "promo", 8) ? 3 : 0),
  cast: (s, free, rng) => {
    const pool = free.filter((e) => promo.weight(s, e) > 0);
    return pool.length ? { subject: rng.pick(by(pool, (e) => e.attrs.ambition).slice(0, 2)) } : null;
  },
  start: "ask",
  simmer: ({ subject: e }, beat) =>
    ["calibration", "fallout", "recruiter"].includes(beat) ? { why: `${first(e)} is waiting on the promo`, effects: [E.attr(e.id, "morale", -1)] } : null,
  beats: {
    ask: {
      build: ({ subject: e, s }) => {
        const p = projectOf(s, e) ?? active(s)[0];
        return {
          from: e.name,
          fromRole: levelTitle(e),
          title: "“Got a sec?”",
          body: `${first(e)}’s calendar shows a 45-minute “dentist appointment” for the third time this month. ${first(e)} asks whether the promo packet is still happening this cycle.`,
          intents: [
            {
              id: "commit",
              label: "Commit to the promo, in writing",
              cost: 1,
              hints: "Morale ↑ · Loyalty ↑ · Calibration risk",
              effects: [E.attr(e.id, "morale", 3), E.loyalty(e.id, 1), flag("committed"), next("evidence", 1, 2)],
              cause: "Written promotion commitment",
            },
            {
              id: "honest",
              label: "Be honest: it won’t make this calibration",
              cost: 1,
              hints: "Morale ↓ · Loyalty ↑ · Reveals a trait or Loyalty",
              effects: [E.attr(e.id, "morale", -2), E.loyalty(e.id, 2), { k: "scout", who: e.id, d: 1 }, next("stretch", 1, 3)],
              cause: "An honest conversation about calibration",
            },
            {
              id: "redirect",
              label: `Offer tech lead on ${p ? p.name : "the next project"} first`,
              cost: 1,
              hints: p ? "Ambition ✓ · Progress ↓" : "Ambition ✓ · Morale ↑",
              effects: [E.attr(e.id, "morale", 2), ...(p ? [E.progress(p.id, -4)] : []), flag("lead"), next("stretch", 1, 2)],
              cause: "Tech lead role instead of a promise",
            },
          ],
          ignoreHint: "Morale ↓ · Loyalty ↓ · Leave risk",
          ignoreEffects: [E.attr(e.id, "morale", -3), E.loyalty(e.id, -2), flag("dodged"), next("recruiter", 1, 3)],
          ignoreCause: "Promotion question left unanswered",
        };
      },
    },

    // Committed: the packet needs evidence, and evidence costs delivery time.
    evidence: {
      build: ({ subject: e, s }) => {
        const p = projectOf(s, e) ?? active(s)[0];
        return {
          from: e.name,
          fromRole: levelTitle(e),
          title: "“What goes in the packet?”",
          body: `${first(e)} has a draft packet with one bullet: “shipped stuff”. The committee wants scope, impact and a design doc with ${first(e)}’s name on it.`,
          intents: [
            {
              id: "design",
              label: `Have ${first(e)} own the design doc${p ? ` for ${p.name}` : ""}`,
              cost: 1,
              hints: p ? "Communication ↑ · Progress ↓ · Packet evidence" : "Communication ↑ · Packet evidence",
              effects: [E.attr(e.id, "communication", 1), E.attr(e.id, "energy", -1), ...(p ? [E.progress(p.id, -5)] : []), E.meter("packet", 1), flag("evidence"), next("calibration", 1, 3)],
              cause: "Design doc as promo evidence",
            },
            {
              id: "write",
              label: "Write the packet with them, line by line",
              cost: 2,
              hints: "Morale ↑ · Loyalty ↑ · Packet evidence",
              effects: [E.attr(e.id, "morale", 2), E.loyalty(e.id, 2), E.meter("packet", 1), flag("evidence"), next("calibration", 1, 3)],
              cause: "Wrote the packet together",
            },
            {
              id: "hero",
              label: "Let them hero the next launch",
              cost: 0,
              hints: "Energy ↓ · Burnout risk · Progress ↑",
              effects: [E.attr(e.id, "energy", -3), ...(p ? [E.progress(p.id, 4)] : []), next("calibration", 1, 3)],
              cause: "Heroics as promo evidence",
            },
          ],
          ignoreHint: "Morale ↓ · Weak packet risk",
          ignoreEffects: [E.attr(e.id, "morale", -2), next("calibration", 1, 3)],
          ignoreCause: "Packet left to write itself",
        };
      },
    },

    // Honest or redirected: is there a real path, or just words?
    stretch: {
      route: ({ subject: e }) => (e.attrs.morale <= 6 ? { goto: "recruiter" } : show),
      build: ({ subject: e, s, flags, peer }) => {
        const p = projectOf(s, e) ?? active(s)[0];
        const lead = flags.includes("lead");
        return {
          from: e.name,
          fromRole: levelTitle(e),
          title: lead ? "“Leading is harder than I thought”" : "“So what would get me there?”",
          body: lead
            ? `${first(e)} has run the ${p ? p.name : "project"} standup for two weeks. The standup now runs 40 minutes. ${first(e)} wants to know if this counts.`
            : `${first(e)} took the honest answer well, publicly. Privately, ${first(e)} wants a concrete list of what “next level” means here.`,
          intents: [
            {
              id: "plan",
              label: "Write a growth plan with dates",
              cost: 1,
              hints: "Morale ↑ · Loyalty ↑ · Promise due",
              effects: [
                E.attr(e.id, "morale", 2),
                E.loyalty(e.id, 2),
                { k: "promise", who: e.id, text: `${first(e)}: a growth plan review, with real feedback.`, dueIn: 4, payload: [E.attr(e.id, "communication", 1)], payloadHint: "Communication ↑" },
                flag("evidence"),
                next("calibration", 3, 5),
              ],
              cause: "A written growth plan",
            },
            {
              id: "mentor",
              label: `Pair them with ${peer.name.split(" ")[0]}’s staff engineer`,
              cost: 1,
              hints: "Communication ↑ · Peer Trust ↓ · Morale ↑",
              effects: [E.attr(e.id, "communication", 2), E.attr(e.id, "morale", 1), E.trust("peer", -2), end("growing")],
              cause: "Cross-team mentorship",
            },
            {
              id: "later",
              label: "“Let’s revisit next quarter”",
              cost: 0,
              hints: "Morale ↓ · Loyalty ↓ · Leave risk",
              effects: [E.attr(e.id, "morale", -2), E.loyalty(e.id, -2), next("recruiter", 2, 4)],
              cause: "Growth conversation postponed",
            },
          ],
          ignoreHint: "Morale ↓ · Loyalty ↓ · Leave risk",
          ignoreEffects: [E.attr(e.id, "morale", -2), E.loyalty(e.id, -3), next("recruiter", 1, 3)],
          ignoreCause: "Growth question went unanswered",
        };
      },
    },

    // Calibration only happens late in the quarter. Earlier, the beat waits.
    calibration: {
      route: ({ s }) => (s.week >= 9 ? show : { wait: true }),
      build: ({ subject: e, flags, peer }) => {
        const strong = flags.includes("evidence");
        const odds = strong ? 0.65 : 0.3;
        return {
          from: "Calibration",
          fromRole: "Room 4B, no laptops",
          title: `${first(e)}’s packet is on the screen`,
          body: `${strong ? `The packet is solid: scope, impact, a design doc.` : `The packet is thin. Someone asks what “shipped stuff” means.`} ${peer.name.split(" ")[0]}’s report is up next and also “had a great half”.`,
          intents: [
            {
              id: "allin",
              label: `Go all-in for ${first(e)}`,
              cost: 2,
              hints: `Political Capital ↓ · Peer Trust ↓ · ${strong ? "Depends on the packet" : "Coin flip"}`,
              effects: [
                E.meter("capital", -8),
                E.trust("peer", -3),
                E.chance(odds, "Promoted", [{ k: "levelUp", who: e.id }, E.attr(e.id, "morale", 4), E.loyalty(e.id, 3), end("promoted")], [E.attr(e.id, "morale", -2), next("fallout", 1)], "Not this cycle"),
              ],
              cause: `Fought for ${first(e)} in calibration`,
            },
            {
              id: "trade",
              label: "Trade the slot for a favor",
              cost: 1,
              hints: "Peer Trust ↑ · Political Capital ↑ · Morale ↓",
              effects: [E.trust("peer", 6), E.meter("capital", 4), E.attr(e.id, "morale", -3), flag("traded"), next("fallout", 1)],
              cause: "Traded the promo slot for a favor",
            },
            {
              id: "nextcycle",
              label: "Argue for next cycle, with a named sponsor",
              cost: 1,
              hints: "Morale ↓ · Political Capital ↓ · Packet evidence",
              effects: [E.attr(e.id, "morale", -2), E.meter("capital", -4), E.meter("packet", 1), next("fallout", 1)],
              cause: "Set up next cycle’s promo",
            },
          ],
          ignoreHint: "Morale ↓ · Loyalty ↓",
          ignoreEffects: [E.attr(e.id, "morale", -3), E.loyalty(e.id, -2), E.meter("packet", -1), flag("absent"), next("fallout", 1)],
          ignoreCause: "Calibrated by people who’ve never met them",
        };
      },
    },

    fallout: {
      build: ({ subject: e, flags }) => {
        const promised = flags.includes("committed");
        return {
          from: e.name,
          fromRole: levelTitle(e),
          title: "“I saw the list.”",
          body: `${first(e)} didn’t make it.${promised ? ` ${first(e)} still has your written commitment, and quotes it.` : ""}${flags.includes("traded") ? " Somebody mentioned the trade." : ""}`,
          intents: [
            {
              id: "own",
              label: "Own it, and name the next date",
              cost: 1,
              hints: "Loyalty ↑ · Morale ↓",
              effects: [E.loyalty(e.id, promised ? 1 : 2), E.attr(e.id, "morale", -2), E.chance(loyaltyOdds(e, 0.35), "They’re staying for the next cycle", [end("deferred")], [next("recruiter", 1, 3)])],
              cause: "Owned the promo miss",
            },
            {
              id: "blame",
              label: "Blame the committee",
              cost: 0,
              hints: "Morale ↑ · Skip Trust ↓ · Leave risk",
              effects: [E.attr(e.id, "morale", 1), E.trust("skip", -3), next("recruiter", 1, 2)],
              cause: "Blamed the committee",
            },
            {
              id: "scope",
              label: "Give them the biggest project next quarter",
              cost: 1,
              hints: "Ambition ✓ · Energy ↓ · PM Trust ↓",
              effects: [E.attr(e.id, "morale", 2), E.attr(e.id, "energy", -2), E.loyalty(e.id, 1), E.trust("pm", -3), end("deferred")],
              cause: "Bigger scope as a consolation",
            },
          ],
          ignoreHint: "Morale ↓↓ · Loyalty ↓↓ · Leave risk",
          ignoreEffects: [E.attr(e.id, "morale", -4), E.loyalty(e.id, -3), ...(promised ? [E.trust("skip", -2)] : []), next("recruiter", 1, 1)],
          ignoreCause: "Promo miss never discussed",
        };
      },
    },

    // Every unhappy branch ends up here. Loyalty (hidden) decides the odds.
    recruiter: {
      route: ({ subject: e }) => (e.attrs.morale >= 15 && e.loyalty >= 13 ? { end: "settled" } : show),
      build: ({ subject: e }) => ({
        from: e.name,
        fromRole: levelTitle(e),
        title: "“They offered me the title”",
        body: `${first(e)} mentions, very casually, that a startup offered the title this company wouldn’t. “I haven’t decided anything.”`,
        intents: [
          {
            id: "counter",
            label: "Fight for a retention bonus",
            cost: 2,
            hints: "Political Capital ↓ · Chance they stay",
            effects: [
              E.meter("capital", -6),
              E.chance(loyaltyOdds(e, 0.3), "The bonus kept them", [E.loyalty(e.id, 3), E.attr(e.id, "morale", 2), end("retained")], [E.leave(e.id), end("left")]),
            ],
            cause: "Counter-offer",
          },
          {
            id: "title",
            label: "Promise the title next cycle, in writing",
            cost: 1,
            hints: "Morale ↑ · Promise due · Chance they stay",
            effects: [
              E.attr(e.id, "morale", 2),
              { k: "promise", who: e.id, text: `${first(e)}: promotion next cycle, in writing.`, dueIn: 5, payload: [E.meter("capital", -6), E.meter("packet", 1)], payloadHint: "Political Capital ↓" },
              E.chance(loyaltyOdds(e, 0.3), "They stayed on the promise", [end("promised")], [E.leave(e.id), end("left")]),
            ],
            cause: "Promised the title to keep them",
          },
          {
            id: "wish",
            label: "Wish them well, mean it",
            cost: 0,
            hints: "Reputation ↑ · Leave risk",
            effects: [E.meter("reputation", 1), E.attr(e.id, "morale", 1), E.chance(0.5, "They took the offer", [E.leave(e.id), end("left")], [end("stayed")])],
            cause: "Gracious, but no counter-offer",
          },
        ],
        ignoreHint: "Loyalty ↓ · Leave risk",
        ignoreEffects: [E.loyalty(e.id, -3), E.chance(0.6, "They took the offer", [E.leave(e.id), end("left")], [E.attr(e.id, "morale", -2), end("stayed")], "They stayed, unhappy")],
        ignoreCause: "Recruiter conversation ignored",
      }),
    },
  },
};

/* ------------------------------------------------------------------------------------ */
/* Running on Empty: someone is burning out. Catch it early, or watch it get worse.     */
/* ------------------------------------------------------------------------------------ */

const burnout: Storyline = {
  id: "burnout",
  title: "Running on Empty",
  cat: "PEOPLE",
  canBeRequired: true,
  weight: (s, e) => (e.attrs.energy <= 11 && !s.arcHistory.some((h) => h.storyline === "burnout" && h.subjectId === e.id && h.ended >= s.quarter * 12 + s.week - 12) ? 12 - e.attrs.energy : 0),
  cast: (s, free) => {
    const e = by(free.filter((x) => burnout.weight(s, x) > 0), (x) => -x.attrs.energy)[0];
    return e ? { subject: e } : null;
  },
  start: "signs",
  simmer: ({ subject: e }, beat) => (beat === "back" ? null : { why: `${first(e)} is still running on empty`, effects: [E.attr(e.id, "energy", -2)] }),
  beats: {
    signs: {
      build: ({ subject: e, s }) => {
        const p = projectOf(s, e);
        const onCall = s.plan.oncallId === e.id;
        return {
          from: e.name,
          fromRole: levelTitle(e),
          // The pager only haunts the person who carries it.
          title: onCall ? "The pager is still in my dreams" : "“I’m fine”, at 02:14",
          body: `“I’m fine” arrives at 02:14. ${first(e)}’s Energy is ${e.attrs.energy}/20${p ? ` and ${first(e)} is still on ${p.name}` : ""}${onCall ? ", and on call this week" : ""}.`,
          intents: [
            {
              id: "checkin",
              label: "Book a proper check-in",
              cost: 1,
              hints: "Morale ↑ · Reveals a trait or Loyalty",
              effects: [E.attr(e.id, "morale", 2), { k: "scout", who: e.id, d: 1 }, flag("talked"), next("checkpoint", 1, 2)],
              cause: "A real check-in, not a status update",
            },
            {
              id: "offload",
              label: "Re-plan the critical path without them",
              cost: 1,
              hints: p ? "Energy ↑ · Progress ↓" : "Energy ↑ · Morale ↓",
              effects: [E.attr(e.id, "energy", 4), ...(p ? [E.progress(p.id, -6)] : [E.attr(e.id, "morale", -1)]), next("checkpoint", 1, 2)],
              cause: "Moved off the critical path",
            },
            ...(onCall
              ? [
                  {
                    id: "pager",
                    label: "Take them off the pager for a month",
                    cost: 0,
                    hints: "Energy ↑ · On-call Load ↑",
                    effects: [E.attr(e.id, "energy", 2), E.meter("oncallLoad", 6), next("checkpoint", 2, 3)],
                    cause: "Off the pager for a month",
                  },
                ]
              : []),
          ],
          ignoreHint: "Energy ↓ · Burnout risk",
          ignoreEffects: [E.attr(e.id, "energy", -2), E.attr(e.id, "morale", -1), next("slipping", 1, 1)],
          ignoreCause: "Burnout signs went unanswered",
        };
      },
    },

    // Did it work? The live Energy number decides.
    checkpoint: {
      route: ({ subject: e, flags }) =>
        e.attrs.energy >= 12 ? { goto: "back" } : e.attrs.energy <= 6 ? { goto: "slipping" } : flags.includes("checked") ? { goto: e.attrs.energy >= 9 ? "back" : "slipping" } : show,
      build: ({ subject: e, s }) => {
        const p = projectOf(s, e);
        return {
          from: e.name,
          fromRole: levelTitle(e),
          title: "Better. Not fixed.",
          body: `${first(e)} is answering messages in daylight again, mostly. Energy is ${e.attrs.energy}/20. ${p ? `${p.name} could really use them back.` : "There’s plenty of work waiting."}`,
          intents: [
            {
              id: "extend",
              label: "Keep the lighter load two more weeks",
              cost: 1,
              hints: p ? "Energy ↑ · Progress ↓" : "Energy ↑ · Morale ↓",
              effects: [E.attr(e.id, "energy", 3), ...(p ? [E.progress(p.id, -4)] : [E.attr(e.id, "morale", -1)]), flag("checked"), next("checkpoint", 1)],
              cause: "Extended the recovery",
            },
            {
              id: "pto",
              label: "Insist on a real week off",
              cost: 1,
              hints: "Energy ↑↑ · Progress ↓ · PM Trust ↓",
              effects: [E.attr(e.id, "energy", 6), E.away(e.id), E.trust("pm", -2), next("back", 1)],
              cause: "A real week off",
            },
            {
              id: "full",
              label: "Ease them back to full speed",
              cost: 0,
              hints: "Progress ↑ · Energy ↓ · Burnout risk",
              effects: [...(p ? [E.progress(p.id, 3)] : []), E.attr(e.id, "energy", -1), flag("checked"), next("checkpoint", 1)],
              cause: "Back to full speed, early",
            },
          ],
          ignoreHint: "Energy ↓ · Burnout risk",
          ignoreEffects: [E.attr(e.id, "energy", -2), flag("checked"), next("checkpoint", 1, 1)],
          ignoreCause: "Recovery left to chance",
        };
      },
    },

    slipping: {
      route: ({ subject: e }) => (e.attrs.energy >= 12 ? { goto: "back" } : show),
      build: ({ subject: e, s, pm }) => {
        const p = projectOf(s, e);
        return {
          from: pm.name,
          fromRole: "Product Manager",
          title: `Is ${first(e)} okay?`,
          body: `${first(e)} missed standup twice and pushed a fix that broke staging. ${pm.name.split(" ")[0]} asks, kindly but on the record, whether ${p ? p.name : "the roadmap"} should plan around it.`,
          intents: [
            {
              id: "leave",
              label: "Arrange two weeks of leave",
              cost: 2,
              hints: "Energy ↑↑ · Progress ↓ · Loyalty ↑",
              effects: [E.attr(e.id, "energy", 7), E.loyalty(e.id, 2), ...(p ? [E.progress(p.id, -8)] : []), next("back", 1, 2)],
              cause: "Two weeks of leave",
            },
            {
              id: "smaller",
              label: "Move them to smaller, calmer work",
              cost: 1,
              hints: "Energy ↑ · Ambition ✓ · Morale ↓",
              effects: [E.attr(e.id, "energy", 3), E.attr(e.id, "morale", -2), ...(p ? [E.progress(p.id, -3)] : []), next("checkpoint", 1, 2)],
              cause: "Moved to calmer work",
            },
            {
              id: "cover",
              label: `Cover for them with ${pm.name.split(" ")[0]}`,
              cost: 0,
              hints: "PM Trust ↓ · Energy ↓ · Burnout risk",
              effects: [E.trust("pm", -4), E.attr(e.id, "energy", -1), E.meter("techDebt", 2), next("breaking", 1, 1)],
              cause: "Covered for a burnt-out engineer",
            },
          ],
          ignoreHint: "PM Trust ↓ · Energy ↓↓ · Leave risk",
          ignoreEffects: [E.trust("pm", -3), E.attr(e.id, "energy", -3), E.meter("techDebt", 2), next("breaking", 1)],
          ignoreCause: "Nobody acted on the warning signs",
        };
      },
    },

    breaking: {
      route: ({ subject: e }) => (e.attrs.energy >= 12 ? { goto: "back" } : show),
      build: ({ subject: e }) => ({
        from: e.name,
        fromRole: levelTitle(e),
        title: "“I need to step away”",
        body: `${first(e)} asks for a meeting with no agenda. It’s a resignation draft, unsent. “I can’t do another quarter like this one.”`,
        intents: [
          {
            id: "sabbatical",
            label: "Fight for a paid month off",
            cost: 2,
            hints: "Political Capital ↓↓ · Energy ↑↑ · Chance they stay",
            effects: [
              E.meter("capital", -10),
              E.attr(e.id, "energy", 8),
              E.chance(loyaltyOdds(e, 0.25), "They came back", [E.loyalty(e.id, 4), end("recovered")], [E.leave(e.id), end("left")]),
            ],
            cause: "Fought for a sabbatical",
          },
          {
            id: "handover",
            label: "Accept it, two weeks of handover",
            cost: 1,
            hints: "Tech Debt ↑ · Reputation ↑",
            effects: [E.meter("techDebt", 3), E.meter("reputation", 1), E.leave(e.id), end("left")],
            cause: "A kind, orderly exit",
          },
          {
            id: "backfill",
            label: "Accept it, fight for the backfill",
            cost: 1,
            hints: "Political Capital ↓ · Hiring chance",
            effects: [E.meter("capital", -4), E.leave(e.id), E.chance(0.5, "Backfill approved", [{ k: "hire" }]), end("left")],
            cause: "Accepted the exit, fought for the seat",
          },
        ],
        ignoreHint: "Tech Debt ↑↑ · Team Morale ↓",
        ignoreEffects: [E.meter("techDebt", 8), E.team("morale", -1), E.leave(e.id), end("left")],
        ignoreCause: "Burnt out and walked out",
      }),
    },

    back: {
      build: ({ subject: e, s }) => {
        const staffed = projectOf(s, e);
        const p = staffed ?? s.projects.find((x) => x.id === e.awayFrom && x.status === "active") ?? active(s)[0];
        return {
          from: e.name,
          fromRole: levelTitle(e),
          title: "“Thanks for the breathing room”",
          body: `${first(e)} is back: rested, opinionated, and already rewriting the on-call runbook${p ? ` for ${p.name}` : ""}.`,
          intents: [
            {
              id: "runbook",
              label: "Let them fix the runbook properly",
              cost: 1,
              hints: "On-call Load ↓ · Debugging ↑",
              effects: [E.meter("oncallLoad", -6), E.attr(e.id, "debugging", 1), E.loyalty(e.id, 1), end("recovered")],
              cause: "Runbook rewrite after recovery",
            },
            ...(p
              ? [
                  {
                    id: "ship",
                    label: staffed ? `Point them at the ${p.name} deadline` : `Put them straight back on ${p.name}`,
                    cost: 0,
                    hints: "Progress ↑ · Energy ↓",
                    effects: [E.assign(e.id, p.id), E.progress(p.id, 5), E.attr(e.id, "energy", -2), end("recovered")],
                    cause: "Back on the critical path",
                  },
                ]
              : [
                  {
                    id: "ease",
                    label: "Let them ease back in",
                    cost: 0,
                    hints: "Energy ↑ · Political Capital ↓",
                    effects: [E.attr(e.id, "energy", 2), E.meter("capital", -1), end("recovered")],
                    cause: "A gentle return",
                  },
                ]),
          ],
          ignoreHint: "Morale ↓",
          ignoreEffects: [E.attr(e.id, "morale", -1), end("recovered")],
          ignoreCause: "Recovery went unremarked",
        };
      },
    },
  },
};

/* ------------------------------------------------------------------------------------ */
/* The Reorg: a rumor, then a spreadsheet, then the people who are left.                */
/* Subject: the senior who carries the team afterwards. Other: the person most exposed. */
/* ------------------------------------------------------------------------------------ */


const reorg: Storyline = {
  id: "reorg",
  title: "The Reorg",
  cat: "POLITICS",
  canBeRequired: true,
  otherMayLeave: true,
  weight: (s) => (s.week >= 3 && s.week <= 9 && s.engineers.length >= 4 && !recently(s, "reorg", 24) ? 1.5 * (s.company === "Google" ? 1.5 : 1) : 0),
  cast: (s, free) => {
    if (reorg.weight(s, free[0]) <= 0 || free.length < 2) return null;
    const exposed = by(free, (e) => -e.attrs.coding)[0];
    const senior = by(free.filter((e) => e !== exposed), (e) => e.level)[0];
    return senior ? { subject: senior, other: exposed } : null;
  },
  start: "rumor",
  simmer: (_ctx, beat) =>
    beat === "list"
      ? { why: "Reorg rumors in every thread", effects: [E.team("morale", -1), E.team("energy", -1), E.meter("stress", 2)] }
      : beat === "aftermath"
        ? { why: "The empty desk nobody mentions", effects: [E.team("morale", -1)] }
        : null,
  beats: {
    rumor: {
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
            effects: [E.chance(0.4, "It sounded true", [E.team("morale", 1)], [E.team("morale", -1), E.meter("reputation", -1)], "Nobody believed it"), flag("reassured"), next("list", 1, 2)],
            cause: "Reorg rumor addressed at standup",
          },
          {
            id: "ask",
            label: `Ask ${skip.name.split(" ")[0]} directly`,
            cost: 1,
            hints: "Skip Trust ↑ · Political Capital ↓",
            effects: [E.trust("skip", 2), E.meter("capital", -2), flag("warned"), next("list", 1, 2)],
            cause: "Asked the skip-level directly",
          },
          {
            id: "prepare",
            label: "Quietly write up the team’s impact, just in case",
            cost: 2,
            hints: "Stress ↑ · Skip Trust ↑",
            effects: [E.meter("stress", 3), E.trust("skip", 1), flag("prepared"), next("list", 1, 2)],
            cause: "Wrote the team’s impact doc",
          },
        ],
        ignoreHint: "Team Morale ↓ · Stress ↑",
        ignoreEffects: [E.team("morale", -1), E.meter("stress", 1), next("list", 1, 2)],
        ignoreCause: "Reorg rumor left to the threads",
      }),
    },

    list: {
      route: ({ s }) => (s.week >= 4 && s.week <= 11 ? show : { wait: true }),
      build: ({ subject: senior, other: low, skip, flags }) => {
        const odds = flags.includes("prepared") ? 0.6 : 0.35;
        return {
          from: skip.name,
          fromRole: "Skip-level · confidential",
          title: "The spreadsheet has a column called “Impact if removed”",
          body: `You need to stack-rank your team and draw a line by Friday. It is “not a layoff list”.${flags.includes("reassured") ? " Your team still believes your standup." : ""}${flags.includes("warned") ? " At least you saw it coming." : ""}`,
          intents: [
            {
              id: "rank",
              label: "Rank honestly and draw the line",
              cost: 2,
              hints: `Skip Trust ↑ · ${low ? first(low) : "Someone"} leaves · Team Morale ↓`,
              effects: [...(low ? [E.leave(low.id, "cut")] : []), E.trust("skip", 4), E.team("morale", -1), next("aftermath", 1, 1)],
              cause: "Drew the line on the spreadsheet",
            },
            {
              id: "fight",
              label: "Fight for zero cuts",
              cost: 2,
              hints: `Political Capital ↓↓ · ${flags.includes("prepared") ? "Depends on the impact doc" : "Coin flip"}`,
              effects: [
                E.meter("capital", -10),
                E.chance(odds, "Zero cuts held", [E.team("morale", 1), flag("held"), next("aftermath", 1, 1)], [...(low ? [E.leave(low.id, "cut")] : []), E.trust("skip", -4), next("aftermath", 1, 1)], "The cut went ahead"),
              ],
              cause: "Fought for zero cuts",
            },
            {
              id: "warn",
              label: "Warn the team first",
              cost: 1,
              hints: `Team Morale ↑ · Skip Trust ↓↓ · ${low ? first(low) : "Someone"} leaves`,
              effects: [...(low ? [E.leave(low.id, "cut")] : []), E.team("morale", 1), E.trust("skip", -8), next("aftermath", 1, 1)],
              cause: "Warned the team before the list",
            },
          ],
          ignoreHint: `Skip Trust ↓ · ${first(senior)} leaves`,
          ignoreEffects: [E.leave(senior.id, "cut"), E.trust("skip", -6), E.team("morale", -1), end("cut")],
          ignoreCause: "Finance drew the line for you",
        };
      },
    },

    aftermath: {
      build: ({ subject: e, s, flags }) => {
        const held = flags.includes("held");
        const p = projectOf(s, e);
        return {
          from: e.name,
          fromRole: levelTitle(e),
          title: held ? "“Nobody was cut. So why does it feel like this?”" : "“Am I next?”",
          body: held
            ? `The list came back empty. Half the team updated their CV anyway. ${first(e)} asks what changed, and whether it will happen again next quarter.`
            : `Standup has one fewer person and nobody mentions it. ${first(e)} closes the door and asks whether there is a second list.`,
          intents: [
            {
              id: "allhands",
              label: "Hold an honest team retro on it",
              cost: 1,
              hints: "Team Morale ↑ · Skip Trust ↓",
              effects: [E.team("morale", 2), E.trust("skip", -2), end(held ? "held" : "healed")],
              cause: "An honest retro on the cuts",
            },
            {
              id: "retain",
              label: `Make sure ${first(e)} knows they’re safe`,
              cost: 1,
              hints: "Morale ↑ · Political Capital ↓ · Team Morale ↓",
              effects: [E.attr(e.id, "morale", 3), E.loyalty(e.id, 2), E.meter("capital", -4), E.team("morale", -1), end(held ? "held" : "retained")],
              cause: "Reassured the senior one-on-one",
            },
            {
              id: "heads",
              label: "Heads down: the roadmap didn’t shrink",
              cost: 0,
              hints: p ? "Progress ↑ · Team Energy ↓" : "Team Energy ↓",
              effects: [...(p ? [E.progress(p.id, 4)] : []), E.team("energy", -1), end(held ? "held" : "heads down")],
              cause: "Back to the roadmap",
            },
          ],
          ignoreHint: "Team Morale ↓ · Leave risk",
          ignoreEffects: [E.team("morale", -2), E.loyalty(e.id, -2), E.chance(0.25, `${first(e)} took a call from a recruiter`, [E.leave(e.id)]), end("unspoken")],
          ignoreCause: "Nobody talked about the cuts",
        };
      },
    },
  },
};

/* ------------------------------------------------------------------------------------ */
/* The Rewrite: an ambitious engineer wants to build v2. Rewrites never stay small.     */
/* ------------------------------------------------------------------------------------ */

const rewrite: Storyline = {
  id: "rewrite",
  title: "The Rewrite",
  cat: "DELIVERY",
  canBeRequired: false,
  weight: (s, e) => (s.week <= 8 && e.tenure !== "new" && e.attrs.ambition >= 12 && projectOf(s, e) && !recently(s, "rewrite", 12) ? 1.5 * (s.company === "Google" ? 1.6 : 1) : 0),
  cast: (s, free) => {
    const e = by(free.filter((x) => rewrite.weight(s, x) > 0), (x) => x.attrs.ambition + x.attrs.coding)[0];
    return e ? { subject: e, project: projectOf(s, e) } : null;
  },
  start: "pitch",
  simmer: ({ subject: e }, beat) =>
    ["halfway", "incident", "shadow"].includes(beat) ? { why: `${first(e)}’s v2 is half-built`, effects: [E.meter("techDebt", 2), E.meter("oncallLoad", 2)] } : null,
  beats: {
    pitch: {
      build: ({ subject: e, project: p }) => ({
        from: e.name,
        fromRole: levelTitle(e),
        title: "A 14-page doc called “Service v2”",
        body: `v1 works. Maintaining v1 does not fit in a promo packet. ${first(e)} has already picked the new framework${p ? ` and wants to start on ${p.name}` : ""}.`,
        intents: [
          {
            id: "approve",
            label: "Approve the rewrite",
            cost: 1,
            hints: "Morale ↑ · Packet evidence · Tech Debt ↑ · Progress ↓",
            effects: [E.attr(e.id, "morale", 3), E.meter("packet", 2), E.meter("techDebt", 6), ...(p ? [E.progress(p.id, -6)] : []), next("halfway", 2, 3)],
            cause: "Approved the rewrite",
          },
          {
            id: "migrate",
            label: "Make it a migration plan with a design review",
            cost: 2,
            hints: "Tech Debt ↓ · Packet evidence · Morale ↓",
            effects: [E.meter("techDebt", -4), E.meter("packet", 1), E.attr(e.id, "morale", -1), next("review", 1, 2)],
            cause: "Rewrite became a migration plan",
          },
          {
            id: "no",
            label: "No. Maintenance is the job.",
            cost: 0,
            hints: "Morale ↓ · Loyalty risk",
            effects: [E.attr(e.id, "morale", -3), E.chance(0.3, "They took it personally", [E.loyalty(e.id, -3)]), next("shadow", 1, 3)],
            cause: "Said no to v2",
          },
        ],
        ignoreHint: "Tech Debt ↑ · Energy ↓",
        ignoreEffects: [E.meter("techDebt", 4), E.attr(e.id, "energy", -2), next("shadow", 1, 2)],
        ignoreCause: "They started v2 in their 20% time anyway",
      }),
    },

    halfway: {
      build: ({ subject: e, project: p }) => {
        const odds = Math.min(0.85, 0.25 + e.attrs.coding / 40 + e.attrs.debugging / 40);
        return {
          from: e.name,
          fromRole: levelTitle(e),
          title: "v2 is “basically done”",
          body: `v2 handles 70% of traffic in staging. v1 still pages twice a week. ${first(e)} wants to cut over this Friday${p ? `, mid-way through ${p.name}` : ""}.`,
          intents: [
            {
              id: "cutover",
              label: "Cut over this Friday",
              cost: 1,
              hints: "Depends on Coding and Debugging · On-call Load risk",
              effects: [
                E.chance(odds, "Clean cutover", [E.meter("techDebt", -10), E.attr(e.id, "morale", 3), end("shipped")], [E.meter("oncallLoad", 10), E.trust("pm", -3), next("incident", 1)], "The cutover broke something"),
              ],
              cause: "Cut over to v2",
            },
            {
              id: "dual",
              label: "Run v1 and v2 side by side for a while",
              cost: 1,
              hints: "On-call Load ↑ · Tech Debt ↑ · Progress ↓",
              effects: [E.meter("oncallLoad", 5), E.meter("techDebt", 3), E.attr(e.id, "morale", 1), ...(p ? [E.progress(p.id, -5)] : []), end("dual-running")],
              cause: "v1 and v2 both in production",
            },
            {
              id: "kill",
              label: "Kill v2, fold the good parts into v1",
              cost: 1,
              hints: "Morale ↓↓ · Loyalty ↓ · Tech Debt ↓ · Progress ↑",
              effects: [E.attr(e.id, "morale", -4), E.loyalty(e.id, -2), E.meter("techDebt", -3), ...(p ? [E.progress(p.id, 4)] : []), end("killed")],
              cause: "Killed the rewrite",
            },
          ],
          ignoreHint: "Tech Debt ↑ · On-call Load ↑ · Energy ↓",
          ignoreEffects: [E.meter("techDebt", 5), E.meter("oncallLoad", 3), E.attr(e.id, "energy", -2), end("abandoned")],
          ignoreCause: "v2 stalled at 70%, forever",
        };
      },
    },

    incident: {
      build: ({ subject: e, project: p, pm }) => ({
        from: pm.name,
        fromRole: "Product Manager",
        title: "v2 fell over at 03:12",
        body: `The cutover held for six hours. ${first(e)} has been in the incident channel since. ${pm.name.split(" ")[0]} would like to know “what the plan is”.`,
        intents: [
          {
            id: "rollback",
            label: "Roll back to v1",
            cost: 1,
            hints: "Morale ↓ · Progress ↓ · On-call Load ↓",
            effects: [E.attr(e.id, "morale", -2), E.meter("oncallLoad", -6), ...(p ? [E.progress(p.id, -4)] : []), end("rolled back")],
            cause: "Rolled back to v1",
          },
          {
            id: "forward",
            label: `Fix forward with ${first(e)}`,
            cost: 1,
            hints: "Energy ↓ · Depends on Debugging",
            effects: [
              E.attr(e.id, "energy", -3),
              E.chance(e.attrs.debugging / 20, "Fixed forward", [E.meter("techDebt", -6), E.meter("oncallLoad", -4), end("shipped")], [E.trust("skip", -3), E.meter("oncallLoad", 2), end("limping")], "Still limping"),
            ],
            cause: "Fixed forward",
          },
        ],
        ignoreHint: "On-call Load ↑ · PM Trust ↓",
        ignoreEffects: [E.meter("oncallLoad", 6), E.trust("pm", -3), end("limping")],
        ignoreCause: "v2 left limping in production",
      }),
    },

    review: {
      build: ({ subject: e, project: p, peer }) => ({
        from: "Design review",
        fromRole: "Architecture forum",
        title: "The migration plan meets the architecture forum",
        body: `${first(e)} presents a five-phase migration. ${peer.name.split(" ")[0]} asks why phase 3 exists.`,
        intents: [
          {
            id: "champion",
            label: "Back the whole plan in the room",
            cost: 1,
            hints: "Morale ↑ · Communication ↑ · Peer Trust ↓ · Progress ↓",
            effects: [E.attr(e.id, "morale", 2), E.attr(e.id, "communication", 1), E.trust("peer", -2), ...(p ? [E.progress(p.id, -3)] : []), E.meter("packet", 1), end("migrating")],
            cause: "Backed the migration plan",
          },
          {
            id: "phase1",
            label: "Approve phase 1 only",
            cost: 0,
            hints: "Tech Debt ↓ · Morale ↓",
            effects: [E.meter("techDebt", -2), E.attr(e.id, "morale", -1), end("phase one")],
            cause: "Approved phase 1 only",
          },
        ],
        ignoreHint: "Morale ↓ · Tech Debt ↑",
        ignoreEffects: [E.attr(e.id, "morale", -2), E.meter("techDebt", 2), end("stalled")],
        ignoreCause: "Migration plan died in review",
      }),
    },

    shadow: {
      build: ({ subject: e, project: p }) => ({
        from: e.name,
        fromRole: levelTitle(e),
        title: "There’s a branch called v2-final-FINAL",
        body: `${first(e)} built v2 anyway, evenings mostly. It passes 80% of the tests. ${first(e)} looks tired and very proud.`,
        intents: [
          {
            id: "adopt",
            label: "Make it official",
            cost: 1,
            hints: "Morale ↑ · Loyalty ↑ · Tech Debt ↑ · Progress ↓",
            effects: [E.attr(e.id, "morale", 3), E.loyalty(e.id, 2), E.meter("techDebt", 3), ...(p ? [E.progress(p.id, -3)] : []), next("halfway", 1, 2)],
            cause: "Adopted the shadow rewrite",
          },
          {
            id: "shelve",
            label: "Thank them, and shelve it",
            cost: 1,
            hints: "Morale ↓ · Energy ↑",
            effects: [E.attr(e.id, "morale", -3), E.attr(e.id, "energy", 2), end("shelved")],
            cause: "Shelved the shadow rewrite",
          },
          {
            id: "hackweek",
            label: "Let it run as a side project",
            cost: 0,
            hints: "Energy ↓ · Tech Debt ↑ · Morale ↑",
            effects: [E.attr(e.id, "energy", -2), E.meter("techDebt", 2), E.attr(e.id, "morale", 1), end("side project")],
            cause: "v2 as an evening side project",
          },
        ],
        ignoreHint: "Energy ↓ · Morale ↓",
        ignoreEffects: [E.attr(e.id, "energy", -3), E.attr(e.id, "morale", -1), end("side project")],
        ignoreCause: "Nobody mentioned the shadow rewrite",
      }),
    },
  },
};

/* ------------------------------------------------------------------------------------ */
/* Two Seniors: a PR thread that becomes a feud. Subject and other are the two people.  */
/* ------------------------------------------------------------------------------------ */

/** A day both seniors spend not coding. */
const feudProject = (s: GameState, a: Engineer): Effect[] => {
  const p = projectOf(s, a);
  return p ? [E.progress(p.id, -4)] : [E.meter("stress", 1)];
};

const feud: Storyline = {
  id: "feud",
  title: "Two Seniors",
  cat: "PEOPLE",
  canBeRequired: false,
  weight: (s) => (s.engineers.length >= 4 && !recently(s, "feud", 12) ? 2 : 0),
  cast: (s, free, rng) => {
    if (feud.weight(s, free[0]) <= 0) return null;
    const [a, b] = rng.shuffle(by(free, (e) => e.level).slice(0, 3));
    return a && b ? { subject: a, other: b } : null;
  },
  start: "thread",
  simmer: ({ subject: a, other: b, s }, beat) => {
    if (beat === "truce" || !b) return null;
    const p = projectOf(s, a);
    return { why: `${first(a)} and ${first(b)} still aren’t talking`, effects: [E.attr(a.id, "morale", -1), E.attr(b.id, "morale", -1), ...(p ? [E.progress(p.id, -3)] : [])] };
  },
  beats: {
    thread: {
      build: ({ subject: a, other: b, s }) => ({
        from: a.name,
        fromRole: levelTitle(a),
        title: `A 40-comment PR thread with ${first(b!)}`,
        body: `It started as a naming nit. It is now about values. ${first(a)} and ${first(b!)} have stopped reacting to each other’s Slack messages.`,
        intents: [
          {
            id: "mediate",
            label: "Get them in a room together",
            cost: 2,
            hints: "Morale ↑↑ · Progress ↓ · Reveals a trait or Loyalty",
            effects: [E.attr(a.id, "morale", 2), E.attr(b!.id, "morale", 2), E.loyalty(a.id, 1), E.loyalty(b!.id, 1), { k: "scout", who: a.id, d: 1 }, ...feudProject(s, a), next("truce", 2, 3)],
            cause: "Mediated the PR standoff",
          },
          {
            id: "lint",
            label: "Adopt a style guide, not a verdict",
            cost: 1,
            hints: "Morale ↑ · Tech Debt ↓ · Progress ↓",
            effects: [E.attr(a.id, "morale", 1), E.attr(b!.id, "morale", 1), E.meter("techDebt", -1), ...feudProject(s, a), next("truce", 1, 2)],
            cause: "A lint rule ended the debate",
          },
          {
            id: "rule",
            label: "Make the call yourself",
            cost: 0,
            hints: `${first(a)} Morale ↑ · ${first(b!)} Morale ↓`,
            effects: [E.attr(a.id, "morale", 1), E.attr(b!.id, "morale", -2), next("grudge", 1, 2)],
            cause: "Manager decided the naming debate",
          },
        ],
        ignoreHint: "Morale ↓ for both",
        ignoreEffects: [E.attr(a.id, "morale", -2), E.attr(b!.id, "morale", -2), next("sides", 1, 1)],
        ignoreCause: "PR feud left to simmer",
      }),
    },

    // Did it hold? Both people's live Morale decides.
    truce: {
      route: ({ subject: a, other: b }) => (a.attrs.morale >= 14 && b!.attrs.morale >= 14 ? { end: "truce" } : show),
      build: ({ subject: a, other: b, s }) => {
        const p = projectOf(s, a);
        return {
          from: "Design review",
          fromRole: p ? p.name : "Architecture forum",
          title: "It’s back, in the design review",
          body: `${first(a)} and ${first(b!)} were civil for three weeks. Today ${first(b!)} left a comment that just says “interesting choice”.`,
          intents: [
            {
              id: "split",
              label: "Give them separate areas of the codebase",
              cost: 1,
              hints: p ? "Morale ↑ · Progress ↓" : "Morale ↑ · Tech Debt ↑",
              effects: [E.attr(a.id, "morale", 1), E.attr(b!.id, "morale", 1), ...(p ? [E.progress(p.id, -3)] : [E.meter("techDebt", 2)]), end("separated")],
              cause: "Split their areas",
            },
            {
              id: "pair",
              label: "Pair them on the hardest bug you have",
              cost: 2,
              hints: "Coin flip · Debugging ↑",
              effects: [
                E.attr(a.id, "debugging", 1),
                E.chance(0.5, "They respect each other now", [E.attr(a.id, "morale", 3), E.attr(b!.id, "morale", 3), end("friends")], [E.attr(a.id, "morale", -2), E.attr(b!.id, "morale", -2), next("sides", 1, 1)], "It got worse"),
              ],
              cause: "Paired the rivals",
            },
          ],
          ignoreHint: "Morale ↓ for both · Team Morale ↓",
          ignoreEffects: [E.attr(a.id, "morale", -2), E.attr(b!.id, "morale", -2), E.team("morale", -1), next("sides", 1, 1)],
          ignoreCause: "The truce quietly ended",
        };
      },
    },

    // The one who lost the call.
    grudge: {
      route: ({ other: b }) => (b!.attrs.morale >= 13 ? { end: "moved on" } : show),
      build: ({ subject: a, other: b }) => ({
        from: b!.name,
        fromRole: levelTitle(b!),
        title: "“Can I switch teams?”",
        body: `${first(b!)} hasn’t mentioned the naming debate since you ruled on it. ${first(b!)} has, however, been chatting with the platform team’s manager.`,
        intents: [
          {
            id: "let",
            label: "Support the transfer",
            cost: 1,
            hints: `${first(b!)} leaves · Reputation ↑`,
            effects: [E.meter("reputation", 2), E.leave(b!.id, "transfer"), end("transferred")],
            cause: "Supported an internal transfer",
          },
          {
            id: "talk",
            label: "Ask them to give it one quarter",
            cost: 1,
            hints: "Morale ↑ · Chance they stay",
            effects: [E.attr(b!.id, "morale", 2), E.chance(loyaltyOdds(b!, 0.35), "They’ll give it a quarter", [E.loyalty(b!.id, 2), end("stayed")], [E.leave(b!.id, "transfer"), end("transferred")])],
            cause: "Asked them to stay a quarter",
          },
          {
            id: "reverse",
            label: "Reopen the original decision",
            cost: 1,
            hints: `${first(b!)} Morale ↑ · ${first(a)} Morale ↓`,
            effects: [E.attr(b!.id, "morale", 3), E.attr(a.id, "morale", -3), end("reversed")],
            cause: "Reversed the call",
          },
        ],
        ignoreHint: "Morale ↓ · Loyalty ↓ · Leave risk",
        ignoreEffects: [E.attr(b!.id, "morale", -2), E.loyalty(b!.id, -3), E.chance(0.4, "The transfer went through", [E.leave(b!.id, "transfer")]), end("drifted")],
        ignoreCause: "Transfer request left unanswered",
      }),
    },

    sides: {
      build: ({ subject: a, other: b, s, pm }) => {
        const p = projectOf(s, a);
        return {
          from: pm.name,
          fromRole: "Product Manager",
          title: "The team is picking sides",
          body: `Standup now has two factions and a neutral zone. ${pm.name.split(" ")[0]} noticed that ${p ? p.name : "the roadmap"} has stopped moving in the areas where ${first(a)} and ${first(b!)} overlap.`,
          intents: [
            {
              id: "formal",
              label: "Bring in a formal mediator",
              cost: 2,
              hints: "Political Capital ↓ · Morale ↑ · Team Morale ↑",
              effects: [E.meter("capital", -4), E.attr(a.id, "morale", 1), E.attr(b!.id, "morale", 1), E.team("morale", 1), end("mediated")],
              cause: "Formal mediation",
            },
            {
              id: "separate",
              label: "Move one of them to another project",
              cost: 1,
              hints: p ? "Progress ↓ · Morale ↑" : "Morale ↑ · Tech Debt ↑",
              effects: [...(p ? [E.progress(p.id, -5)] : [E.meter("techDebt", 2)]), E.attr(a.id, "morale", 1), E.attr(b!.id, "morale", 1), end("separated")],
              cause: "Separated the rivals",
            },
            {
              id: "ultimatum",
              label: `Tell ${first(a)} to drop it or leave`,
              cost: 1,
              hints: `${first(a)} Morale ↓↓ · Leave risk · Team Morale ↑`,
              effects: [E.attr(a.id, "morale", -4), E.team("morale", 1), E.chance(0.4, `${first(a)} left`, [E.leave(a.id)]), end("ultimatum")],
              cause: "Ultimatum",
            },
          ],
          ignoreHint: "Team Morale ↓↓ · Progress ↓ · Leave risk",
          ignoreEffects: [E.team("morale", -2), ...(p ? [E.progress(p.id, -3)] : []), E.chance(0.4, `${first(b!)} left`, [E.leave(b!.id)]), end("fractured")],
          ignoreCause: "The feud split the team",
        };
      },
    },
  },
};

/* ------------------------------------------------------------------------------------ */
/* Launch Week: a project near its date. Go, flag it, or slip, then live with launch day. */
/* ------------------------------------------------------------------------------------ */

/** The project closest to launch: due within three weeks and at least half built. */
function launchable(s: GameState): Project | undefined {
  return by(
    active(s).filter((p) => p.dueWeek - s.week >= 0 && p.dueWeek - s.week <= 3 && p.progress / p.scope >= 0.5),
    (p) => p.progress / p.scope,
  )[0];
}

const launch: Storyline = {
  id: "launch",
  title: "Launch Week",
  cat: "DELIVERY",
  canBeRequired: true,
  weight: (s) => (s.week >= 7 && launchable(s) && !recently(s, "launch", 6) ? 3 : 0),
  cast: (s, free) => {
    const p = launchable(s);
    if (!p || launch.weight(s, free[0]) <= 0) return null;
    const lead = by(free.filter((e) => e.projectId === p.id), (e) => e.attrs.coding)[0];
    return lead ? { subject: lead, project: p } : null;
  },
  start: "gonogo",
  simmer: (_ctx, beat) => (beat === "launchday" ? { why: "Launch week nerves", effects: [E.meter("stress", 1)] } : null),
  beats: {
    gonogo: {
      build: ({ subject: e, project: p, s, pm }) => {
        const pct = Math.round((p!.progress / p!.scope) * 100);
        const fixedDate = p!.flagship && s.company === "Vercel";
        return {
          from: pm.name,
          fromRole: "Product Manager",
          title: `Go/no-go for ${p!.name}`,
          body: `${p!.name} is at ${pct}% and due week ${p!.dueWeek}. ${first(e)} says it’s “basically ready”. The bug tracker says 14 things.`,
          intents: [
            {
              id: "go",
              label: "Go: ship it on the date",
              cost: 1,
              hints: "Progress ↑ · Energy ↓ · Incident risk",
              effects: [E.progress(p!.id, 4), E.attr(e.id, "energy", -2), flag("go"), next("launchday", 1)],
              cause: "Called go on the launch",
            },
            {
              id: "flag",
              label: "Ship behind a flag to 10% of users",
              cost: 1,
              hints: "Progress ↑ · Tech Debt ↑",
              effects: [E.progress(p!.id, 2), E.meter("techDebt", 2), flag("flagged"), next("launchday", 1)],
              cause: "Launch behind a feature flag",
            },
            ...(fixedDate
              ? []
              : [
                  {
                    id: "slip",
                    label: "Slip one week and harden it",
                    cost: 1,
                    hints: "Deadline +1 week · PM Trust ↓ · Tech Debt ↓",
                    effects: [{ k: "deadline", project: p!.id, d: 1 } as Effect, E.trust("pm", -3), E.meter("techDebt", -2), flag("flagged"), next("launchday", 1, 2)],
                    cause: "Slipped the launch to harden it",
                  },
                ]),
          ],
          ignoreHint: "Stress ↑ · PM Trust ↓",
          ignoreEffects: [E.meter("stress", 2), E.trust("pm", -2), next("launchday", 1)],
          ignoreCause: "Nobody called go or no-go",
        };
      },
    },

    launchday: {
      // Already shipped on its own: skip to the celebration. Missed its date: the story is over.
      route: ({ project: p }) => (!p || p.status === "missed" ? { end: "missed" } : p.status !== "active" ? { goto: "afterglow" } : show),
      build: ({ subject: e, project: p, s, flags }) => {
        const safe = flags.includes("flagged");
        const odds = Math.max(0.2, (safe ? 0.8 : 0.6) - s.techDebt / 200);
        return {
          from: e.name,
          fromRole: `${p!.name} · launch lead`,
          title: "It’s launch day and the dashboard is red",
          body: `Error rate is up 3%. ${safe ? "It’s only 10% of users, for now." : "It’s everyone."} ${first(e)} has opened a war-room channel and twelve people have joined to watch.`,
          intents: [
            {
              id: "warroom",
              label: "Run the war room yourself",
              cost: 2,
              hints: `Team Energy ↓ · ${safe ? "Depends on Tech Debt" : "Coin flip"}`,
              effects: [
                E.team("energy", -1),
                E.chance(odds, "Stable by noon", [E.progress(p!.id, 6), E.meter("reputation", 1), end("launched")], [E.meter("oncallLoad", 6), E.trust("pm", -3), next("retro", 1)], "Launch day wobbled"),
              ],
              cause: "Ran the launch war room",
            },
            {
              id: "delegate",
              label: `Let ${first(e)} handle it`,
              cost: 0,
              hints: "Energy ↓ · Depends on Debugging",
              effects: [
                E.attr(e.id, "energy", -3),
                E.chance(Math.min(0.85, e.attrs.debugging / 20), `${first(e)} handled it`, [E.progress(p!.id, 4), E.attr(e.id, "morale", 2), end("launched")], [E.meter("oncallLoad", 6), next("retro", 1)], "It got away from them"),
              ],
              cause: "Launch lead ran the incident",
            },
            {
              id: "rollback",
              label: "Roll back and try again next week",
              cost: 1,
              hints: "Progress ↓ · PM Trust ↓ · Tech Debt ↓",
              effects: [E.progress(p!.id, -4), E.trust("pm", -2), E.meter("techDebt", -2), next("launchday", 1)],
              cause: "Rolled back the launch",
            },
          ],
          ignoreHint: "On-call Load ↑ · Stress ↑",
          ignoreEffects: [E.meter("oncallLoad", 5), E.meter("stress", 2), next("retro", 1)],
          ignoreCause: "Launch day ran without you",
        };
      },
    },

    retro: {
      build: ({ subject: e, project: p, skip }) => ({
        from: skip.name,
        fromRole: "Skip-level",
        title: `What happened with ${p ? p.name : "the launch"}?`,
        body: `${skip.name.split(" ")[0]} wants a retro by Friday. Someone has already started a doc titled “Launch learnings” with ${first(e)}’s name in the first line.`,
        intents: [
          {
            id: "blameless",
            label: "Run a blameless retro",
            cost: 1,
            hints: "Tech Debt ↓ · Team Morale ↑",
            effects: [E.meter("techDebt", -3), E.team("morale", 1), end("learned")],
            cause: "Blameless launch retro",
          },
          {
            id: "name",
            label: "Name the root cause, and the person",
            cost: 0,
            hints: `Skip Trust ↑ · ${first(e)} Morale ↓↓ · Loyalty ↓`,
            effects: [E.trust("skip", 2), E.attr(e.id, "morale", -4), E.loyalty(e.id, -2), end("blamed")],
            cause: "Named a person in the retro",
          },
          {
            id: "hotfix",
            label: "Skip the retro, run a hotfix sprint",
            cost: 1,
            hints: "Progress ↑ · Team Energy ↓ · Skip Trust ↓",
            effects: [...(p ? [E.progress(p.id, 3)] : []), E.team("energy", -2), E.trust("skip", -2), end("patched")],
            cause: "Hotfix sprint instead of a retro",
          },
        ],
        ignoreHint: "On-call Load ↑ · Team Morale ↓ · Skip Trust ↓",
        ignoreEffects: [E.meter("oncallLoad", 3), E.team("morale", -1), E.trust("skip", -2), end("unexamined")],
        ignoreCause: "The launch was never reviewed",
      }),
    },

    afterglow: {
      build: ({ subject: e, project: p }) => ({
        from: e.name,
        fromRole: levelTitle(e),
        title: `${p ? p.name : "It"} is live`,
        body: `${first(e)} posts a screenshot of the first real user. Forty emoji reactions. Somebody asks what’s next before the thread is an hour old.`,
        intents: [
          {
            id: "celebrate",
            label: "Take the team out, on your budget",
            cost: 1,
            hints: "Team Morale ↑ · Political Capital ↓",
            effects: [E.team("morale", 2), E.meter("capital", -3), end("celebrated")],
            cause: "Launch celebration",
          },
          {
            id: "credit",
            label: `Make sure the skip-level knows it was ${first(e)}`,
            cost: 0,
            hints: "Morale ↑ · Loyalty ↑ · Peer Trust ↓",
            effects: [E.attr(e.id, "morale", 3), E.loyalty(e.id, 2), E.trust("peer", -1), end("credited")],
            cause: "Gave the launch credit upward",
          },
        ],
        ignoreHint: "Morale ↓",
        ignoreEffects: [E.attr(e.id, "morale", -2), end("unremarked")],
        ignoreCause: "The launch went unremarked",
      }),
    },
  },
};

/* ------------------------------------------------------------------------------------ */
/* Planning Season: late in the quarter, a peer wants to borrow your best engineer.     */
/* ------------------------------------------------------------------------------------ */

const planning: Storyline = {
  id: "planning",
  title: "Planning Season",
  cat: "POLITICS",
  canBeRequired: true,
  weight: (s) => (s.week >= 8 && s.week <= 11 && s.engineers.length >= 3 && !recently(s, "planning", 20) ? 2.5 : 0),
  cast: (s, free) => {
    if (planning.weight(s, free[0]) <= 0) return null;
    const e = by(free.filter((x) => !ended(s, "planning", x.id)), (x) => x.attrs.coding + x.attrs.debugging)[0];
    return e ? { subject: e } : null;
  },
  start: "borrow",
  simmer: ({ subject: e }, beat) => (beat === "away" ? { why: `${first(e)} is on loan`, effects: [E.meter("stress", 1)] } : null),
  beats: {
    borrow: {
      build: ({ subject: e, s, peer }) => {
        const p = projectOf(s, e);
        const peerFirst = peer.name.split(" ")[0];
        return {
          from: peer.name,
          fromRole: "Peer EM",
          title: `“Can we borrow ${first(e)} for three weeks?”`,
          body: `${peerFirst}’s team has a launch in trouble and next quarter’s planning starts Monday. ${peerFirst} needs someone who knows ${p ? p.name : "your stack"} inside out, and everyone knows who that is.`,
          intents: [
            {
              id: "lend",
              label: `Lend ${first(e)}`,
              cost: 0,
              hints: p ? "Peer Trust ↑↑ · Progress ↓" : "Peer Trust ↑↑ · Energy ↓",
              effects: [E.trust("peer", 6), ...(p ? [] : [E.attr(e.id, "energy", -1)]), E.away(e.id), flag("lent"), next("away", 2, 3)],
              cause: `Lent ${first(e)} to ${peerFirst}`,
            },
            {
              id: "trade",
              label: "Lend them, for a headcount slot next quarter",
              cost: 1,
              hints: p ? "Political Capital ↑ · Peer Trust ↑ · Progress ↓" : "Political Capital ↑ · Peer Trust ↑",
              effects: [E.meter("capital", 5), E.trust("peer", 2), E.away(e.id), flag("lent"), next("away", 2, 3)],
              cause: "Traded an engineer loan for headcount",
            },
            {
              id: "refuse",
              label: "Say no, nicely",
              cost: 1,
              hints: "Peer Trust ↓↓",
              effects: [E.trust("peer", -6), next("roadmap", 1, 2)],
              cause: `Refused ${peerFirst}’s loan request`,
            },
          ],
          ignoreHint: "Peer Trust ↓ · Skip Trust ↓",
          ignoreEffects: [E.trust("peer", -4), E.trust("skip", -1), next("roadmap", 1, 2)],
          ignoreCause: "Loan request left on read",
        };
      },
    },

    // The loan is over. Do they want to come back?
    away: {
      route: ({ subject: e }) => (e.attrs.morale >= 14 && e.loyalty >= 12 ? { goto: "roadmap" } : show),
      build: ({ subject: e, peer, s }) => {
        const home = s.projects.find((x) => x.id === e.awayFrom && x.status === "active") ?? active(s)[0];
        const back = home ? [E.assign(e.id, home.id)] : [];
        return {
          from: e.name,
          fromRole: `${levelTitle(e)} · on loan`,
          title: "“They asked if I want to stay”",
          body: `${peer.name.split(" ")[0]}’s team ships fast and has a new framework. ${first(e)} sounds embarrassed and a little excited.`,
          intents: [
            {
              id: "release",
              label: "Let them transfer",
              cost: 1,
              hints: `${first(e)} leaves · Peer Trust ↑ · Reputation ↑`,
              effects: [E.trust("peer", 6), E.meter("reputation", 1), E.leave(e.id, "transfer"), end("transferred")],
              cause: "Let them transfer for good",
            },
            {
              id: "better",
              label: "Bring them back to a bigger project",
              cost: 1,
              hints: "Morale ↑ · Loyalty ↑ · Peer Trust ↓",
              effects: [...back, E.attr(e.id, "morale", 2), E.loyalty(e.id, 2), E.trust("peer", -2), next("roadmap", 1)],
              cause: "Brought them back with more scope",
            },
            {
              id: "monday",
              label: "“You’re back on Monday.”",
              cost: 0,
              hints: "Morale ↓ · Loyalty ↓ · Leave risk",
              effects: [E.attr(e.id, "morale", -3), E.loyalty(e.id, -2), E.chance(0.25, "They took the transfer anyway", [E.leave(e.id, "transfer"), end("transferred")], [...back, next("roadmap", 1)], "They came back, grudgingly")],
              cause: "Ordered them back",
            },
          ],
          ignoreHint: "Morale ↓ · Leave risk",
          ignoreEffects: [E.attr(e.id, "morale", -2), E.chance(0.5, "They stayed over there", [E.leave(e.id, "transfer"), end("transferred")], [next("roadmap", 1)])],
          ignoreCause: "Nobody asked them back",
        };
      },
    },

    roadmap: {
      route: ({ s }) => (s.week <= 12 ? show : { end: "planned" }),
      build: ({ skip, peer, flags }) => ({
        from: skip.name,
        fromRole: "Skip-level · planning",
        title: "Next quarter’s roadmap review",
        body: `Ten minutes per team, Thursday. ${peer.name.split(" ")[0]} has booked twenty.${flags.includes("lent") ? " At least they owe you one." : " They have not forgotten your “no”."}`,
        intents: [
          {
            id: "crisp",
            label: "Write a crisp one-page plan",
            cost: 2,
            hints: "Skip Trust ↑↑ · Stress ↑",
            effects: [E.trust("skip", 5), E.meter("stress", 2), end("planned")],
            cause: "A crisp plan at the roadmap review",
          },
          {
            id: "headcount",
            label: "Use the slot to fight for headcount",
            cost: 1,
            hints: `Political Capital ↓ · ${flags.includes("lent") ? "Hiring chance" : "Coin flip"}`,
            effects: [E.meter("capital", -6), E.chance(flags.includes("lent") ? 0.7 : 0.35, "Headcount approved", [{ k: "hire" }, end("headcount")], [E.trust("skip", -2), end("denied")], "Headcount denied")],
            cause: "Fought for headcount at planning",
          },
          {
            id: "align",
            label: `Co-present with ${peer.name.split(" ")[0]}`,
            cost: 1,
            hints: "Peer Trust ↑ · Skip Trust ↓",
            effects: [E.trust("peer", 4), E.trust("skip", -1), end("aligned")],
            cause: "Joint roadmap with the peer EM",
          },
        ],
        ignoreHint: "Skip Trust ↓↓",
        ignoreEffects: [E.trust("skip", -5), end("unplanned")],
        ignoreCause: "Next quarter got planned without you",
      }),
    },
  },
};

/* ------------------------------------------------------------------------------------ */
/* The New Hire: the first weeks decide whether they stay. Other: their onboarding buddy. */
/* ------------------------------------------------------------------------------------ */

const onboarding: Storyline = {
  id: "onboarding",
  title: "The New Hire",
  cat: "PEOPLE",
  canBeRequired: false,
  otherMayLeave: true,
  weight: (s, e) => (e.tenure === "new" && !ended(s, "onboarding", e.id) ? 3 : 0),
  cast: (s, free) => {
    const hire = free.find((e) => onboarding.weight(s, e) > 0);
    const buddy = by(free.filter((e) => e !== hire && e.tenure !== "new"), (e) => e.attrs.communication)[0];
    return hire && buddy ? { subject: hire, other: buddy } : null;
  },
  start: "firstweek",
  beats: {
    firstweek: {
      build: ({ subject: e, other: buddy, s }) => {
        const p = projectOf(s, e);
        return {
          from: e.name,
          fromRole: `${levelTitle(e)} · week one`,
          title: "Still no access to the repo",
          body: `${first(e)} has read the whole wiki, twice. Half of it describes a system that was deleted in 2023. IT says the laptop ticket is “in progress”.`,
          intents: [
            {
              id: "buddy",
              label: `Make ${buddy ? first(buddy) : "a senior"} their onboarding buddy`,
              cost: 1,
              hints: buddy ? `Morale ↑ · ${first(buddy)} Energy ↓` : "Morale ↑ · Stress ↑",
              effects: [E.attr(e.id, "morale", 2), ...(buddy ? [E.attr(buddy.id, "energy", -1), E.attr(buddy.id, "communication", 1)] : [E.meter("stress", 1)]), flag("buddy"), next("firstpr", 1, 2)],
              cause: "Assigned an onboarding buddy",
            },
            {
              id: "docs",
              label: "Fix the onboarding docs together",
              cost: 2,
              hints: "Tech Debt ↓ · Morale ↑ · Stress ↑",
              effects: [E.meter("techDebt", -2), E.attr(e.id, "morale", 1), E.meter("stress", 1), next("firstpr", 1, 2)],
              cause: "Rewrote the onboarding docs",
            },
            {
              id: "deepend",
              label: "Throw them at a real ticket",
              cost: 0,
              hints: p ? "Progress ↑ · Energy ↓" : "Energy ↓ · Coding ↑",
              effects: [...(p ? [E.progress(p.id, 2)] : [E.attr(e.id, "coding", 1)]), E.attr(e.id, "energy", -2), next("firstpr", 1, 2)],
              cause: "Deep end on day three",
            },
          ],
          ignoreHint: "Morale ↓",
          ignoreEffects: [E.attr(e.id, "morale", -2), next("firstpr", 1, 2)],
          ignoreCause: "The new hire onboarded themselves",
        };
      },
    },

    firstpr: {
      route: ({ subject: e }) => (e.attrs.morale <= 7 ? { goto: "doubts" } : show),
      build: ({ subject: e, other: buddy, flags }) => ({
        from: buddy ? buddy.name : "Code review",
        fromRole: buddy ? levelTitle(buddy) : "GitHub",
        title: "First PR: 61 comments",
        body: `${first(e)}’s first PR changes 40 lines. ${buddy ? first(buddy) : "The reviewer"} left 61 comments${flags.includes("buddy") ? ", kindly" : ""}, three of them about tabs.`,
        intents: [
          {
            id: "pair",
            label: "Ask the reviewer to pair instead",
            cost: 1,
            hints: buddy ? `Coding ↑ · ${first(buddy)} Energy ↓` : "Coding ↑ · Stress ↑",
            effects: [E.attr(e.id, "coding", 1), E.attr(e.id, "morale", 1), ...(buddy ? [E.attr(buddy.id, "energy", -1)] : [E.meter("stress", 1)]), end("ramped")],
            cause: "Paired on the first PR",
          },
          {
            id: "merge",
            label: "Merge it, fix the rest later",
            cost: 0,
            hints: "Morale ↑ · Tech Debt ↑",
            effects: [E.attr(e.id, "morale", 2), E.meter("techDebt", 2), next("doubts", 2, 3)],
            cause: "Merged the first PR as-is",
          },
          {
            id: "thorough",
            label: "Let the review be thorough",
            cost: 0,
            hints: "Coding ↑ · Morale ↓",
            effects: [E.attr(e.id, "coding", 1), E.attr(e.id, "morale", -2), next("doubts", 2, 3)],
            cause: "A very thorough first review",
          },
        ],
        ignoreHint: "Morale ↓",
        ignoreEffects: [E.attr(e.id, "morale", -2), next("doubts", 1, 2)],
        ignoreCause: "The first PR sat for a week",
      }),
    },

    doubts: {
      route: ({ subject: e }) => (e.attrs.morale >= 13 ? { end: "settled" } : show),
      build: ({ subject: e }) => ({
        from: e.name,
        fromRole: levelTitle(e),
        title: "“Is it always like this here?”",
        body: `${first(e)} asks it lightly, at the end of a 1:1, with eleven seconds left on the clock. The previous offer ${first(e)} turned down is still on LinkedIn.`,
        intents: [
          {
            id: "plan",
            label: "Write a 30-60-90 plan together",
            cost: 1,
            hints: "Morale ↑ · Loyalty ↑",
            effects: [E.attr(e.id, "morale", 3), E.loyalty(e.id, 2), end("settled")],
            cause: "A 30-60-90 plan with the new hire",
          },
          {
            id: "stretch",
            label: "Give them something real to own",
            cost: 1,
            hints: "Coding ↑ · Energy ↓ · Morale ↑",
            effects: [E.attr(e.id, "coding", 1), E.attr(e.id, "energy", -2), E.attr(e.id, "morale", 2), end("owning")],
            cause: "Gave the new hire real ownership",
          },
          {
            id: "shrug",
            label: "“Every job is like this at first.”",
            cost: 0,
            hints: "Morale ↓ · Leave risk",
            effects: [E.attr(e.id, "morale", -1), E.chance(loyaltyOdds(e, 0.45), "They’re sticking it out", [end("stayed")], [E.leave(e.id), end("left")])],
            cause: "Shrugged off the new hire’s doubts",
          },
        ],
        ignoreHint: "Morale ↓ · Leave risk",
        ignoreEffects: [E.attr(e.id, "morale", -2), E.chance(0.35, "They took the other offer", [E.leave(e.id), end("left")], [end("stayed")])],
        ignoreCause: "The new hire’s doubts went unheard",
      }),
    },
  },
};

export const STORYLINES: Storyline[] = [promo, burnout, reorg, rewrite, feud, launch, planning, onboarding];

export function storylineById(id: string): Storyline | undefined {
  return STORYLINES.find((x) => x.id === id);
}

/**
 * Build the context a beat sees: the live people and project plus the storyline's memory.
 * Null when someone in the cast has left: the storyline can't go on without them.
 */
export function beatCtx(base: EventCtx, arc: Pick<ArcState, "storyline" | "subjectId" | "otherId" | "projectId" | "flags">): BeatCtx | null {
  const find = (id: string) => base.s.engineers.find((e) => e.id === id);
  const subject = find(arc.subjectId);
  const other = arc.otherId ? find(arc.otherId) : undefined;
  if (!subject || (arc.otherId && !other && !storylineById(arc.storyline)?.otherMayLeave)) return null;
  const project = arc.projectId ? base.s.projects.find((p) => p.id === arc.projectId) : undefined;
  return { ...base, subject, other, project, flags: arc.flags };
}

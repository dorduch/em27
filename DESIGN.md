# EM27

A casual, mobile-first web game in the style of Championship Manager. You play an Engineering Manager at a real tech company. Each week you have a limited calendar and more demands than time. You choose what to deal with and how, staff your projects, then press **Continue**. On Friday, the week plays out. A deterministic simulation owns every number, and an LLM gives the characters their voice.

Tone: **satirical but grounded**. Situations should make an EM laugh and wince ("this happened to me").

Audience: **engineers and EMs**. Insider jargon is welcome (on-call, PIP, skip-level, L5, RFC, "quick sync?") and needs no explanation.

Design stance: **strategy first, story second.** Players should be able to predict roughly what a choice does and build a plan. The LLM adds voice and callbacks, but never surprises the player about the mechanics.

---

## 1. Locked decisions

| Area | Decision |
|---|---|
| Time model | Weekly turns. 12 weeks = 1 quarter ("season"). Quarterly review = end-of-season verdict. |
| Core tension | **Calendar budget**: 8 slots a week, more demands than slots. Ignoring something is a real choice. |
| Choices | Each event type defines fixed **choice intents** with fixed effects. The LLM only words them. Effects are telegraphed with hint tags. |
| LLM role | Voice and continuity: event text, the Friday back page, quarterly review. **The engine owns all state.** Routine outcomes use templates. |
| Memory | Engine-owned **fact ledger** (promises, grudges, favors, revealed traits). Promises come due and spawn follow-ups. |
| LLM hosting | Thin server proxy using our Anthropic key. No player key. |
| Companies | Real company names, **no logos**. Generic styled badges (initials + color). |
| Progression | **Career run**: climb EM → Senior EM → Director at one company. Fired = job hunt setback; a 2nd firing ends the run. Poaching offers after strong quarters. Shareable recap card at the end (section 10). |
| Team sim | CM-style player cards, **6 visible attributes**, plus hidden Loyalty and traits revealed through 1:1s. |
| Player actions | People ops, Delivery, Politics & stakeholders. **No free-text replies.** |
| Visuals | Retro CM / 2000s intranet, adapted for **mobile first**. |
| Stack (v1) | Next.js (TypeScript), **saves in localStorage**, no accounts, no database. Firebase comes later with accounts. |
| LLM budget | Haiku 5.5 by default, Sonnet 5.5 for the quarterly review, prompt caching on world context. |

---

## 2. Core loop

```
┌─ Week N ─────────────────────────────────────────────────────┐
│ MONDAY      Inbox fills: 5–7 demands. Calendar: 8 slots.     │
│ PLAN        For each item: pick an intent (costs 0–3 slots)  │
│             or ignore it. Book 1:1s (1 slot each).           │
│             Assign engineers to projects and on-call.        │
│ CONTINUE    Locks the week.                                  │
│ FRIDAY      Play-by-play: each project's progress, the       │
│             on-call roll, ignored items resolving, callbacks.│
│ BACK PAGE   Headline + stat deltas + "why" for each change.  │
└──────────────────────────────────────────────────────────────┘
Week 6   Mid-quarter check-in with your skip-level
Week 12  Quarterly review → rating → promotion / stay / fired (section 10)
Run ends at Director (win) or a 2nd firing (loss) → recap card
```

A week should take **3–5 minutes**, and a quarter about 45, so it plays in short bursts on a phone.

### 2.1 Calendar budget (the scarce resource)
- **8 slots per week.** Every meaningful action spends slots. There are always more demands than slots.
- Typical costs:

| Action | Slots |
|---|---|
| 1:1 with an engineer (reveals traits, moves Morale/Loyalty) | 1 |
| Quick reply / delegate an inbox item | 0–1 |
| Handle an item properly (meeting, doc, escalation) | 2 |
| Join an incident yourself | 2 |
| Interview loop | 1 |
| Skip-level's "quick deck" | 2 |
| Focus time (reduces your Stress, unlocks a strategy action) | 1 |

- **Ignoring is a choice.** Every event type defines an `ignored` outcome that resolves on Friday. Some get worse if ignored (burnout), some fade away (most CEO "quick asks").
- **Must-respond items** (red, like CM) are at most 1 per week. Only they block Continue.
- Overbooking is allowed with a penalty: each extra slot adds Stress, and high Stress shrinks next week's calendar.

### 2.2 Friday (the match-day analog)
Friday is where your plan is tested, shown as short CM-style text commentary lines with a short pause between them:

> 10:02 Checkout v2: Priya and Tom close 2 tickets. **On track.**
> 14:40 PagerDuty fires. Dana is on call (Debugging 8)…
> 15:15 …she escalates to you. The rollback takes 3 hours. **Tech Debt +2.**
> 17:30 The CEO's "quick ask" from Monday is quietly forgotten.

Each line comes from the engine. The LLM only polishes the wording. The commentary also hides the time it takes to generate next week's text.

---

## 3. Game systems (deterministic engine)

**Rule: an attribute exists only if a decision reads it.** Every stat below names the decision that uses it.

### 3.1 Company
Static, hand-authored data per company (a JSON file we control): `name`, `badgeColor`, `stage`, `size`, `culture` tags, engine modifiers, and a neutral `promptBlurb` for the LLM.

MVP companies, one per tier:

| Tier | Company | Culture tags (game flavor) | Engine modifiers |
|---|---|---|---|
| Startup | **Vercel** | `move-fast`, `launch-driven`, `dx-obsessed` | Conference deadlines, Twitter-driven priority swings, small team, hiring is hard but quick |
| Scale-up | **Stripe** | `writing-culture`, `high-bar`, `reliability-sacred` | Long docs slow delivery but raise quality, incidents hit trust hard, strict hiring bar |
| Big Tech | **Google** | `process-heavy`, `promo-driven`, `consensus` | Promo packets, design-doc reviews, high politics intensity, big budget, slow headcount |

Each company also has **one mechanic of its own**, so moving between them changes how you play:

| Company | Mechanic | How it plays |
|---|---|---|
| **Vercel** | **Keynote date** | Each quarter has a fixed conference week. The flagship project must ship on stage by then, with no negotiating the date. Shipping on stage = big Reputation; missing it is public. |
| **Stripe** | **Incident reviews** | Incidents cost double stakeholder Trust. Writing a postmortem the following week (1 slot) halves the hit. Ignoring it makes the next incident cost more. |
| **Google** | **Promo packet** | Promotions (yours and your engineers') need a packet: evidence points earned from launches and cross-team wins over the quarter. Calibration at the review can still say "not this cycle". |

### 3.2 Engineers (player cards)

| Attribute (1–20) | Read when |
|---|---|
| **Coding** | Project progress each Friday |
| **Debugging** | On-call roll and incidents: who you put on call matters |
| **Communication** | Demos, RFC reviews, stakeholder-facing events: who presents |
| **Ambition** | Promo requests, poaching attempts, "wants to lead" events |
| **Morale** | Output multiplier, resignation risk |
| **Energy** | Output multiplier, burnout events; drops on on-call and crunch weeks |

**Hidden:**
- **Loyalty**: shown as `?` until you've had enough 1:1s with that person. Drives poaching and resignation outcomes. Scouting your own team is the reason to spend calendar slots on 1:1s.
- **Traits**: `flight-risk`, `hero-coder`, `quiet-genius`, `drama-magnet`, `interviewing-elsewhere`, `wants-to-be-manager`… Each 1:1 has a chance to reveal one.

Plus: level (L3–L7), salary, tenure, current assignment, one-line bio (written once at hire).

### 3.3 Projects
- Each project has scope (points), a deadline (week) and an owning stakeholder.
- Friday progress = Σ assigned engineers' (Coding × Morale × Energy factors) − Tech Debt drag ± small variance.
- Missing a deadline hits the owner's Trust. Shipping under pressure adds Tech Debt.

### 3.4 Team meters (3)
- **Delivery**: shown per project as progress vs deadline.
- **Tech Debt**: slows progress and raises incident odds.
- **On-call Load**: rises with incidents and drains the on-call engineer's Energy.

Team morale is shown as the squad average, not a separate meter. Headcount is a count, not a meter.

### 3.5 Office (stakeholders + you)
Stakeholders, each with **Trust** (0–100) and a personality:
- **Skip-level (your boss)**: runs your reviews.
- **PM**: owns the main project, wants scope.
- **Peer EM**: competes for headcount and credit.

The CEO is an event source (the "quick asks"), not a Trust score.

You: **Stress** (high Stress shrinks your calendar), **Political Capital** (earned by delivering, spent to push back on asks or fight for headcount) and **Reputation** (career-long; rises with strong reviews and big launches, drops when you're fired; decides the quality of job and poaching offers).

### 3.6 Quarterly rating
`rating = 40% delivery + 30% team health (morale, energy, attrition) + 30% stakeholder trust`

The grade uses the familiar scale: **Strongly Exceeds · Exceeds · Meets · Partially Meets · Does Not Meet**.

Boss Trust can shift the final grade by **at most one step**. It cannot carry a bad delivery quarter on its own, so keeping the boss happy is not a winning strategy.

### 3.7 Fact ledger (memory)
The engine records lasting facts:

```ts
type Fact = {
  id: string;
  kind: "promise" | "grudge" | "favor" | "trait_revealed" | "incident";
  subject: string;        // engineer or stakeholder id
  text: string;           // "Promised Priya a promo by week 10"
  createdWeek: number;
  dueWeek?: number;       // promises come due
  status: "open" | "kept" | "broken";
};
```

- Choice intents can **write** facts ("commit" writes a promise with a due week).
- Event types can **trigger** on facts. A promise that comes due spawns a follow-up ("You said Q2. It's Q2."). A broken promise costs Loyalty or Trust.
- The LLM gets the open facts about everyone in an event, so callbacks are reliable. The engine decides that a callback happens; the LLM only writes it.

---

## 4. Events and choices

### 4.1 Event types
About 30 hand-written **event types** for the MVP. Each one defines:
- **Trigger**: weights by game state, company culture and fact ledger.
- **Who's involved**: e.g. the engineer with the highest Ambition and lowest Loyalty.
- **2–4 choice intents**, each with: slot cost, fixed effects, ledger writes, and **hint tags**.
- **Ignored outcome**: resolves on Friday if the player doesn't spend slots on it.
- **Template text**: fallback text for the body, every choice and every outcome.

Example: `promo_request`

| Intent | Slots | Effects | Hint tags shown |
|---|---|---|---|
| `commit` | 1 | Morale +3, writes promise (due +6 weeks) | Morale ↑ · Promise |
| `be_honest` | 2 | Morale −2, Trust (engineer) +, Loyalty + if revealed trait isn't `flight-risk` | Morale ↓ · Trust ↑ |
| `redirect` (offer tech lead) | 1 | Ambition satisfied for 4 weeks, PM Trust − if project slips | Ambition ✓ · Project risk |
| *ignored* | 0 | Morale −3, 30% chance trait `interviewing-elsewhere` | — |

Categories:
- **People**: poaching attempt, burnout signs, promo request, conflict between two engineers, underperformer, great candidate, parental leave.
- **Delivery**: scope creep, prod incident (Fri 5pm), tech debt crisis, blown estimate, dependency team late.
- **Politics**: reorg rumor, headcount freeze, CEO pet project, peer EM takes credit, skip-level wants "a quick deck".

### 4.2 Legibility
- **Hint tags** on every choice tell the player the direction of the main effects, not the exact numbers (CM-style "this will upset him").
- **Causality log**: every stat change records its cause. The player card and Friday back page show it, e.g. *"Morale −3: promo deferred (wk 4)"*.
- Random variance is small and is shown as a "luck" line on Friday, so it is never confused with the effect of a choice.

---

## 5. LLM architecture

### 5.1 Principle
The **engine is the source of truth**. The LLM never changes state. It only writes words for things the engine already decided:
1. The engine picks the event type, the people involved and the intents.
2. The LLM returns JSON with the title, body and one label per **given intent id**.
3. zod validation: the label count and intent ids must match exactly. Otherwise use template text.

There are no effect hints from the LLM, so text and effects can't disagree.

### 5.2 When LLM calls happen
The week's text is generated **after Continue**, when the week's choices are locked. That way next week's events can react to this week's choices.

```
CONTINUE
  ├─ engine resolves the week (instant, client-side)
  ├─ engine picks next week's events + reads the fact ledger
  ├─ ONE LLM call (Haiku):
  │     input:  company blurb (cached), this week's resolved lines,
  │             next week's event specs, open facts for the people involved
  │     output: polished Friday lines + back-page headline
  │             + next week's event titles, bodies and intent labels
  └─ Friday commentary plays while the call runs (it covers the latency)
```

| Call | Model | When | Output |
|---|---|---|---|
| `weekTurn` | Haiku | once per Continue | Friday lines, back page, next week's event text |
| `newGame` | Haiku | new game | engineer names and bios, stakeholder personalities |
| `quarterlyReview` | **Sonnet** | week 12 | review doc in the skip-level's voice, with callbacks |
| `careerMoment` | Haiku | job hunt, poaching offer, promotion | offer letters, recruiter pitch, farewell lines |
| `recapHeadline` | Haiku | end of run | recap card headline |

Choice **outcomes** use **templates with variables** ("{name} looks relieved. For now."). They show instantly and cost nothing.

### 5.3 Cost and abuse controls (no accounts in v1)
- About 13–14 LLM calls per quarter (12 weeks + review + an occasional career moment). Measure the real cost per quarter in M2.
- **Prompt caching** on the stable prefix (tone guide, rules, company blurb).
- **Template fallback** for every string, so the game stays playable if the LLM is down, slow or rate-limited.
- Without accounts: a **per-IP rate limit** on the proxy plus a **hard spend limit** on the Anthropic workspace as the backstop.

### 5.4 Content guardrails (real company names)
The system prompt must tell the LLM:
- Do **not** reference real executives, real people, real scandals, lawsuits or layoffs by name.
- Satirize *situations common across the industry*, not specific claims about the company.
- Keep company references to culture-level color from our `promptBlurb`.

A disclaimer goes on the title screen: *"Parody. Not affiliated with or endorsed by any company named."*

---

## 6. Mobile-first UI

The retro CM look is adapted to a phone: **dense but readable**, one column, tabs at the bottom, tap to drill in.

### 6.1 Navigation (bottom tab bar)
`Week` · `Squad` · `Projects` · `Office`

A sticky **CONTINUE** button sits above the tab bar. It is blocked only by the week's must-respond item.

### 6.2 Key screens
- **Week**: the calendar bar at the top (8 slots, filled as you commit) and the inbox below. Each inbox row shows the sender, subject and slot cost range. Tap to open a full-screen event card with intent buttons, each showing its slot cost and hint tags.
- **Squad**: one row per engineer (name, role, Coding / Debugging / Morale as colored 1–20 numbers, Energy icon). Tap opens the **player card**: 6 attributes, Loyalty (or `?`), traits found so far, causality log, actions (book 1:1, promote, PIP, fire, set on-call).
- **Projects**: progress vs deadline, assigned engineers, tap to assign, on-call rotation.
- **Office**: stakeholders with Trust meters, Political Capital actions, your Stress, and the open promises from the fact ledger ("You owe: …").
- **Friday**: full-screen text commentary, CM match-day style.
- **Back page**: newspaper-style headline, recap, stat deltas with causes.
- **Quarterly review**: a dramatic reveal of the rating, written in the skip-level's voice, then promotion / stay / fired.
- **Offer**: a job-hunt or poaching offer as a letter: company, level, team snapshot, salary, and the choices.
- **Recap card**: the end-of-run card with a share button.

### 6.3 Visual style
- Retro intranet: beveled panels, a system-like font stack plus a monospace font for numbers, teal/navy/grey palette, CM-style 1–20 colored numbers (red 1–7 · amber 8–13 · green 14–20).
- Touch targets ≥ 44px, no hover-only interactions, playable one-handed.
- Installable as a **PWA** (manifest + offline shell).
- Desktop: the same layout in a centered frame.

---

## 7. Technical architecture (v1: no accounts, no database)

```
┌──────────── Client (Next.js App Router, React, TS) ──────────────┐
│  UI (mobile-first, Tailwind)     Game engine (pure TS)           │
│  Zustand store  ◄─────────────►  engine/ resolveWeek(), pick()   │
│  Save: localStorage (versioned JSON) + export/import             │
└────────────┬─────────────────────────────────────────────────────┘
             │ POST /api/llm  { kind, payload }
┌────────────▼──────────── Next.js route handler (e.g. on Vercel) ─┐
│  Builds the prompt server-side, calls Anthropic, validates JSON  │
│  Per-IP rate limit · API key in env · no state stored           │
└──────────────────────────────────────────────────────────────────┘
```

- **The engine runs on the client.** With no leaderboard, cheating only spoils your own game, so the server doesn't need to own the turn.
- **The proxy is thin**: it accepts only known `kind`s and structured payloads, builds the prompt on the server and caps the output length. It is never a free-form chat endpoint.
- **Saves**: one versioned JSON blob in localStorage (`em27.save.v1`), with a schema version for migrations. The causality log and Friday lines are trimmed to the current and previous quarter to stay well under the storage limit. **Export/import save** (copy a JSON string) protects against a cleared browser.
- **Seeded RNG**: each save has a seed, and each week's randomness = hash(seed, week). Runs are reproducible and easy to debug.
- **Later (v2, with Firebase)**: accounts, cloud saves, leaderboards. Turn resolution then moves to the server for anti-cheat. Keeping the engine pure TS makes that move straightforward.

### Repo layout (proposed)
```
/app                Next.js routes + screens, /api/llm
/components         UI (retro-mobile design system)
/engine             pure TS sim: types, rng, calendar, resolveWeek, ledger, rating
/content            companies.json, events/*.ts, templates, name pools, tone guide
/llm                prompt builders, zod schemas, fallbacks
/lib/save           localStorage persistence, migrations, export/import
/tests              engine unit tests, event-type tests, LLM schema contract tests
```

---

## 8. MVP scope (v0.1)

**In:**
- No accounts, 1 save slot in localStorage + export/import
- New game: pick 1 of 3 companies, generated team of 6, 2–3 projects, 3 stakeholders
- 12 weekly turns with calendar budget, Friday commentary, back page, mid-quarter check-in, quarterly review
- Full career run: EM → Senior EM → Director, job hunt after the first firing, run ends on the second, poaching offers
- One unique mechanic per company (keynote date, incident reviews, promo packet)
- Recap card with sharing
- ~30 event types with intents, hint tags, ignored outcomes and templates
- Fact ledger with promises and follow-ups
- LLM: one call per week + quarterly review, template fallback everywhere
- PWA install, mobile-first layout

**Out (v2+):** Firebase accounts and cloud saves, leaderboards, relationships between engineers, free-text replies, sound.

---

## 9. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Skeleton | Next.js deployed, mobile shell with tab bar, localStorage save/load, `/api/llm` stub |
| M1 | Engine without LLM | Full quarter playable with **templates only**: calendar budget, intents, ledger, Friday lines, rating. Engine tests. **Playtest with ~5 EMs:** do they hesitate over choices, and do they want week 5? |
| M2 | LLM layer | `weekTurn` and `quarterlyReview` via the proxy, zod validation, fallback, caching, cost measured per quarter |
| M3 | Mobile UI polish | Retro design system, player cards, Friday commentary, back page, review moment |
| M4 | Career run | Multiple quarters, promotion, job hunt, poaching offers, company mechanics, recap card |
| M5 | Content & balance | 30 event types, 3 companies, tuning passes (time to Director, firing rate), guardrail review of LLM output |
| M6 | Ship | Rate limit + spend cap, PWA, disclaimer, analytics |

M1 before M2 is deliberate: if the game isn't fun with plain templates, LLM text won't save it.

---

## 10. Career run (progression)

A **run** is one career, from your first EM job until you reach Director or get fired twice. A strong run takes about 6 quarters (roughly 4–5 hours of play across many short sessions).

### 10.1 The ladder
| Level | Team | Calendar | What changes |
|---|---|---|---|
| **EM** | 6 engineers, 2–3 projects | 8 slots | Start here |
| **Senior EM** | 8 engineers, 3–4 projects | 9 slots | Demands grow faster than the extra slot; the CEO starts noticing you |
| **Director** | — | — | **You win.** The run ends with the recap card. |

- **Promotion:** two quarters in a row at **Exceeds or better**, plus a Reputation threshold. At Google this also needs a promo packet (section 3.1).
- **After a good review** you keep your squad and play the next quarter. Squad attachment builds over the run: engineers grow, get promoted, leave, and remember your promises.
- **Getting fired:** a review of **Does Not Meet**, or **Partially Meets** twice in a row.

### 10.2 Fired → job hunt (setback, not reset)
- The **first firing** opens the job hunt: 1–3 offers from the other companies, at the **same or one level lower**, depending on Reputation.
- Reputation drops but carries over. Promotion progress resets. You get a new squad.
- A **second firing ends the run.**

### 10.3 Poaching offers (the "big club calls" moment)
- After a quarter at **Exceeds or better**, there's a chance another company makes you an offer, usually for a level up or more money.
- Choices:
  - **Accept**: move company, take the offered level, leave your squad behind (with a farewell line from each engineer).
  - **Decline**: stay, with a small Loyalty boost across the squad.
  - **Use it as leverage**: gain Political Capital or headcount now, but your boss's Trust drops, and there's a chance it backfires.

### 10.4 Recap card (in the first release)
At the end of a run (win or loss), the game builds a shareable card:
- Career path: companies, levels and quarter ratings (e.g. `Vercel EM → Stripe EM → Stripe Sr EM → Director`).
- Quarters played, projects shipped, incidents survived, promises kept vs broken.
- **Squad hall of fame**: your best engineer and the one who got away.
- One LLM-written headline in the satirical tone, e.g. *"Survived three reorgs. Never wrote the quick deck."*
- Rendered client-side to an image (canvas → PNG) and shared via the phone's share sheet where available, or a copied text summary.

### 10.5 Run state in the save
The save holds the whole run: current company and level, Reputation, firing count, rating history, and the squad. Older quarters' logs are summarized into the fact ledger and recap stats so the save stays small.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Runs feel too long, or the ladder too easy | Tune in M5 against targets: ~6 quarters to Director for a strong player; track where runs end |
| Weekly decisions feel like clearing email | Calendar budget, ignoring as a choice, Friday payoff; validated in the M1 playtest |
| Text contradicts effects | Fixed intents per event type, LLM words only, hint tags, causality log |
| LLM output off-tone or defamatory | Guardrail prompt, no real people, situation-level satire, disclaimer, sample-and-review in M4 |
| Proxy abuse without accounts | Fixed `kind`s only, server-built prompts, per-IP limit, workspace spend cap |
| Lost saves (cleared browser) | Export/import; cloud saves in v2 |
| Latency at Continue | One call per week, hidden behind the Friday commentary; templates if slow |

---

## 12. Resolved questions

1. **Name**: EM27.
2. **MVP companies**: Vercel (startup), Stripe (scale-up), Google (big tech).
3. **Audience**: engineers and EMs, so insider jargon is fine.
4. **Progression**: career run to Director at one company; first firing = job hunt setback, second ends the run; poaching offers; recap card in the first release (section 10).
5. **Analytics**: yes. The tool is still to be picked, since Firebase is no longer in v1.
6. **Stack v1**: no Firebase; localStorage saves and a thin LLM proxy.

# EM27 · Championship Manager reference revision

Design package / brief alignment revision 3 / 15 October 2026

## Open the package

Open `index.html` for the interactive prototype or `gallery.html` for exported screens. Neither needs a build or a network connection. `styles.css` holds the reusable UI kit and both themes. `tokens.json` contains portable design tokens. `artwork/` contains editable SVGs and PNG exports. The original brief and technical DESIGN.md are preserved.

The prototype demonstrates flows with fictional fixtures. It is not the Next.js application, a full deterministic game engine, an LLM integration, or an installable PWA. Its save key is `em27.design.v1`, separate from the proposed production save key. Screen selector scenarios alter the sample plan, so reset with New Game when playtesting from scratch. Browser storage must be available for persistence.

## Direction

The user-supplied Championship Manager 01/02 screenshot is the primary visual reference for revision 2. The first version leaned too far into a modern intranet. This revision follows the reference's actual structure: deep blue navigation, purple tabs, saturated red contextual title bars, yellow headings and attribute values, bevelled window chrome, grey translucent rows, and a muted scene behind the data.

The scene is original SVG geometry of an office and server racks, replacing the football photograph while preserving the data-over-scene effect. No original game assets are copied. Player cards use the engineer's name in the red title bar, with Profile/History/Actions tabs and compact attribute sections. The phone keeps the calendar and bottom controls visible. Light mode uses mid-grey surfaces similar to the reference, while dark mode deepens those surfaces without changing the blue/purple/yellow identity.

The visual identity belongs to EM27. Company references use generic two-letter badges and deliberately unrelated colors: VE in a generic game badge, ST in ochre, GO in sage. There are no company logos, portraits or real people.

## Flows

```text
Title → select company → New quarter → Week 1
Saved title → Continue save → exact saved plan

Week ↔ event → choose / replace intent → Week
Week ↔ Squad → player → book/refund 1:1 → Week
Week ↔ Projects → assign engineers / select on-call → Week
Week ↔ Office → inspect Trust / promises / spend capital → Week

Continue + unresolved required item → that event, retaining plan
Continue + required item resolved → lock plan → Friday → Back page
Back page → next Monday → fresh budget, ongoing people and facts
Week 5 back page → week 6 check-in → planning week 6
Week 11 back page → week 12 planning → Friday → Back page → review
Review → rationale → grade → stay / promotion / fired
Stay → next quarter with current squad
Promotion → Senior EM (8 engineers, 9 slots) → Director (win)
First firing → 1–3 job offers → new squad, carried Reputation
Strong quarter → poaching offer → accept / decline / leverage
Director or second firing → portrait recap → share / PNG download
```

The review opens after the completed week 12. The prototype also exposes it directly in the screen selector. The sample weeks can be stepped through, but the people, events and project fixtures repeat: this is not a balanced quarter simulation. The revised brief locks career outcomes: Director wins; the first firing opens a job hunt, the second ends the run. Numeric thresholds and sampled grades remain illustrative.

## Screen specifications and states

| Screen | Content and important states |
|---|---|
| Title / new game | Three company choices, local Continue save, new quarter, parody disclaimer. No sign-in. Eight-slot calendar icon is the game mark. |
| Week | Six sender/subject rows, cost range, explicit required badge, selected and ignored states. The empty state means all demands have decisions, not that the player must fill eight slots. Bookings expose changes and refunds. |
| Event | Full-screen drill-in. Sender, variable-length situation, 2–4 intent buttons, cost and directional hint tags. Selection is a booking, reversible until Continue. Required events show disabled Ignore with a reason. |
| Long event | Four-line title, longer body and choice label. Text wraps, never truncates; cost stays in a separate column aligned to the first line. Scroll reveals further choices. |
| Ignored event | Zero-cost intent, explicit consequence hint, reopen/change available until Friday. Muted text remains readable. |
| Squad | Six rows. Name/level/assignment, COD, DBG, MOR, numeric Energy with a miniature meter. Full labels belong on the player card. |
| Player | Contextual red name header, Profile/History/Actions section tabs, six attributes grouped as skills, drive, condition; hidden Loyalty as `?`, discovered traits, cause log. 1:1 spend/refund and free on-call assignment work. Each player has an illustrative causality fixture; Priya uses the exact brief sample. |
| Projects | Three projects, scope progress, due week, stakeholder, expected-progress tick, assigned names. Separate on-call selector displays Debugging and Energy at the decision point. Team debt/load stay here. |
| Assignment | One engineer per row with Coding/Morale/Energy, current project and selected state. Selecting moves them off the old project. Prototype deselection cycles to another project; production should use explicit “Unassigned” and a projected-delivery preview. |
| Office | Your Stress and Political Capital, three Trust meters, capital actions and promise ledger. Capital deductions in the prototype reserve sample actions; final effects are simulation-owned. |
| Friday | Locked plan, chronological lines, timestamps, mechanical cause captions. Good and bad result fixtures; Show all skips pacing. Slow-copy state offers template text rather than blocking progress. |
| Back page | Newspaper headline and recap; every delta includes an arrow, signed value, subject and causal sentence. Good and bad fixtures. Luck has its own row. |
| Mid-quarter | Week 6, skip-level's voice, directional feedback against the known three review factors, explicit personal focus. No hidden stat bonus. |
| Quarterly review | Week 12, retrospective letter first, “Open your rating” then verdict and rationale. Factor scores and boss adjustment explain the sample rating. The reveal proceeds to stay, promotion or firing. The full five-grade scale is shown. |
| UI kit | Tokens, type, semantic swatches, all attribute values 1–20, intent states, cause rows, meters and badges. Persistent calendar/dock also serve as component specimens. |
| Splash | Centered calendar mark, wordmark, brief tagline; no fake loading progress. Separate light/dark SVG and high-resolution PNG exports. |

### People operations

Hiring, promotion, PIP and dismissal should be deliberate drill-in flows, not one-tap actions beside a 1:1. The prototype exposes unavailable states under People operations. Proposed production shape:

- Promotion: eligibility/evidence → cost and budget availability → preview promise/Trust impacts → book review or return unchanged.
- PIP: recorded causes → expectations and duration → calendar cost and likely morale effect → commit a tracked plan.
- Dismissal: consequence preview (headcount, team morale, project staffing) → explicit dismissal confirmation; require a second deliberate action because it is irreversible in the save.
- Hiring: open requisition → candidate attribute uncertainty → interview booking → Friday evidence → offer decision.

These need final balance and policy choices from the team; they are not implied completed game features.

## The calendar is the board

Eight inset cells at EM, nine at Senior EM, are always in view while planning, including event and player screens. Filled cells use blue and a yellow square mark; empty cells use a dot and inset relief. The text says both booked and remaining time. Color never carries the budget alone.

- **Spend:** selecting an intent fills cells immediately and shows a short status message. In the final app, newly filled cells translate down 2px then settle over 180ms, easing out. No bounce, sound or confetti.
- **Replace:** refund the previous intent first, then apply the new one atomically. A two-slot intent replacing a one-slot intent has a net cost of one.
- **Refund:** 1:1 and focus bookings have explicit Refund actions. Choosing Ignore refunds a non-required intent. Current choice remains readable on the event row.
- **Overbook:** add striped red overflow cells after the eighth. Show overbooked count and Stress implication before Continue. Continue stays available. Above 12 booked slots, production should retain eight cells plus a compact `+N overflow` counter to prevent tiny cells.
- **Commit:** only unresolved must-respond items gate Friday. Unanswered optional items resolve as ignored when the week locks. Players do not have to touch every inbox row.
- **Stress:** production should show the exact engine-computed next-week slot budget in the overbooking notice once balancing is fixed. The prototype uses +5 Stress per excess slot as an explicitly illustrative preview, not an agreed balance rule.

The 24px calendar cells are informational, not buttons. Every app button, including View bookings, is at least 44px high. Main navigation targets are 54px.

## Feedback and Friday pacing

| Moment | Behavior |
|---|---|
| Intent committed | Button gains a selected green-grey tint and checkmark; budget changes; 2.8-second status message confirms cost. Screen does not auto-dismiss, allowing inspection and revision. |
| Navigation | Instant content change. Stable calendar and dock reduce reorientation. No decorative page entrances. |
| Friday | One complete line every 1.6 seconds, 220ms opacity/5px entrance. Incident setup and resolution arrive on separate beats. Pause timer while the page is hidden. Show all is always available. |
| Slow generation | Resolve numeric engine results immediately. Use deterministic template lines if wording misses a ~4-second deadline. Do not add a fake percentage or gate Monday on copy. Swap prose only before its line is shown; never rewrite a line the player already read. |
| Friday failure | Escalation, actual consequence, then why. Red is a signal on result text, not a red full screen. No blame without a cause. |
| Review | Read the boss's rationale, then tap to reveal. Weighted result 82×.4 + 76×.3 + 71×.3 = 76.9; grade thresholds are illustrative. Boss adjustment is shown separately and capped at one step. Follow the grade reveal with an explicit outcome action. Two consecutive Exceeds-or-better quarters plus sufficient Reputation are needed for promotion; Google also needs the packet. Does Not Meet or two consecutive Partially Meets causes firing. |
| Reduced motion | Remove entrances and transforms. Keep paced reading with a persistent Show all option; do not require the animation to understand anything. |

## UI kit and implementation contract

- Body, controls, metadata and numbers: Tahoma/Arial, matching the compact desktop-game reference. Newspaper only: Georgia. No external fonts, image requests or licenses required.
- Base text 14px; event prose 14px; screen headings 21px; red title-bar heading 25px. Metadata 10px is supplemental only. Use comfortable line height 1.45–1.6, headings around 1.1.
- Attribute bands: 1–7 red/low, 8–13 amber/capable, 14–20 yellow-green/strong. The actual number remains visible. Unknown Loyalty is `?`, never a zero or empty bar.
- Layout: 390px reference, 16px gutters, 2px corner radius, 1px keylines, one light edge/one shadow edge. No wide tables. At 320px labels wrap while numeric columns retain alignment.
- Intent layout: flexible copy column plus nonshrinking cost column. Hint text wraps below. Never line-clamp generated content or hide intent costs in tooltips.
- Choice states: default paper, selected green-grey tint/check, keyboard focus outline, pressed 1px translation, unavailable disabled with a nearby reason. Risk and gain use signed text and arrows as well as semantic colors.
- Meters: named accessible meter with min/max/current values; a visible number accompanies small meters. Project expected-progress tick is separately labelled.
- Lists: entire row is tappable; metadata above, subject next, response below. Required tint is exclusive to the one blocking demand; red attribute numbers can still appear elsewhere.
- Explanations: delta, subject, cause and week. Never show an unexplained “Trust −5” toast as the only record.
- Accessibility: native buttons/selects, visible keyboard focus, semantic main/nav, live commitment feedback, reduced-motion CSS. Color and meter contrast still need formal device/a11y validation before release; this package is not a compliance certification.

## PWA artwork

`app-icon.svg` is the editable master. PNG exports include 192px and 512px icons, a 512px maskable variant, and a 180px Apple touch icon. The icon glyph stays inside the central mask-safe area; the deep-blue background runs to every edge. No pre-rounded corners are baked in.

`splash-light.svg` and `splash-dark.svg` use a 390×844 layout exported at 1170×2532. Android will derive launch appearance from icon and manifest; these full-screen compositions are design references and optional iOS startup assets. Additional device sizes can be exported from the SVGs. `manifest.example.json` is a handoff specimen with production-root paths; it is not wired into the prototype. Offline caching, install metadata, and service worker belong to the application implementation.

## Gameplay suggestions

1. **Avoid making “clear inbox” the objective.** Show decided/undecided, not unread guilt. Leave time unspent without punishment; consider low-Stress recovery from spare time, subject to balance testing.
2. **Make overbooking a visible trade.** Tell the player the projected next-week calendar before the lock. Avoid a Stress spiral that makes recovery mathematically impossible; protect a minimum weekly budget.
3. **Let staff breathe.** On-call selection should show Energy and expected delivery loss beside Debugging, so the best debugger is not automatically the best pick every week.
4. **Scouting must change decisions.** A 1:1 should yield useful evidence regularly. Prefer accumulating discovery progress over a long unlucky streak of trait rolls. Keep enough uncertainty for surprise without making time feel wasted.
5. **Free delegation needs a recipient cost.** Show whose Energy or project attention takes the hit. Otherwise zero-slot delegation dominates strategy.
6. **Do not disguise probabilistic outcomes as guarantees.** Directional hints can say “Chance to reveal a trait” or “Project risk.” Friday should isolate variance from the effect of the chosen intent.
7. **Make week 6 actionable.** Preview review weaknesses while there is time to recover. The check-in focus can be a personal reminder rather than an extra resource or secret scoring system.
8. **Reward a good quarter with continuity.** Staying after a good quarter retains squad, promises and history. Poaching offers provide an optional successful move; first firing mandates a new team. Show the cost of leaving before acceptance.
9. **Company differences should alter choices.** The revised brief locks the keynote deadline, incident reviews and promo packets. Expose each mechanic where it changes a decision. These fictional gameplay rules are not claims about the companies.
10. **Playtest comprehension before balance.** Can someone predict the main tradeoff, identify why Friday went wrong, and choose a different plan next week? Then test pace and whether they want week 5.

## Validation and limits

Browser checks exercised required-item gating, net slot spend on choice replacement, refunds, engineer assignment, on-call selection, Friday skipping, back-page routing, next-week reset and saved-plan reload. All 35 selectable states were checked in both themes at 320px and 390px: no horizontal overflow and no app buttons below 44px. Both quarterly review states are exported. Screen PNGs use 390×844 artboards; longer content is intentionally scrollable, with supplementary lower-content exports where needed.

These checks validate this prototype, not the production engine. Simulated results, grade boundaries, exact Stress penalties, people-operation flows and production career resolution require implementation and playtesting. No server calls, deployment, analytics, sound or account work are included.


## Revised brief: career and company requirements

- **Career entry:** Office → Career record. Level, Reputation, firing count and rating history fit within the existing four-tab navigation.
- **Review outcomes:** Separate stay, promotion and firing fixtures. Stay starts the next quarter with the same squad and promises. Promotion moves EM to Senior EM with 8 engineers, 9 slots and 4 projects. Director ends the run. Current grade fixtures do not calculate eligibility from a production engine.
- **Reputation:** Career-long, displayed in Office, career record and job hunt. Firings lower it; it influences whether the next offer is at the same or one lower level. The prototype's 40-point boundary is a sample, not a locked balance number.
- **First firing:** Job hunt lists two sample offers from the other companies, within the brief's 1–3 range. A weaker Senior EM receives an EM offer. Promotion progress resets; Reputation carries over. Acceptance shows farewells before entering a new fictional squad. Career fields and that squad are saved locally.
- **Second firing:** Goes to the loss recap instead of another hunt. A Partially Meets warning and streak belong in the production career record; a second consecutive occurrence must use this same firing branch.
- **Poaching:** Letter includes a company badge, level, team size, project count, calendar and fictional salary. Accept leaves the squad; decline stays with a Loyalty boost; leverage previews Political Capital/headcount, boss Trust risk and possible backfire. Only sample effects are shown, not a full probabilistic resolver.
- **Recap:** Win and loss variants, career path, grades, quarters, projects, incidents, promises and squad hall of fame. Runtime canvas produces a 1080×1920 PNG. Native sharing passes a file to the share sheet; unsupported environments copy a summary or download the PNG. Nothing is auto-published. Export totals are deliberately labelled fictional fixtures.
- **Vercel:** Fixed week-8 keynote in the fixture, permanently visible countdown in the company strip. Continue in week 8 routes to on-stage Friday. Shipping increases Reputation; missing is public. The fixture shows the successful sequence and explains the missed-stage state.
- **Stripe:** Postmortem follow-up inbox item; 1-slot booking and refund. Clear stakes: double incident Trust cost, next-week review halves it, ignoring raises the next incident's cost. Final Trust values remain simulation-owned.
- **Google:** Personal packet meter plus an engineer packet example, launch/cross-team evidence provenance, and explicit calibration verdict in the quarterly review. Evidence targets of 10 and 8 in these screens are illustrative.

The company strip stays visible across planning screens. Company mechanics, career progression and recap are MVP requirements, no longer future proposals. The package remains a design prototype rather than an implemented career simulator.

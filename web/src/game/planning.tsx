"use client";

import { useState } from "react";
import { COMPANIES, KEYNOTE_WEEK, PACKET_TARGET } from "@/content/companies";
import { expectedProgress } from "@/content/events";
import { TRAIT_LABEL } from "@/content/people";
import { engineerOutput } from "@/engine/resolve";
import { forecastAll, forecastLabel, forecastMove, forecastTone, type Forecast } from "@/engine/forecast";
import {
  assign,
  blockingItem,
  CAPITAL_ACTIONS,
  capitalCommitted,
  choose,
  ignoreRest,
  intentCost,
  planCost,
  projectedCapacity,
  projectedStress,
  setOncall,
  toggleFocus,
  toggleOneOnOne,
  toggleSpend,
  undecided,
} from "@/engine/plan";
import type { AttrKey, GameState, InboxItem } from "@/engine/types";
import { exportSave, importSave } from "./save";
import { Badge, Btn, first, HintChips, initials, Meter, Num } from "./ui";

export type View =
  | { name: "week" }
  | { name: "event"; itemId: string }
  | { name: "squad" }
  | { name: "player"; id: string }
  | { name: "projects" }
  | { name: "assign"; projectId: string }
  | { name: "office" }
  | { name: "career" }
  | { name: "packet" };

export interface ScreenProps {
  s: GameState;
  set: (s: GameState) => void;
  go: (v: View) => void;
  toast: (m: string) => void;
}

const costRange = (item: InboxItem) => {
  const costs = item.intents.map((i) => i.cost);
  const lo = item.required ? Math.min(...costs) : 0;
  const hi = Math.max(...costs);
  return lo === hi ? `${hi} slot${hi === 1 ? "" : "s"}` : `${lo}–${hi} slots`;
};
const slots = (n: number) => `${n} slot${n === 1 ? "" : "s"}`;

/* ---------------- Week ---------------- */

/** One line connecting Monday to last Friday: what changed most, and why. */
function SinceFriday({ s }: { s: GameState }) {
  const w = s.lastWeek;
  if (!w || w.quarter !== s.quarter || w.week !== s.week - 1) return null;
  const projects = w.projects ?? [];
  const events = [
    ...w.causes.filter((c) => c.subject.endsWith(" left the team")).map((c) => c.subject),
    ...projects.filter((p) => p.status === "shipped" || p.status === "late-shipped").map((p) => `${p.name} shipped`),
    ...projects.filter((p) => p.status === "missed").map((p) => `${p.name} missed its date`),
    ...projects.filter((p) => p.status === "active" && p.gain === 0).map((p) => `${p.name} stalled`),
  ];
  const biggest = [...w.causes]
    .filter((c) => !c.subject.endsWith("progress") && !c.subject.endsWith(" left the team"))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, events.length ? 1 : 2)
    .map((c) => `${c.subject} ${c.delta > 0 ? "+" : "−"}${Math.abs(c.delta)}`);
  const parts = [...events, ...biggest];
  if (!parts.length) return null;
  return (
    <p className="since-friday">
      <b>Since Friday:</b> {parts.join(" · ")}
    </p>
  );
}

export function WeekScreen({ s, set, go, toast, directorStatus }: ScreenProps & { directorStatus?: string }) {
  const used = planCost(s);
  const open = undecided(s);
  const optionalOpen = open.filter((i) => !i.required).length;
  const allDecided = open.length === 0;
  const unstaffed = s.projects.filter((p) => p.status === "active" && !s.engineers.some((e) => e.projectId === p.id));
  return (
    <>
      <div className="heading">
        <h1>The week ahead.</h1>
        <small>MONDAY</small>
      </div>
      <p className="subtitle">
        {s.inbox.length} demands. {s.capacity} slots. Something has to give.
      </p>
      <SinceFriday s={s} />
      {unstaffed.length > 0 && (
        <button type="button" className="notice danger notice-button" onClick={() => go({ name: "projects" })}>
          <b>
            {unstaffed.map((p) => p.name).join(" and ")} {unstaffed.length > 1 ? "have" : "has"} nobody on {unstaffed.length > 1 ? "them" : "it"}.
          </b>
          <p>No progress this week. Staff it on Projects →</p>
        </button>
      )}
      {used > s.capacity && (
        <div className="notice danger">
          <b>Overbooked by {slots(used - s.capacity)}.</b>
          <p>
            You can continue. Stress will be {projectedStress(s)} and next week’s calendar {projectedCapacity(s)} slots. Refund a booking below to
            recover time.
          </p>
        </div>
      )}
      {allDecided && (
        <div className="notice success">
          <b>Decisions made.</b>
          <p>Every demand has a decision. You do not have to fill every slot. Review staffing, then let the week play out.</p>
        </div>
      )}
      <div className="section-head">
        <span>INBOX / {s.inbox.length} DEMANDS</span>
        <span>{open.length} UNDECIDED</span>
      </div>
      <div className="panel">
        {s.inbox.map((item) => {
          const c = s.plan.choices[item.id];
          const intent = item.intents.find((i) => i.id === c);
          return (
            <button
              type="button"
              key={item.id}
              className={`inbox-row ${item.required && !c ? "required" : ""} ${intent ? "done" : ""} ${c === "ignore" ? "ignored" : ""}`}
              onClick={() => go({ name: "event", itemId: item.id })}
            >
              <span className="row-meta">
                <span>{item.from}</span>
                <span>{c === "ignore" ? "0 slots" : intent ? slots(intent.cost) : costRange(item)}</span>
              </span>
              <span className="row-title">{item.title}</span>
              <span className="row-tags">
                {item.required && !c
                  ? "! MUST RESPOND"
                  : c === "ignore"
                    ? "↷ IGNORED · resolves Friday"
                    : intent
                      ? `✓ ${intent.label}`
                      : item.cat}
              </span>
            </button>
          );
        })}
      </div>
      {optionalOpen > 0 && (
        <Btn
          onClick={() => {
            set(ignoreRest(s));
            toast(`${optionalOpen} demand${optionalOpen === 1 ? "" : "s"} ignored · resolve${optionalOpen === 1 ? "s" : ""} Friday · reversible until Continue`);
          }}
        >
          ↷ Ignore the other {optionalOpen} undecided · 0 slots
        </Btn>
      )}
      <DirectorPanel s={s} status={directorStatus} />
      <Agenda s={s} set={set} go={go} toast={toast} />
      {s.company === "Google" && <Btn onClick={() => go({ name: "packet" })}>Inspect promotion packet →</Btn>}
      <p className="save-status">✓ Plan saved on this device</p>
    </>
  );
}

/** Debug view: who chose this week's demands, and why. Collapsed by default. */
function DirectorPanel({ s, status }: { s: GameState; status?: string }) {
  const byDirector = s.inboxSource.by === "director";
  return (
    <details className="director-panel">
      <summary>{byDirector ? "◆ Debug: picked by the AI director · why?" : "◇ Debug: random draw this week · details"}</summary>
      {byDirector ? (
        <>
          {s.inboxSource.arcNote && (
            <p className="helper">
              <b>Director’s note:</b> {s.inboxSource.arcNote}
            </p>
          )}
          <div className="panel">
            {s.inbox
              .filter((i) => i.why)
              .map((i) => (
                <div className="why" key={i.id}>
                  <b>{i.title}</b>
                  <small>{i.why}</small>
                </div>
              ))}
          </div>
        </>
      ) : (
        <p className="helper">
          {status ||
            (s.week === 1
              ? "The first week of a quarter is always a random draw."
              : "The AI director didn’t pick this week, so the game used its weighted random draw.")}
        </p>
      )}
    </details>
  );
}

function Agenda({ s, set, go, toast }: ScreenProps) {
  const booked = s.inbox.filter((i) => intentCost(i, s.plan.choices[i.id]) > 0);
  return (
    <div id="agenda">
      <div className="section-head">
        <span>BOOKED TIME</span>
        <span>
          {planCost(s)} / {s.capacity}
        </span>
      </div>
      <div className="panel">
        {booked.map((i) => (
          <div className="agenda-row" key={i.id}>
            <span>
              {i.title} · {slots(intentCost(i, s.plan.choices[i.id]))}
            </span>
            <button type="button" onClick={() => go({ name: "event", itemId: i.id })}>
              Change
            </button>
          </div>
        ))}
        {s.plan.oneOnOnes.map((id) => {
          const e = s.engineers.find((x) => x.id === id);
          return (
            <div className="agenda-row" key={id}>
              <span>1:1 · {e?.name} · 1 slot</span>
              <button
                type="button"
                onClick={() => {
                  set(toggleOneOnOne(s, id));
                  toast("1:1 removed · 1 slot refunded");
                }}
              >
                Refund
              </button>
            </div>
          );
        })}
        {s.plan.focus && (
          <div className="agenda-row">
            <span>Focus time · 1 slot</span>
            <button
              type="button"
              onClick={() => {
                set(toggleFocus(s));
                toast("Focus time refunded · 1 slot returned");
              }}
            >
              Refund
            </button>
          </div>
        )}
        {planCost(s) === 0 && <div className="agenda-row">Your calendar is clear. For now.</div>}
      </div>
      {!s.plan.focus && (
        <Btn
          onClick={() => {
            set(toggleFocus(s));
            toast("Focus time booked · Stress ↓");
          }}
        >
          ＋ Book focus time · 1 slot
        </Btn>
      )}
    </div>
  );
}

/* ---------------- Event ---------------- */

export function EventScreen({ s, set, go, toast, itemId }: ScreenProps & { itemId: string }) {
  const index = s.inbox.findIndex((i) => i.id === itemId);
  const item = s.inbox[index];
  if (!item) return <WeekScreen s={s} set={set} go={go} toast={toast} />;
  const selected = s.plan.choices[item.id];
  const remaining = undecided(s).filter((i) => i.id !== item.id);
  // Callbacks: remind the player what they already promised this person.
  const promises = item.subjectId && item.type !== "promise_due" ? s.facts.filter((f) => f.status === "open" && f.subjectId === item.subjectId) : [];
  const pick = (choice: string) => {
    const before = planCost(s);
    const next = choose(s, item.id, choice);
    set(next);
    const after = planCost(next);
    toast(
      choice === "ignore"
        ? "Ignored · resolves Friday"
        : `${after > before ? "Booked" : "Plan updated"} · ${after}/${s.capacity} slots${after > s.capacity ? " · overbooking adds Stress" : ""}`,
    );
  };
  return (
    <>
      <Btn kind="back" onClick={() => go({ name: "week" })}>
        ← Back to week
      </Btn>
      <div className="split">
        <span className="eyebrow">
          {item.cat} / {index + 1} OF {s.inbox.length}
        </span>
        {item.required && <span className="mini bad">! MUST RESPOND</span>}
      </div>
      <div className="sender">
        <span className="avatar">{initials(item.from)}</span>
        <div>
          <b>{item.from}</b>
          <small>{item.fromRole}</small>
        </div>
      </div>
      <h1>{item.title}</h1>
      <p className="situation">{item.body}</p>
      {promises.map((f) => (
        <p className="context-line" key={f.id}>
          ↺ You promised: {f.text} Due week {f.dueWeek}.
        </p>
      ))}
      <div className="section-head">
        <span>CHOOSE YOUR INTENT</span>
        <span>COST / HINTS</span>
      </div>
      {item.intents.map((intent) => (
        <button
          type="button"
          key={intent.id}
          className={`intent ${selected === intent.id ? "selected" : ""}`}
          aria-pressed={selected === intent.id}
          onClick={() => pick(intent.id)}
        >
          <span className="intent-main">
            <span>
              {selected === intent.id ? "✓ " : ""}
              {intent.label}
            </span>
            <span className="cost">{slots(intent.cost)}</span>
          </span>
          <HintChips hints={intent.hints} />
        </button>
      ))}
      <button
        type="button"
        className={`intent ignore ${selected === "ignore" ? "selected" : ""}`}
        disabled={item.required}
        aria-pressed={selected === "ignore"}
        onClick={() => pick("ignore")}
      >
        <span className="intent-main">
          <span>{item.required ? "Ignore unavailable · must respond" : `${selected === "ignore" ? "✓ " : "↷ "}Ignore this demand`}</span>
          <span className="cost">0 slots</span>
        </span>
        <HintChips hints={item.ignoreHint} />
      </button>
      <p className="helper">
        {selected ? "Booked. You can change it until Continue; switching refunds the old cost. " : ""}Hints show direction, not exact numbers. Green helps you, red hurts. Numbers resolve on Friday.
      </p>
      {selected &&
        (remaining.length ? (
          <>
            <Btn kind="primary" onClick={() => go({ name: "event", itemId: remaining[0].id })}>
              Next demand · {remaining.length} undecided →
            </Btn>
            <Btn onClick={() => go({ name: "week" })}>Back to inbox</Btn>
          </>
        ) : (
          <Btn kind="primary" onClick={() => go({ name: "week" })}>
            All decided · back to inbox →
          </Btn>
        ))}
    </>
  );
}

/* ---------------- Squad ---------------- */

export function SquadScreen({ s, go }: ScreenProps) {
  const max = s.level === "Senior EM" ? 8 : 6;
  const tired = [...s.engineers].sort((a, b) => a.attrs.energy - b.attrs.energy)[0];
  const projectName = (id: string | null) => s.projects.find((p) => p.id === id)?.name ?? "Unassigned";
  return (
    <>
      <div className="heading">
        <h1>Your squad.</h1>
        <small>
          {s.engineers.length} / {max} ENGINEERS
        </small>
      </div>
      <p className="subtitle">Know your people. Especially the quiet ones.</p>
      <div className="roster-head">
        <span>ENGINEER / ASSIGNMENT</span>
        <span>COD</span>
        <span>DBG</span>
        <span>MOR</span>
        <span>ENG</span>
      </div>
      <div className="panel">
        {s.engineers.map((e) => (
          <button type="button" className="engineer" key={e.id} onClick={() => go({ name: "player", id: e.id })}>
            <span className="person">
              {e.name}
              <small>
                L{e.level} · {projectName(e.projectId)}
                {s.plan.oncallId === e.id ? " · ON CALL" : ""}
                {s.plan.oneOnOnes.includes(e.id) ? " · 1:1" : ""}
              </small>
            </span>
            <Num v={e.attrs.coding} />
            <Num v={e.attrs.debugging} />
            <Num v={e.attrs.morale} />
            <span className="energy">
              {e.attrs.energy}
              <i>
                <b style={{ width: `${e.attrs.energy * 5}%` }} />
              </i>
            </span>
          </button>
        ))}
      </div>
      <div className="section-head">
        <span>READING THE NUMBERS</span>
        <span>1–20</span>
      </div>
      <p className="helper">
        <span className="bad">1–7 low</span> · <span className="warn">8–13 capable</span> · <span className="good">14–20 strong</span>
        <br />
        Tap an engineer for their full attributes and history.
      </p>
      {tired && tired.attrs.energy <= 8 && (
        <div className="notice">
          <b>
            {first(tired.name)}’s energy is {tired.attrs.energy}/20.
          </b>
          <p>On-call duty drains Energy. Check Projects before locking the rotation.</p>
        </div>
      )}
    </>
  );
}

const ATTRS: { key: AttrKey; label: string; group?: string }[] = [
  { key: "coding", label: "Coding", group: "Skills" },
  { key: "debugging", label: "Debugging" },
  { key: "communication", label: "Communication" },
  { key: "ambition", label: "Ambition", group: "Drive" },
  { key: "morale", label: "Morale", group: "Condition" },
  { key: "energy", label: "Energy" },
];

export function PlayerScreen({ s, set, go, toast, id }: ScreenProps & { id: string }) {
  const e = s.engineers.find((x) => x.id === id);
  if (!e) return <SquadScreen s={s} set={set} go={go} toast={toast} />;
  const booked = s.plan.oneOnOnes.includes(e.id);
  const scroll = (target: string) => document.getElementById(target)?.scrollIntoView({ block: "start", behavior: "smooth" });
  const promises = s.facts.filter((f) => f.subjectId === e.id && f.status === "open");
  return (
    <>
      <Btn kind="back" onClick={() => go({ name: "squad" })}>
        ← Squad
      </Btn>
      <nav className="profile-tabs" aria-label="Player sections">
        <button type="button" className="selected" onClick={() => document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" })}>
          Profile
        </button>
        <button type="button" onClick={() => scroll("player-history")}>
          History
        </button>
        <button type="button" onClick={() => scroll("player-actions")}>
          Actions
        </button>
      </nav>
      <p className="player-meta">
        L{e.level} · {e.level >= 5 ? "Senior Engineer" : "Engineer"} · {e.tenure} tenure
      </p>
      <p className="subtitle">{e.bio}</p>
      <div className="panel">
        {ATTRS.map((a) => (
          <div key={a.key}>
            {a.group && <div className="attr-group">{a.group}</div>}
            <div className="attr">
              <span>{a.label}</span>
              <Num v={e.attrs[a.key]} />
            </div>
          </div>
        ))}
        <div className="attr-group">Scouting</div>
        <div className="attr">
          <span>Loyalty</span>
          <Num v={e.loyaltyKnown ? e.loyalty : "?"} />
        </div>
      </div>
      <p className="helper">{e.loyaltyKnown ? "Loyalty discovered through 1:1s." : "Loyalty stays hidden until discovered through 1:1s."}</p>
      <div className="section-head">
        <span>DISCOVERED TRAITS</span>
        <span>{e.scout} 1:1s</span>
      </div>
      {e.revealed.length ? (
        e.revealed.map((t) => (
          <span className="trait" key={t}>
            {TRAIT_LABEL[t]}
          </span>
        ))
      ) : (
        <span className="trait">No traits discovered</span>
      )}
      {promises.length > 0 && (
        <>
          <div className="section-head">
            <span>YOU OWE</span>
          </div>
          {promises.map((f) => (
            <div className="panel promise" key={f.id}>
              <b>{f.text}</b>
              <p>
                Promised week {f.createdWeek} · Due week {f.dueWeek}
              </p>
            </div>
          ))}
        </>
      )}
      <div className="section-head">
        <span id="player-history">WHY THESE NUMBERS?</span>
      </div>
      <div className="panel">
        {e.log.length ? (
          e.log.map((c, i) => (
            <div className="why" key={i}>
              <b className={c.delta > 0 ? "good" : "bad"}>
                {c.subject.replace(`${first(e.name)}’s `, "")} {c.delta > 0 ? `+${c.delta}` : `−${Math.abs(c.delta)}`}
              </b>
              <small>
                {c.why} · Q{c.quarter} week {c.week}
              </small>
            </div>
          ))
        ) : (
          <div className="why">
            <b>No changes yet</b>
            <small>Every change to these numbers will show its cause here.</small>
          </div>
        )}
      </div>
      <div className="section-head">
        <span id="player-actions">ACTIONS</span>
        <span>UNTIL CONTINUE</span>
      </div>
      <button
        type="button"
        className={`intent ${booked ? "selected" : ""}`}
        aria-pressed={booked}
        onClick={() => {
          set(toggleOneOnOne(s, e.id));
          toast(booked ? "1:1 removed · 1 slot refunded" : "1:1 booked · 1 slot spent");
        }}
      >
        <span className="intent-main">
          <span>{booked ? "✓ 1:1 booked · tap to refund" : "Book a 1:1"}</span>
          <span className="cost">1 slot</span>
        </span>
        <HintChips hints="Morale ↑ · Reveals a trait or Loyalty" />
      </button>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          set(setOncall(s, e.id));
          toast("On-call rotation updated · no slots spent");
        }}
      >
        {s.plan.oncallId === e.id ? "✓ On call this week" : "Set on call · 0 slots"}
      </button>
      <details>
        <summary style={{ minHeight: 44, padding: "12px 0", color: "var(--muted)", fontSize: 12, cursor: "pointer" }}>People operations</summary>
        <p className="helper">Promotion, PIP, hiring and dismissal need budget, evidence and a deliberate review. They arrive in a later build.</p>
        <button type="button" className="secondary" disabled>
          Promote · review flow not built yet
        </button>
        <button type="button" className="secondary" disabled>
          PIP · review flow not built yet
        </button>
        <button type="button" className="secondary" disabled>
          Dismiss · review flow not built yet
        </button>
      </details>
    </>
  );
}

/* ---------------- Projects ---------------- */

export function ProjectsScreen({ s, set, go, toast }: ScreenProps) {
  const activeCount = s.projects.filter((p) => p.status === "active").length;
  const oncall = s.engineers.find((e) => e.id === s.plan.oncallId);
  const forecasts = forecastAll(s);
  return (
    <>
      <div className="heading">
        <h1>Delivery desk.</h1>
        <small>{activeCount} ACTIVE</small>
      </div>
      <p className="subtitle">The deadline is a date. The estimate is a belief.</p>
      <div className="panel">
        {s.projects.map((p) => {
          const pct = Math.round((p.progress / p.scope) * 100);
          const expected = Math.round((expectedProgress(p, s.week) / p.scope) * 100);
          const team = s.engineers.filter((e) => e.projectId === p.id);
          const f = forecasts[p.id];
          const owner = s.stakeholders.find((x) => x.role === p.owner)!;
          return (
            <section className="project" key={p.id}>
              <div className="split">
                <h2>
                  {p.name}
                  {p.flagship && s.company === "Vercel" ? " ★" : ""}
                </h2>
                <span className="mini">DUE WK {p.dueWeek}</span>
              </div>
              <p className={`forecast ${forecastTone(f)}`}>{forecastLabel(f)}</p>
              <div className="meter" role="meter" aria-label={`${p.name} progress`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <b style={{ width: `${pct}%` }} />
                {p.status === "active" && <span className="deadline" style={{ left: `${expected}%` }} title="Where it should be by now" />}
              </div>
              <div className="split project-meta">
                <span>
                  {p.progress}/{p.scope} pts{p.status === "active" ? ` · ~${f.weekly}/wk` : ""}
                </span>
                <span>
                  {owner.name.split(" ")[0]} · {p.owner === "pm" ? "PM" : p.owner === "skip" ? "Skip-level" : "Peer EM"}
                </span>
              </div>
              {p.status === "active" && (
                <button type="button" onClick={() => go({ name: "assign", projectId: p.id })}>
                  {team.map((e) => first(e.name)).join(" + ") || "Nobody assigned"} · Edit staffing →
                </button>
              )}
            </section>
          );
        })}
      </div>
      {s.engineers.some((e) => !e.projectId) && (
        <div className="notice">
          <b>Resting: {s.engineers.filter((e) => !e.projectId).map((e) => first(e.name)).join(", ")}.</b>
          <p>Resting engineers add no progress but recover +2 Energy a week.</p>
        </div>
      )}
      <div className="section-head">
        <span>ON-CALL ROTATION</span>
        <span>THIS WEEK</span>
      </div>
      <div className="panel project">
        <label htmlFor="oncall">Primary engineer</label>
        <select
          id="oncall"
          className="inline-select"
          value={s.plan.oncallId ?? ""}
          onChange={(ev) => {
            set(setOncall(s, ev.target.value));
            toast("On-call rotation updated · no slots spent");
          }}
        >
          {!s.plan.oncallId && <option value="">Nobody (risky)</option>}
          {s.engineers.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · Debugging {e.attrs.debugging} · Energy {e.attrs.energy}
            </option>
          ))}
        </select>
        <p className="helper">
          {oncall ? `On call: ${oncall.name}.` : "Nobody is on call: every incident escalates to you."} Cost: −1 Energy a week, −1 to −4 more if the pager fires. Higher Debugging fixes incidents faster.
        </p>
      </div>
      <div className="section-head">
        <span>TEAM SYSTEMS</span>
      </div>
      <div className="panel">
        <div className="trust">
          <div className="score-line">
            <span>Tech Debt</span>
            <b className={s.techDebt >= 50 ? "bad" : "warn"}>{s.techDebt} / 100</b>
          </div>
          <Meter value={s.techDebt} label="Tech Debt" />
          <p className="mini">Slows progress · raises incident risk</p>
        </div>
        <div className="trust">
          <div className="score-line">
            <span>On-call Load</span>
            <b className={s.oncallLoad >= 50 ? "bad" : "warn"}>{s.oncallLoad} / 100</b>
          </div>
          <Meter value={s.oncallLoad} label="On-call Load" />
          <p className="mini">Raises incident risk · drains the on-call engineer</p>
        </div>
      </div>
      {s.company === "Vercel" && (
        <div className="notice">
          <b>Flagship: {s.projects.find((p) => p.flagship)?.name}</b>
          <p>Must ship on stage in week {KEYNOTE_WEEK}. This date cannot be negotiated.</p>
        </div>
      )}
      {s.company === "Google" && <Btn onClick={() => go({ name: "packet" })}>View evidence packet →</Btn>}
    </>
  );
}

export function AssignScreen({ s, set, go, toast, projectId }: ScreenProps & { projectId: string }) {
  const p = s.projects.find((x) => x.id === projectId);
  if (!p) return <ProjectsScreen s={s} set={set} go={go} toast={toast} />;
  const name = (id: string | null) => s.projects.find((x) => x.id === id)?.name ?? "";
  const finish = (fc: Forecast) => (fc.finishWeek === null ? "never finishes" : fc.finishWeek > 12 ? "not this quarter" : `done wk ${fc.finishWeek}`);
  const now = forecastAll(s)[p.id];
  const groups: { title: string; people: typeof s.engineers }[] = [
    { title: `ON ${p.name.toUpperCase()}`, people: s.engineers.filter((e) => e.projectId === p.id) },
    { title: "ON OTHER PROJECTS", people: s.engineers.filter((e) => e.projectId && e.projectId !== p.id) },
    { title: "RESTING · +2 ENERGY/WK", people: s.engineers.filter((e) => !e.projectId) },
  ];
  return (
    <>
      <Btn kind="back" onClick={() => go({ name: "projects" })}>
        ← Projects
      </Btn>
      <h1>Staff {p.name}.</h1>
      <p className={`forecast ${forecastTone(now)}`}>Now: {forecastLabel(now)}</p>
      <p className="subtitle">Each engineer works on one project. Moving someone is free, but the project they leave slows down.</p>
      {groups.map((g) =>
        g.people.length ? (
          <div key={g.title}>
            <div className="section-head">
              <span>{g.title}</span>
            </div>
            <div className="panel">
              {g.people.map((e) => {
                const here = e.projectId === p.id;
                const target = here ? null : p.id;
                const after = forecastMove(s, e.id, target);
                const preview = here
                  ? `Rest them: ${p.name} ${finish(after[p.id])} (due ${p.dueWeek})`
                  : `${p.name} ${finish(after[p.id])} (due ${p.dueWeek})${e.projectId ? ` · ${name(e.projectId)} ${finish(after[e.projectId])} (due ${s.projects.find((x) => x.id === e.projectId)!.dueWeek})` : ""}`;
                const late = here
                  ? after[p.id].kind !== "on-track"
                  : after[p.id].kind !== "on-track" || (!!e.projectId && after[e.projectId].kind !== "on-track");
                return (
                  <button
                    type="button"
                    key={e.id}
                    className={`intent staff-row ${here ? "selected" : ""}`}
                    aria-pressed={here}
                    onClick={() => {
                      set(assign(s, e.id, target));
                      toast(here ? `${first(e.name)} is resting · +2 Energy/wk` : `${first(e.name)} moved to ${p.name}`);
                    }}
                  >
                    <span className="intent-main">
                      <span>
                        {here ? "✓ " : ""}
                        {e.name}
                      </span>
                      <span className="cost">~{Math.round(engineerOutput(e, s.techDebt))} pts/wk</span>
                    </span>
                    <span className="staff-stats">
                      Coding <Num v={e.attrs.coding} /> Morale <Num v={e.attrs.morale} /> Energy <Num v={e.attrs.energy} />
                    </span>
                    <span className={`staff-preview ${late ? "bad" : "good"}`}>
                      {here ? "Tap to rest · " : "Tap to move here · "}
                      {preview}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null,
      )}
      <Btn kind="primary" onClick={() => go({ name: "projects" })}>
        Done · review projects →
      </Btn>
    </>
  );
}

/* ---------------- Office ---------------- */

export function OfficeScreen({
  s,
  set,
  go,
  toast,
  onNewGame,
  onTheme,
  onHowTo,
}: ScreenProps & { onNewGame: () => void; onTheme: () => void; onHowTo: () => void }) {
  const [confirmNew, setConfirmNew] = useState(false);
  const [importText, setImportText] = useState("");
  const free = s.capital - capitalCommitted(s);
  const promises = s.facts.filter((f) => f.kind === "promise" && f.status === "open");
  // Promises chosen this week, before Friday locks them in.
  const pending = s.inbox.flatMap((item) => {
    const intent = item.intents.find((i) => i.id === s.plan.choices[item.id]);
    return (intent?.effects ?? []).flatMap((ef) => (ef.k === "promise" ? [{ id: `${item.id}-${ef.text}`, text: ef.text, due: Math.min(12, s.week + ef.dueIn) }] : []));
  });
  return (
    <>
      <div className="panel career-strip">
        <span>
          {s.level} · Q{s.quarter}
        </span>
        <b>Reputation {s.reputation}</b>
        <span>Firings {s.firings}/2</span>
      </div>
      <Btn onClick={() => go({ name: "career" })}>Career record & rating history →</Btn>
      <div className="heading">
        <h1>Office politics.</h1>
        <small>3 STAKEHOLDERS</small>
      </div>
      <p className="subtitle">Everyone is aligned. In different directions.</p>
      <div className="stat-pair">
        <div>
          <span className="eyebrow">YOUR STRESS</span>
          <b className={s.stress >= 70 ? "bad" : "warn"}>
            {s.stress}
            <small className="mini"> / 100</small>
          </b>
        </div>
        <div>
          <span className="eyebrow">POLITICAL CAPITAL</span>
          <b>
            {free}
            <small className="mini"> PC</small>
          </b>
        </div>
      </div>
      <p className="helper">
        Stress 70+ costs a slot next week, 90+ costs two. With this plan: Stress {projectedStress(s)}, next week {projectedCapacity(s)} slots.
      </p>
      <div className="section-head">
        <span>STAKEHOLDER TRUST</span>
        <span>0–100</span>
      </div>
      <div className="panel">
        {s.stakeholders.map((x) => (
          <div className="trust" key={x.role}>
            <div className="score-line">
              <b>{x.name}</b>
              <span className={`num ${x.trust < 40 ? "bad" : x.trust < 60 ? "warn" : "good"}`}>{x.trust}</span>
            </div>
            <p className="helper">
              {x.role === "skip" ? "Skip-level" : x.role === "pm" ? "PM" : "Peer EM"} · “{x.quote}”
            </p>
            <Meter value={x.trust} label={`${x.name} Trust`} />
          </div>
        ))}
      </div>
      <div className="section-head">
        <span>SPEND YOUR CAPITAL</span>
        <span>{free} PC FREE</span>
      </div>
      {CAPITAL_ACTIONS.map((a) => {
        const on = s.plan.spend.includes(a.id);
        const reason = a.available(s) ?? (free < a.cost && !on ? `Needs ${a.cost} PC` : null);
        return (
          <button
            type="button"
            key={a.id}
            className={`intent ${on ? "selected" : ""}`}
            disabled={!!reason && !on}
            aria-pressed={on}
            onClick={() => {
              set(toggleSpend(s, a.id));
              toast(on ? `${a.cost} PC returned` : `${a.cost} PC committed · applies Friday`);
            }}
          >
            <span className="intent-main">
              <span>
                {on ? "✓ " : ""}
                {a.label}
              </span>
              <span className="cost">{a.cost} PC</span>
            </span>
            {reason && !on ? <span className="intent-hints">{reason}</span> : <HintChips hints={a.hints} />}
          </button>
        );
      })}
      <div className="section-head">
        <span>YOU OWE</span>
        <span>FACT LEDGER</span>
      </div>
      {pending.map((f) => (
        <div className="panel promise" key={f.id}>
          <b>{f.text}</b>
          <p>Promising this week · Due week {f.due} · Locks in on Friday</p>
        </div>
      ))}
      {promises.length || pending.length ? (
        promises.map((f) => (
          <div className="panel promise" key={f.id}>
            <b>{f.text}</b>
            <p>
              Promised week {f.createdWeek} · Due week {f.dueWeek} · Open
            </p>
          </div>
        ))
      ) : (
        <p className="helper">No open promises. Promises you make come due as inbox items.</p>
      )}
      <div className="section-head">
        <span>YOUR SAVE</span>
        <span>THIS DEVICE</span>
      </div>
      <Btn
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(exportSave(s));
            toast("Save code copied. Paste it here on another device.");
          } catch {
            setImportText(exportSave(s));
            toast("Copy blocked. The save code is in the box below.");
          }
        }}
      >
        Copy save code
      </Btn>
      <label htmlFor="import-save" className="helper" style={{ display: "block", marginTop: 8 }}>
        Paste a save code to load it
      </label>
      <textarea
        id="import-save"
        value={importText}
        onChange={(ev) => setImportText(ev.target.value)}
        rows={2}
        style={{ width: "100%", font: "11px monospace" }}
      />
      <Btn
        disabled={!importText.trim()}
        onClick={() => {
          const loaded = importSave(importText);
          if (!loaded) return toast("That save code didn’t load. Check it was copied in full.");
          set(loaded);
          setImportText("");
          go({ name: "week" });
          toast("Save loaded");
        }}
      >
        Load save code
      </Btn>
      <Btn onClick={onHowTo}>How to play</Btn>
      <Btn onClick={onTheme}>Switch light / dark theme ◐</Btn>
      {!confirmNew ? (
        <Btn onClick={() => setConfirmNew(true)}>Start a new career…</Btn>
      ) : (
        <div className="notice danger">
          <b>Start over?</b>
          <p>This replaces the career saved on this device. Copy the save code first if you want to keep it.</p>
          <Btn kind="primary" onClick={onNewGame}>
            Yes, start a new career
          </Btn>
          <Btn onClick={() => setConfirmNew(false)}>Keep playing</Btn>
        </div>
      )}
    </>
  );
}

export function CareerScreen({ s, go }: ScreenProps) {
  return (
    <>
      <h1>Your career.</h1>
      <div className="panel">
        <div className="attr">
          <b>Level</b>
          <span>{s.level}</span>
        </div>
        <div className="attr">
          <b>Reputation</b>
          <span className="num">{s.reputation}</span>
        </div>
        <div className="attr">
          <b>Firings</b>
          <span>{s.firings} / 2 ends the run</span>
        </div>
        <div className="attr">
          <b>Strong-quarter streak</b>
          <span>{s.strongStreak} / 2</span>
        </div>
        <div className="attr">
          <b>Team / calendar</b>
          <span>
            {s.engineers.length} engineers / {s.capacity} slots
          </span>
        </div>
      </div>
      <div className="section-head">
        <span>THE LADDER</span>
      </div>
      <div className="panel why">
        EM → Senior EM → Director (win)
        <small>Promotion: two consecutive Exceeds-or-better quarters and Reputation 60+. Google also requires a full packet.</small>
      </div>
      <div className="section-head">
        <span>RATING HISTORY</span>
      </div>
      <div className="panel">
        {s.history.length ? (
          s.history.map((h, i) => (
            <div className="why" key={i}>
              <b>
                Q{h.quarter} · <Badge company={h.company} /> {h.company} · {h.level}
              </b>
              <small>
                {h.grade}
                {h.score !== undefined ? ` · ${h.score}` : ""}
              </small>
            </div>
          ))
        ) : (
          <div className="why">
            <b>No reviews yet</b>
            <small>Your first quarterly review is in week 12.</small>
          </div>
        )}
      </div>
      <p className="helper">A Does Not Meet or two consecutive Partially Meets triggers a firing. First firing: another company. Second: run over.</p>
      <Btn onClick={() => go({ name: "office" })}>Back to Office →</Btn>
    </>
  );
}

export function PacketScreen({ s, go }: ScreenProps) {
  const shipped = s.projects.filter((p) => p.status === "shipped" || p.status === "late-shipped");
  return (
    <>
      <span className="eyebrow">{COMPANIES.Google.id.toUpperCase()} / CALIBRATION</span>
      <h1>The promotion packet.</h1>
      <div className="panel project">
        <div className="score-line">
          <b>Your evidence</b>
          <span className="num">
            {s.packet} / {PACKET_TARGET}
          </span>
        </div>
        <Meter value={s.packet} max={PACKET_TARGET} label="Promotion evidence" />
        <p className="helper">Launches (+3) and cross-team wins like the QBR deck or public kudos (+1) earn evidence, not calendar clicks.</p>
      </div>
      <div className="panel">
        {shipped.length ? (
          shipped.map((p) => (
            <div className="why" key={p.id}>
              <b>{p.name} launch · +3 evidence</b>
              <small>Delivery recorded this quarter.</small>
            </div>
          ))
        ) : (
          <div className="why">
            <b>No launches yet this quarter</b>
            <small>Shipping is the fastest way to build the packet.</small>
          </div>
        )}
      </div>
      <div className="notice">
        <b>Evidence is necessary, not a promise.</b>
        <p>Your two strong reviews, Reputation and packet go to calibration. The verdict can still be “not this cycle”.</p>
      </div>
      <Btn onClick={() => go({ name: "week" })}>Back to week →</Btn>
    </>
  );
}

export { blockingItem };

"use client";

import { useState } from "react";
import { COMPANIES, KEYNOTE_WEEK, PACKET_TARGET } from "@/content/companies";
import { expectedProgress } from "@/content/events";
import { TRAIT_LABEL } from "@/content/people";
import { engineerOutput } from "@/engine/resolve";
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
import { Badge, Btn, first, initials, Meter, Num } from "./ui";

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

export function WeekScreen({ s, set, go, toast, directorStatus }: ScreenProps & { directorStatus?: string }) {
  const used = planCost(s);
  const open = undecided(s);
  const optionalOpen = open.filter((i) => !i.required).length;
  const allDecided = open.length === 0;
  return (
    <>
      <div className="heading">
        <h1>The week ahead.</h1>
        <small>MONDAY</small>
      </div>
      <p className="subtitle">
        {s.inbox.length} demands. {s.capacity} slots. Something has to give.
      </p>
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
      <summary>{byDirector ? "◆ Picked by the AI director · why?" : "◇ Random draw this week · details"}</summary>
      {byDirector ? (
        <>
          {s.inboxSource.arcNote && (
            <p className="helper">
              <b>Arc:</b> {s.inboxSource.arcNote}
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
              {i.from} · {slots(intentCost(i, s.plan.choices[i.id]))}
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
      {selected && (
        <div className={`notice ${selected === "ignore" ? "" : "success"}`}>
          <b>{selected === "ignore" ? "↷ Marked to ignore" : "✓ Intent booked"}</b>
          <p>{selected === "ignore" ? item.ignoreHint : "Reversible until Continue. Choosing another intent refunds the old slot cost."}</p>
        </div>
      )}
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
          <span className="intent-hints">{intent.hints}</span>
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
        <span className="intent-hints">{item.ignoreHint}</span>
      </button>
      <p className="helper">Your choice spends time, not a guaranteed outcome. Hints show likely direction. Numbers resolve on Friday.</p>
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
        <span className="intent-hints">Morale ↑ · Reveals a trait or Loyalty</span>
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
          const weekly = Math.round(team.reduce((n, e) => n + engineerOutput(e, s.techDebt), 0));
          const status =
            p.status === "shipped"
              ? ["good", "Shipped"]
              : p.status === "late-shipped"
                ? ["warn", "Shipped late"]
                : p.status === "missed"
                  ? ["bad", "Missed"]
                  : pct >= expected
                    ? ["good", "On track"]
                    : ["bad", "At risk"];
          const owner = s.stakeholders.find((x) => x.role === p.owner)!;
          return (
            <section className="project" key={p.id}>
              <div className="split">
                <h2>
                  {p.name}
                  {p.flagship && s.company === "Vercel" ? " ★" : ""}
                </h2>
                <span className={`mini ${status[0]}`}>{status[1]}</span>
              </div>
              <p className="mini">
                {owner.name} · {p.owner === "pm" ? "PM" : p.owner === "skip" ? "Skip-level" : "Peer EM"} · DUE WEEK {p.dueWeek}
              </p>
              <div className="meter" role="meter" aria-label={`${p.name} progress`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <b style={{ width: `${pct}%` }} />
                {p.status === "active" && <span className="deadline" style={{ left: `${expected}%` }} title="Expected progress by now" />}
              </div>
              <div className="split mini">
                <span>
                  {p.progress} / {p.scope} POINTS
                </span>
                <span>{p.status === "active" ? `│ EXPECTED ${expectedProgress(p, s.week)} · ~${weekly}/WK` : ""}</span>
              </div>
              {p.status === "active" && (
                <button type="button" onClick={() => go({ name: "assign", projectId: p.id })}>
                  {team.map((e) => first(e.name)).join(" + ") || "No engineers assigned"} · Edit staffing →
                </button>
              )}
            </section>
          );
        })}
      </div>
      {s.engineers.some((e) => !e.projectId) && (
        <div className="notice">
          <b>{s.engineers.filter((e) => !e.projectId).map((e) => first(e.name)).join(", ")} unassigned.</b>
          <p>Unassigned engineers recover Energy but add no progress.</p>
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
          {oncall ? `On call: ${oncall.name}.` : "Nobody is on call."} Debugging affects incidents. Energy drains on call, more if the pager fires.
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
  const projectName = (id: string | null) => s.projects.find((x) => x.id === id)?.name ?? "Unassigned";
  return (
    <>
      <Btn kind="back" onClick={() => go({ name: "projects" })}>
        ← Projects
      </Btn>
      <h1>Staff {p.name}.</h1>
      <p className="subtitle">One primary project per engineer. Assignments are free; their time is not infinite.</p>
      <div className="panel">
        {s.engineers.map((e) => {
          const here = e.projectId === p.id;
          return (
            <button
              type="button"
              key={e.id}
              className={`intent ${here ? "selected" : ""}`}
              style={{ margin: 0, borderWidth: "0 0 1px", boxShadow: "none" }}
              aria-pressed={here}
              onClick={() => {
                set(assign(s, e.id, here ? null : p.id));
                toast(here ? `${first(e.name)} unassigned · no slots spent` : `${first(e.name)} moved to ${p.name}`);
              }}
            >
              <span className="intent-main">
                <span>{e.name}</span>
                <span>{here ? "✓" : "＋"}</span>
              </span>
              <span className="intent-hints">
                Coding {e.attrs.coding} · Morale {e.attrs.morale} · Energy {e.attrs.energy} · ~{Math.round(engineerOutput(e, s.techDebt))} pts/wk
                <br />
                {here ? "Assigned here · tap to unassign" : e.projectId ? `Move from ${projectName(e.projectId)}` : "Currently unassigned"}
              </span>
            </button>
          );
        })}
      </div>
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
            <span className="intent-hints">{reason && !on ? reason : a.hints}</span>
          </button>
        );
      })}
      <div className="section-head">
        <span>YOU OWE</span>
        <span>FACT LEDGER</span>
      </div>
      {promises.length ? (
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

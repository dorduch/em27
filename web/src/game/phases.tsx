"use client";

import { useEffect, useRef, useState } from "react";
import { COMPANIES, COMPANY_IDS, KEYNOTE_WEEK, PACKET_TARGET } from "@/content/companies";
import { FAREWELLS } from "@/content/people";
import { buildRecap, type Recap } from "@/engine/career";
import { forecast } from "@/engine/forecast";
import { SKILL_LABEL } from "@/engine/growth";
import { SKILLS } from "@/engine/setup";
import { deliveryScore, GRADES, teamScore, trustScore } from "@/engine/review";
import type { CompanyId, GameState, Offer } from "@/engine/types";
import { Badge, Btn, first, money, Rich } from "./ui";

const LINE_MS = 1600;

/* ---------------- Friday ---------------- */

export function FridayScreen({ s, onDone }: { s: GameState; onDone: () => void }) {
  const lines = s.lastWeek?.lines ?? [];
  const [count, setCount] = useState(0);
  useEffect(() => {
    // One line every 1.6s; the timer pauses while the page is hidden.
    const t = setInterval(() => {
      if (!document.hidden) setCount((c) => Math.min(lines.length, c + 1));
    }, LINE_MS);
    return () => clearInterval(t);
  }, [lines.length]);
  const done = count >= lines.length;
  const keynote = s.lastWeek?.keynote;
  // Keep the newest line in view, unless the player has scrolled up to reread.
  const listRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    const onScroll = () => {
      follow.current = main.scrollTop + main.clientHeight >= main.scrollHeight - 80;
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (follow.current) listRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [count]);
  return (
    <>
      <span className="eyebrow">
        WEEK {s.lastWeek?.week} / {keynote ? "KEYNOTE DAY" : "MATCH DAY"}
      </span>
      <div className="friday-intro">
        <span className="live">{done ? "FULL TIME" : keynote ? "ON STAGE" : "COMMENTARY"}</span>
        <h1>{keynote === "shipped" ? "The demo is live." : keynote === "missed" ? "The demo slot is empty." : "Friday, then."}</h1>
        <p className="subtitle">The part where the plan meets production.</p>
      </div>
      <div aria-live="polite" aria-relevant="additions" ref={listRef}>
        {lines.slice(0, count).map((l, i) => (
          <div className="commentary" key={i}>
            <time>{l.time}</time>
            <p>
              <Rich text={l.text} />
              <small>{l.cause}</small>
            </p>
          </div>
        ))}
      </div>
      <div className="friday-actions sticky-actions">
        {done ? (
          <Btn kind="primary" onClick={onDone}>
            Read the back page →
          </Btn>
        ) : (
          <Btn onClick={() => setCount(lines.length)}>Show all commentary ↓</Btn>
        )}
      </div>
    </>
  );
}

/* ---------------- Back page ---------------- */

export function BackPageScreen({ s, onNext }: { s: GameState; onNext: () => void }) {
  const w = s.lastWeek!;
  const [showAll, setShowAll] = useState(false);
  const goodFor = (subject: string, d: number) => (/Tech Debt|On-call Load|Stress|scope|deadline/.test(subject) ? d < 0 : d > 0);
  const nextLabel = s.week === 5 ? "Mid-quarter check-in →" : s.week >= 12 ? "Quarterly review →" : `Monday · week ${s.week + 1} →`;
  const projects = w.projects ?? [];
  // Group identical causes across engineers ("Team Morale +1 (3 engineers) · Public kudos").
  const rows: { subject: string; delta: number; why: string }[] = [];
  const grouped = new Map<string, { attr: string; delta: number; why: string; n: number }>();
  const growth = w.growth ?? [];
  for (const c of w.causes) {
    // Skill growth has its own section.
    if (growth.some((g) => c.why === g.why && c.subject === `${first(g.name)}’s ${SKILL_LABEL[g.skill]}`)) continue;
    // The project rows show the team's weekly output; progress your decisions added or cost stays in the list.
    if (projects.length && c.subject.endsWith(" progress") && c.why.endsWith(" on the work")) continue;
    const m = c.subject.match(/^(.+)’s (Morale|Energy|Loyalty|Coding|Debugging|Communication|Ambition)$/);
    if (m) {
      const key = `${m[2]}|${c.delta}|${c.why}`;
      const g = grouped.get(key);
      if (g) g.n++;
      else grouped.set(key, { attr: m[2], delta: c.delta, why: c.why, n: 1 });
      if (!g) rows.push({ subject: key, delta: c.delta, why: c.why });
    } else rows.push(c);
  }
  const display = rows
    .map((r) => {
      const g = grouped.get(r.subject);
      if (!g) return r;
      const one = w.causes.find((c) => c.why === g.why && c.delta === g.delta && c.subject.endsWith(`’s ${g.attr}`))!;
      return { subject: g.n > 1 ? `${g.attr} (${g.n} engineers)` : one.subject, delta: g.delta, why: g.why };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const shown = showAll ? display : display.slice(0, 10);
  return (
    <div className="paper">
      <div className="masthead">The Engineering Post</div>
      <div className="paper-date">
        Q{w.quarter} · WEEK {w.week} · THE FRIDAY EDITION
      </div>
      <h1>
        <Rich text={w.headline} />
      </h1>
      <p className="recap">{w.recap}</p>
      {(w.promotions ?? []).map((p) => {
        const e = s.engineers.find((x) => x.id === p.id);
        const shipped = e?.career.filter((c) => c.kind === "ship").map((c) => c.text.replace(/^Shipped /, "").replace(/\.$/, "")) ?? [];
        return (
          <section className="promotion-card" key={p.id}>
            <span className="eyebrow">PROMOTION · L{p.from} → L{p.to}</span>
            <h2>{p.name}</h2>
            <p>
              {e && e.career[0] ? `${e.career[0].text.replace(/\.$/, "")}. ` : ""}
              {shipped.length ? `Shipped ${shipped.slice(-3).join(", ")}. ` : ""}
              The committee said yes.
            </p>
          </section>
        );
      })}
      {growth.length > 0 && (
        <>
          <div className="section-head">
            <span>THE SQUAD / WHO GREW</span>
            <span>{growth.length}</span>
          </div>
          <div className="cause-list">
            {growth.map((g, i) => (
              <div className="delta" key={i}>
                <b className="good">▲ {g.to}</b>
                <div>
                  <strong>
                    {first(g.name)}’s {SKILL_LABEL[g.skill]}
                  </strong>
                  <small>{g.why}</small>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {projects.length > 0 && (
        <>
          <div className="section-head">
            <span>THE PROJECTS</span>
            <span>THIS WEEK</span>
          </div>
          <div className="cause-list">
            {projects.map((p) => (
              <div className="delta" key={p.id}>
                <b className={p.gain > 0 ? "good" : "bad"}>{p.gain > 0 ? `↑ ${p.gain}` : "0"}</b>
                <div>
                  <strong>
                    {p.name} · {p.progress}/{p.scope}
                  </strong>
                  <small>
                    {p.status === "shipped" || p.status === "late-shipped"
                      ? "Shipped."
                      : p.status === "missed"
                        ? `Missed week ${p.dueWeek}.`
                        : p.team
                          ? `${p.team} ${p.team === 1 ? "person" : "people"} on it · due week ${p.dueWeek}`
                          : `Nobody assigned · due week ${p.dueWeek}`}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="section-head">
        <span>THE NUMBERS / AND THE WHY</span>
        <span>{display.length} CHANGES</span>
      </div>
      <div className="cause-list">
        {shown.map((c, i) => {
          const good = goodFor(c.subject, c.delta);
          return (
            <div className="delta" key={i}>
              <b className={good ? "good" : "bad"}>
                {c.delta > 0 ? "↑" : "↓"} {Math.abs(c.delta)}
              </b>
              <div>
                <strong>{c.subject}</strong>
                <small>{c.why}</small>
              </div>
            </div>
          );
        })}
        {w.luck !== 0 && (
          <div className="delta">
            <b className={w.luck > 0 ? "good" : "bad"}>
              {w.luck > 0 ? "+" : "−"} {Math.abs(w.luck)}
            </b>
            <div>
              <strong>Luck / dependency timing</strong>
              <small>Variance contribution to delivery, not a hidden choice effect.</small>
            </div>
          </div>
        )}
      </div>
      {display.length > shown.length && <Btn onClick={() => setShowAll(true)}>Show all {display.length} changes ↓</Btn>}
      <div className="sticky-actions">
        <Btn kind="primary" onClick={onNext}>
          {nextLabel}
        </Btn>
      </div>
    </div>
  );
}

/* ---------------- Mid-quarter ---------------- */

export function CheckinScreen({ s, onDone }: { s: GameState; onDone: (focus: number) => void }) {
  const [focus, setFocus] = useState(0);
  const skip = s.stakeholders.find((x) => x.role === "skip")!;
  const delivery = deliveryScore(s);
  const team = teamScore(s);
  const trust = trustScore(s);
  // The same forecast the Projects screen shows; stretch goals can't miss, so they don't count here.
  const behind = s.projects.filter((p) => !p.stretch && ["behind", "stalled"].includes(forecast(p, s.engineers, s.techDebt, s.week).kind));
  const tired = s.engineers.filter((e) => e.attrs.energy <= 8);
  const weakest = [
    { k: 0, v: delivery },
    { k: 1, v: team },
    { k: 2, v: trust },
  ].sort((a, b) => a.v - b.v)[0].k;
  const focuses = ["Recover delivery", "Protect the team", "Rebuild stakeholder trust"];
  return (
    <>
      <span className="eyebrow">WEEK 6 / MID-QUARTER</span>
      <h1 style={{ marginTop: 12 }}>
        “How do you think
        <br />
        it’s going?”
      </h1>
      <div className="sender">
        <span className="avatar">{skip.name.split(" ").map((n) => n[0]).join("")}</span>
        <div>
          <b>{skip.name}</b>
          <small>Your skip-level · 25 minutes booked</small>
        </div>
      </div>
      <div className="review-letter">
        <p>
          “{behind.length ? `${behind.map((p) => p.name).join(" and ")} ${behind.length > 1 ? "are" : "is"} behind where I’d expect.` : "Delivery looks on track. Good."}
          {tired.length ? ` And ${tired.map((e) => first(e.name)).join(", ")} can’t keep running on empty.` : ""}”
        </p>
        <p>“Here’s what the review will look at. You have six weeks.”</p>
      </div>
      <div className="section-head">
        <span>THE REVIEW LENS</span>
        <span>NO RATING YET</span>
      </div>
      <div className="panel">
        <div className="why">
          <b>Delivery · 40% · {delivery}</b>
          <small>{behind.length ? `${behind.map((p) => p.name).join(" and ")} ${behind.length > 1 ? "are" : "is"} forecast to miss ${behind.length > 1 ? "their dates" : `week ${behind[0].dueWeek}`}.` : "Projects tracking to plan."}</small>
        </div>
        <div className="why">
          <b>Team health · 30% · {team}</b>
          <small>{tired.length ? `${tired.length} engineer${tired.length > 1 ? "s" : ""} at low Energy.` : "Energy and morale holding."}</small>
        </div>
        <div className="why">
          <b>Stakeholder Trust · 30% · {trust}</b>
          <small>Keep promises visible. Don’t optimize only for {first(skip.name)}.</small>
        </div>
      </div>
      <div className="section-head">
        <span>SET A FOCUS / NO SLOT COST</span>
      </div>
      {focuses.map((t, i) => (
        <button type="button" key={t} className={`intent ${focus === i ? "selected" : ""}`} aria-pressed={focus === i} onClick={() => setFocus(i)}>
          <b>
            {focus === i ? "✓ " : ""}
            {t}
            {i === weakest ? " · weakest area" : ""}
          </b>
          <span className="intent-hints">Personal planning reminder · no hidden stat bonus</span>
        </button>
      ))}
      <Btn kind="primary" onClick={() => onDone(focus)}>
        Back to planning · week 6 →
      </Btn>
    </>
  );
}

/* ---------------- Quarterly review ---------------- */

export function ReviewScreen({ s, onContinue }: { s: GameState; onContinue: () => void }) {
  const [open, setOpen] = useState(false);
  const r = s.review!;
  const skip = s.stakeholders.find((x) => x.role === "skip")!;
  const outcomeText =
    r.outcome === "win"
      ? "Director. You win."
      : r.outcome === "promotion"
        ? "Promoted to Senior EM."
        : r.outcome === "fired"
          ? "Employment ends here."
          : r.outcome === "run-over"
            ? "Second firing. Your run is over."
            : "Stay with your squad.";
  const action =
    r.outcome === "win"
      ? "Director · see your recap →"
      : r.outcome === "promotion"
        ? "Take the Senior EM role →"
        : r.outcome === "fired"
          ? "Open job hunt →"
          : r.outcome === "run-over"
            ? "End run · recap →"
            : "Next quarter · keep the squad →";
  return (
    <>
      <span className="eyebrow">Q{s.quarter} / WEEK 12 / CONFIDENTIAL</span>
      <h1>Quarterly review.</h1>
      <div className="review-letter">
        <b>{skip.name} · Skip-level</b>
        {r.letter.map((l, i) => (
          <p key={i} style={i === 0 ? { marginTop: 10 } : undefined}>
            {l}
          </p>
        ))}
      </div>
      <SquadReport s={s} />
      {!open ? (
        <>
          <div className="rating">
            <span className="eyebrow">THE VERDICT IS READY</span>
            <h2>
              One quarter.
              <br />
              One conversation.
            </h2>
          </div>
          <Btn kind="primary" onClick={() => setOpen(true)}>
            Open your rating →
          </Btn>
        </>
      ) : (
        <>
          <section className="rating">
            <span className="eyebrow">FINAL GRADE</span>
            <h2>{r.grade}</h2>
            <p>{outcomeText}</p>
          </section>
          <div className="rating-lines">
            <span>Delivery · 40%</span>
            <b>{r.delivery} / 100</b>
            <span>Team health · 30%</span>
            <b>{r.team} / 100</b>
            <span>Stakeholder Trust · 30%</span>
            <b>{r.trust} / 100</b>
            <span>Weighted result</span>
            <b>{r.weighted} / 100</b>
            <span>Grade from score</span>
            <b>{r.baseGrade}</b>
            <span>Boss adjustment</span>
            <b>
              {r.bossSteps === 0 ? "0 steps" : r.bossSteps > 0 ? "+1 step" : "−1 step"} (Trust {skip.trust})
            </b>
          </div>
          {s.company === "Google" && (
            <div className="notice">
              <b>Calibration: {r.packetApproved ? "packet approved" : "not this cycle"}</b>
              <p>
                {s.packet}/{PACKET_TARGET} evidence. Launches and cross-team wins belong in the packet.
              </p>
            </div>
          )}
          {r.notes.map((n) => (
            <div className="notice" key={n}>
              <p style={{ margin: 0 }}>{n}</p>
            </div>
          ))}
          <Btn kind="primary" onClick={onContinue}>
            {action}
          </Btn>
          <p className="helper">Grade scale: {GRADES.join(" · ")}.</p>
        </>
      )}
    </>
  );
}

/** Who grew this quarter, who got promoted, who left: the squad's season in one table. */
function SquadReport({ s }: { s: GameState }) {
  const rows = s.engineers.map((e) => {
    const deltas = SKILLS.map((k) => ({ k, d: e.attrs[k] - e.qStart[k] })).filter((x) => x.d !== 0);
    return { e, deltas, total: deltas.reduce((n, x) => n + x.d, 0), promoted: e.level > e.qStart.level };
  });
  const best = Math.max(0, ...rows.map((r) => r.total));
  const left = s.alumni.filter((a) => a.career.some((c) => c.kind === "leave" && c.quarter === s.quarter));
  return (
    <>
      <div className="section-head">
        <span>SQUAD REPORT</span>
        <span>Q{s.quarter}</span>
      </div>
      <div className="cause-list squad-report">
        {rows.map(({ e, deltas, total, promoted }) => (
          <div className="delta" key={e.id}>
            <b className={total > 0 || promoted ? "good" : undefined}>{promoted ? `L${e.level}` : total > 0 ? `▲ ${total}` : "–"}</b>
            <div>
              <strong>
                {e.name}
                {best > 0 && total === best ? " · most improved" : ""}
              </strong>
              <small>
                {promoted ? `Promoted L${e.qStart.level} → L${e.level}. ` : ""}
                {deltas.length ? deltas.map((x) => `${SKILL_LABEL[x.k]} ${x.d > 0 ? "+" : "−"}${Math.abs(x.d)}`).join(" · ") : "No growth this quarter."}
              </small>
            </div>
          </div>
        ))}
        {left.map((a) => (
          <div className="delta" key={a.name}>
            <b className="bad">Left</b>
            <div>
              <strong>{a.name}</strong>
              <small>{a.career[a.career.length - 1].text}</small>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------- Career moments ---------------- */

export function HuntScreen({ s, onPick }: { s: GameState; onPick: (o: Offer) => void }) {
  return (
    <>
      <span className="eyebrow">CAREER / FIRST FIRING</span>
      <h1>A setback. Not a reset.</h1>
      <div className="review-letter">
        <p>“We’ve decided to go in a different direction.”</p>
        <p>You have heard that sentence before. This time it is about you.</p>
      </div>
      <div className="panel why">
        <b>Reputation {s.reputation} · firing 1 of 2</b>
        <small>Reputation carries over. Promotion progress resets. The next job comes with a new squad.</small>
      </div>
      <div className="section-head">
        <span>OFFERS / OTHER COMPANIES</span>
        <span>{s.offers.length} OFFER{s.offers.length === 1 ? "" : "S"}</span>
      </div>
      {s.offers.map((o) => (
        <button type="button" className="company-option" key={o.company} onClick={() => onPick(o)}>
          <Badge company={o.company} />
          <span>
            <b>
              {o.company} · {o.level}
            </b>
            <small>
              {o.level !== s.level ? "One level down · weaker Reputation" : "Same-level opportunity"} · new team
            </small>
          </span>
          <span>→</span>
        </button>
      ))}
      <p className="helper">A second firing ends the run. You can read an offer before choosing where to land.</p>
    </>
  );
}

export function OfferScreen({
  s,
  onAccept,
  onBack,
  onDecline,
  onLeverage,
}: {
  s: GameState;
  onAccept: () => void;
  onBack: () => void;
  onDecline: () => void;
  onLeverage: () => void;
}) {
  const o = s.pendingOffer!;
  const hunting = o.kind === "hunt";
  const senior = o.level === "Senior EM";
  return (
    <>
      <span className="eyebrow">{hunting ? "JOB HUNT" : "POACHING"} / PRIVATE OFFER</span>
      <h1>“Let’s talk.”</h1>
      <div className="review-letter">
        <div className="sender">
          <Badge company={o.company} />
          <b>{o.company} · Engineering</b>
        </div>
        <p>
          We would like to offer you the role of <b>{o.level}</b>.
        </p>
        <p>{hunting ? "Your track record still matters. So does the quarter you just had." : "Your last quarter got our attention. We have a team that could use that kind of leadership."}</p>
        <div className="attr">
          <span>Team</span>
          <b>{senior ? 8 : 6} engineers</b>
        </div>
        <div className="attr">
          <span>Projects / calendar</span>
          <b>{senior ? "4 projects / 9 slots" : "3 projects / 8 slots"}</b>
        </div>
        <div className="attr">
          <span>Salary / year</span>
          <b>{money(o.salary)}</b>
        </div>
        <p className="helper">Fictional salary, not company compensation data.</p>
        <p>{COMPANIES[o.company].mechanic}</p>
      </div>
      <div className="notice">
        <b>Accepting leaves your squad behind.</b>
        <p>{hunting ? "New team, carried Reputation, reset promotion progress." : `Your ${s.engineers.length} engineers, their promises and your promotion streak stay here.`}</p>
      </div>
      <Btn kind="primary" onClick={onAccept}>
        Accept {o.level} at {o.company} →
      </Btn>
      {hunting ? (
        <Btn onClick={onBack}>Back to other offers</Btn>
      ) : (
        <>
          <Btn onClick={onDecline}>Decline · stay with your squad</Btn>
          <button type="button" className="intent" onClick={onLeverage}>
            <b>Use it as leverage</b>
            <span className="intent-hints">Political Capital ↑ · Skip Trust ↓ · Backfire risk</span>
          </button>
        </>
      )}
    </>
  );
}

export function FarewellScreen({ s, onStart }: { s: GameState; onStart: () => void }) {
  const o = s.pendingOffer!;
  return (
    <>
      <span className="eyebrow">CAREER / MOVING ON</span>
      <h1>The people you leave.</h1>
      <div className="notice">
        <b>
          {o.company} · {o.level}
        </b>
        <p>Your move is ready. New company, new squad; Reputation travels with you.</p>
      </div>
      <div className="panel">
        {s.engineers.map((e, i) => (
          <div className="why" key={e.id}>
            <b>{e.name}</b>
            <small>“{FAREWELLS[i % FAREWELLS.length]}”</small>
          </div>
        ))}
      </div>
      <Btn kind="primary" onClick={onStart}>
        Start at {o.company} →
      </Btn>
    </>
  );
}

/* ---------------- Recap ---------------- */

async function recapBlob(r: Recap): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const c = canvas.getContext("2d");
  if (!c) return null;
  c.fillStyle = "#13015e";
  c.fillRect(0, 0, 1080, 1920);
  c.fillStyle = "#a6000d";
  c.fillRect(36, 36, 1008, 170);
  c.fillStyle = "#eced41";
  c.font = "bold 70px Tahoma, Arial";
  c.fillText("EM27 / CAREER REPORT", 65, 145);
  const wrap = (text: string, max: number) => {
    const words = text.split(" ");
    const out: string[] = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (c.measureText(t).width > max && cur) {
        out.push(cur);
        cur = w;
      } else cur = t;
    }
    if (cur) out.push(cur);
    return out;
  };
  let y = 290;
  const draw = (text: string, font: string, color: string, gap: number) => {
    c.font = font;
    c.fillStyle = color;
    for (const l of wrap(text, 950)) {
      c.fillText(l, 65, y);
      y += gap;
    }
  };
  draw(r.win ? "DIRECTOR. YOU WIN." : "SECOND FIRING. RUN OVER.", "bold 50px Tahoma, Arial", "#eced41", 80);
  for (const h of r.headline) draw(h, "bold 46px Tahoma, Arial", "#eceee0", 62);
  y += 30;
  draw(r.path, "34px Tahoma, Arial", "#eceee0", 50);
  y += 30;
  for (const h of r.history.slice(-8)) draw(`${h.label} · ${h.grade}`, "30px Tahoma, Arial", "#eceee0", 46);
  y += 30;
  draw(`${r.quarters} quarters · ${r.projectsShipped} projects shipped`, "32px Tahoma, Arial", "#eceee0", 50);
  draw(`${r.incidents} incidents · ${r.promisesKept} promises kept / ${r.promisesBroken} broken`, "32px Tahoma, Arial", "#eceee0", 50);
  y += 30;
  draw("SQUAD HALL OF FAME", "bold 34px Tahoma, Arial", "#eced41", 52);
  if (r.best) draw(`Best engineer: ${r.best}`, "32px Tahoma, Arial", "#eceee0", 48);
  if (r.gotAway) draw(`The one who got away: ${r.gotAway}`, "32px Tahoma, Arial", "#eceee0", 48);
  c.font = "26px Tahoma, Arial";
  c.fillStyle = "#b9b8d8";
  c.fillText("EM27 · Parody. Fictional people. Eight slots. Good luck.", 65, 1860);
  return new Promise((res) => canvas.toBlob(res, "image/png"));
}

export function RecapScreen({ s, onNewGame, toast }: { s: GameState; onNewGame: (c: CompanyId) => void; toast: (m: string) => void }) {
  const r = buildRecap(s);
  const [company, setCompany] = useState<CompanyId>(s.company);
  const busy = useRef(false);
  const summary = `EM27: ${r.win ? "Director!" : "The calendar won. Twice."} ${r.path}. ${r.quarters} quarters, ${r.projectsShipped} projects shipped, ${r.incidents} incidents.`;
  const share = async (download: boolean) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const blob = await recapBlob(r);
      if (!blob) throw new Error("canvas");
      const file = new File([blob], "em27-career-recap.png", { type: "image/png" });
      if (!download && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "My EM27 career", text: summary });
        return;
      }
      if (!download && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(summary);
        toast("Recap summary copied. Use Download to get the image.");
        return;
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast("Recap image downloaded");
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast("Sharing isn’t available here. Try Download.");
    } finally {
      busy.current = false;
    }
  };
  return (
    <>
      <article className="run-recap" id="share-card">
        <div className="recap-top">EM27 / CAREER REPORT / 2027</div>
        <span className="eyebrow">{r.win ? "DIRECTOR · RUN WON" : "SECOND FIRING · RUN OVER"}</span>
        <h1>
          {r.headline[0]}
          <br />
          {r.headline[1]}
        </h1>
        <div className="recap-route">{r.path}</div>
        <div className="section-head">
          <span>THE CAREER PATH</span>
        </div>
        <div className="panel why">
          {r.history.map((h, i) => (
            <span key={i}>
              {h.label} · {h.grade}
              <br />
            </span>
          ))}
        </div>
        <div className="recap-stats">
          <div>
            <b>{r.quarters}</b>quarters
          </div>
          <div>
            <b>{r.projectsShipped}</b>projects shipped
          </div>
          <div>
            <b>{r.incidents}</b>incidents survived
          </div>
          <div>
            <b>
              {r.promisesKept} / {r.promisesBroken}
            </b>
            promises kept / broken
          </div>
        </div>
        <div className="section-head">
          <span>SQUAD HALL OF FAME</span>
        </div>
        <p>
          {r.best && (
            <>
              <b>Best engineer</b> · {r.best}
              <br />
            </>
          )}
          {r.gotAway && (
            <>
              <b>The one who got away</b> · {r.gotAway}
            </>
          )}
        </p>
        <small>EM27 · Parody. Fictional people. Eight slots. Good luck.</small>
      </article>
      <div className="recap-actions">
        <Btn kind="primary" onClick={() => share(false)}>
          Share career recap ↗
        </Btn>
        <Btn onClick={() => share(true)}>Download portrait PNG ↓</Btn>
        <p className="helper">Sharing opens your phone’s share sheet. Nothing is posted automatically.</p>
        <div className="section-head">
          <span>NEW CAREER</span>
        </div>
        {COMPANY_IDS.map((c) => (
          <button type="button" key={c} className={`company-option ${company === c ? "selected" : ""}`} aria-pressed={company === c} onClick={() => setCompany(c)}>
            <Badge company={c} />
            <span>
              <b>{c}</b>
              <small>
                {COMPANIES[c].tier} · {COMPANIES[c].tagline}
              </small>
            </span>
            <span>{company === c ? "●" : "○"}</span>
          </button>
        ))}
        <Btn kind="primary" onClick={() => onNewGame(company)}>
          Start a new career →
        </Btn>
      </div>
    </>
  );
}

/* ---------------- Title ---------------- */

export function TitleScreen({
  saved,
  onStart,
  onResume,
  onTheme,
  onHowTo,
  picking,
  setPicking,
}: {
  picking: boolean;
  setPicking: (v: boolean) => void;
  saved: GameState | null;
  onStart: (c: CompanyId) => void;
  onResume: () => void;
  onTheme: () => void;
  onHowTo: () => void;
}) {
  const [company, setCompany] = useState<CompanyId>("Vercel");
  return (
    <>
      <div className="title-art title-logo">
        <span className="eyebrow">SEASON 2027</span>
        <h1>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-wordmark.png" alt="EM27 Engineering Manager" width={900} height={229} />
        </h1>
      </div>
      <p className="title-tagline">“Got a quick minute?”</p>
      {!picking ? (
        <>
          {saved && (
            <Btn kind="primary" onClick={onResume}>
              Continue · {saved.company} · Q{saved.quarter} week {saved.week}
            </Btn>
          )}
          <Btn kind={saved ? "secondary" : "primary"} onClick={() => setPicking(true)}>
            Start a new career →
          </Btn>
          <Btn onClick={onHowTo}>How to play</Btn>
          <Btn onClick={onTheme}>Switch light / dark theme ◐</Btn>
        </>
      ) : (
        <>
          <div className="section-head">
            <span>CHOOSE YOUR DUGOUT</span>
          </div>
          {COMPANY_IDS.map((c) => (
            <button type="button" key={c} className={`company-option ${company === c ? "selected" : ""}`} aria-pressed={company === c} onClick={() => setCompany(c)}>
              <Badge company={c} />
              <span>
                <b>{c}</b>
                <small>
                  {COMPANIES[c].tier} · {COMPANIES[c].tagline}
                </small>
              </span>
              <span>{company === c ? "●" : "○"}</span>
            </button>
          ))}
          <p className="helper">{COMPANIES[company].mechanic}</p>
          {saved && (
            <div className="notice danger">
              <b>This replaces your saved career.</b>
              <p>
                {saved.company} · Q{saved.quarter} week {saved.week} will be overwritten.
              </p>
            </div>
          )}
          <Btn kind="primary" onClick={() => onStart(company)}>
            Start at {company} →
          </Btn>
          <Btn onClick={() => setPicking(false)}>Cancel</Btn>
        </>
      )}
      <p className="disclaimer">
        Parody. Not affiliated with or endorsed by any company named. All characters and situations are fictional.
        <br />
        <br />
        No sign-in. Your save stays on this device.
      </p>
    </>
  );
}

export { KEYNOTE_WEEK };

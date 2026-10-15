"use client";

import { Fragment, type ReactNode } from "react";
import { COMPANIES, KEYNOTE_WEEK, PACKET_TARGET } from "@/content/companies";
import { blockingItem, planCost, projectedCapacity, projectedStress, undecided } from "@/engine/plan";
import { splitHints } from "@/engine/hints";
import type { CompanyId, GameState } from "@/engine/types";

export const first = (name: string) => name.split(" ")[0];
export const initials = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("");

export function Num({ v }: { v: number | "?" }) {
  if (v === "?") return <span className="num">?</span>;
  return <span className={`num ${v <= 7 ? "bad" : v <= 13 ? "warn" : "good"}`}>{v}</span>;
}

export function Badge({ company }: { company: CompanyId }) {
  return (
    <span className="badge" data-company={company}>
      {COMPANIES[company].badge}
    </span>
  );
}

export function Meter({ value, label, max = 100 }: { value: number; label: string; max?: number }) {
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <b style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
    </div>
  );
}

/** Renders engine/LLM text that may contain <b> or <b class="good|bad">. Everything else is plain text. */
export function Rich({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /<b(?: class="(good|bad)")?>(.*?)<\/b>|<br\s*\/?>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<Fragment key={k++}>{text.slice(last, m.index)}</Fragment>);
    if (m[0].startsWith("<br")) out.push(<br key={k++} />);
    else out.push(<b key={k++} className={m[1]}>{m[2]}</b>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(<Fragment key={k++}>{text.slice(last)}</Fragment>);
  return <>{out}</>;
}

export function Header({
  s,
  title,
  edition,
  bar = true,
}: {
  s: GameState | null;
  title?: string;
  edition?: string;
  bar?: boolean; // the red EM27 title bar; the title screen has its own hero instead
}) {
  const status = s && s.phase !== "recap" ? companyStatus(s) : null;
  return (
    <>
      {/* Decorative window chrome, as in the CM 01/02 reference. Theme switching lives on Title and Office. */}
      <div className="window-caption" aria-hidden="true">
        <span>▣ Engineering Manager 2027</span>
        <span>▱ □ ×</span>
      </div>
      {bar && (
        <header className="topbar">
          <div className="brand">
            {title ?? "EM27"}
            <span className="edition">{edition ?? "ENGINEERING MANAGER"}</span>
          </div>
          {s && (
            <div className="company">
              <Badge company={s.company} /> {s.company}
            </div>
          )}
        </header>
      )}
      {s && status && (
        <div className="season">
          <span>
            Q{s.quarter} / {s.level.toUpperCase()} · WK {String(s.week).padStart(2, "0")}/12 · {s.phase === "plan" ? "MON" : "FRI"}
          </span>
          <span className="season-co">
            <b>{status.label}</b> {status.text}
          </span>
        </div>
      )}
    </>
  );
}

/** The company's own mechanic, as a short label and status. */
export function companyStatus(s: GameState): { label: string; text: string } {
  if (s.company === "Vercel") {
    const flagship = s.projects.find((p) => p.flagship);
    const done = flagship && flagship.status !== "active";
    const left = KEYNOTE_WEEK - s.week;
    const text =
      s.week > KEYNOTE_WEEK || (s.week === KEYNOTE_WEEK && s.phase !== "plan")
        ? flagship?.status === "shipped"
          ? "shipped on stage"
          : "keynote missed"
        : done && flagship!.status === "shipped"
          ? left === 0
            ? "ready · on stage Friday"
            : `ready · ${left} wk${left === 1 ? "" : "s"} to stage`
          : done
            ? "flagship missed"
            : left > 0
              ? `${left} wk${left === 1 ? "" : "s"} to stage`
              : "on stage this Friday";
    return { label: `KEYNOTE WK ${KEYNOTE_WEEK}`, text };
  }
  if (s.company === "Stripe") {
    return {
      label: "INCIDENTS ×2",
      text: s.pendingPostmortem && s.phase === "plan" ? "postmortem due" : s.incidentMultiplier > 1 ? `penalty ×${s.incidentMultiplier}` : "reviews halve it",
    };
  }
  return { label: "PACKET", text: `${Math.min(s.packet, PACKET_TARGET)}/${PACKET_TARGET} evidence` };
}

export function Calendar({ s, onAgenda }: { s: GameState; onAgenda: () => void }) {
  const used = planCost(s);
  const cap = s.capacity;
  const shown = Math.min(Math.max(cap, used), 12);
  const over = used - cap;
  return (
    <section className="calendar" aria-label="Calendar budget">
      <div className="cal-head">
        <span className="eyebrow">YOUR CALENDAR</span>
        <span className={`cal-value ${over > 0 ? "bad" : ""}`}>
          {over > 0 ? `${over} OVER · Stress ${projectedStress(s, used)} · next wk ${projectedCapacity(s, used)} slots` : `${cap - used} OF ${cap} LEFT`}
        </span>
      </div>
      <button type="button" className="slots" onClick={onAgenda} aria-label={`${used} of ${cap} slots booked. View bookings`}>
        {Array.from({ length: shown }, (_, i) => (
          <span key={i} className={`slot ${i < used ? "filled" : ""} ${i >= cap ? "extra" : ""}`}>
            {i < used ? (i >= cap ? "+" : "■") : "·"}
          </span>
        ))}
        {used > 12 && <span className="slot extra">+{used - 12}</span>}
      </button>
    </section>
  );
}

/** Hint text split into chips coloured by whether each effect is good or bad for the player. */
export function HintChips({ hints }: { hints: string }) {
  const chips = splitHints(hints);
  if (!chips.length) return null;
  return (
    <span className="intent-hints hint-chips">
      {chips.map((c, i) => (
        <span key={i} className={`hint ${c.valence}`}>
          {c.text}
        </span>
      ))}
    </span>
  );
}

const PATHS = {
  week: "M3 5h14v12H3z M6 2v5m8-5v5M3 9h14",
  squad: "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-1a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM1 18v-3a5 5 0 0 1 10 0v3m2-7a4 4 0 0 1 6 4v3",
  projects: "M2 5h6l2 2h8v10H2z",
  office: "M4 18V3h12v15M1 18h18M7 6h2m2 0h2M7 10h2m2 0h2M8 18v-4h4v4",
} as const;
export type Tab = keyof typeof PATHS;

export function Dock({ s, active, onTab, onContinue }: { s: GameState; active: Tab; onTab: (t: Tab) => void; onContinue: () => void }) {
  const blocking = blockingItem(s);
  const open = undecided(s).length;
  const decided = s.inbox.length - open;
  return (
    <footer className="dock">
      <p className="dock-note">
        {blocking
          ? `! 1 must-respond item · ${open} undecided`
          : `${planCost(s)}/${s.capacity} slots booked · ${decided}/${s.inbox.length} demands decided`}
      </p>
      <button type="button" className="primary" onClick={onContinue}>
        {blocking
          ? `Respond to ${blocking.from} to continue`
          : open
            ? `Decide ${open} more demand${open === 1 ? "" : "s"} →`
            : "Continue to Friday →"}
      </button>
      <nav aria-label="Main navigation">
        {(Object.keys(PATHS) as Tab[]).map((t) => (
          <button
            type="button"
            key={t}
            className={`tab ${active === t ? "active" : ""}`}
            aria-current={active === t ? "page" : undefined}
            onClick={() => onTab(t)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d={PATHS[t]} />
            </svg>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
    </footer>
  );
}

export function Btn({
  children,
  onClick,
  kind = "secondary",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "secondary" | "back";
  disabled?: boolean;
}) {
  return (
    <button type="button" className={kind} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export const money = (n: number) => `$${n.toLocaleString("en-US")}`;

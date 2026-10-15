"use client";

import { Fragment, type ReactNode } from "react";
import { COMPANIES, KEYNOTE_WEEK, PACKET_TARGET } from "@/content/companies";
import { blockingItem, planCost, undecided } from "@/engine/plan";
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
  onTheme,
  bar = true,
}: {
  s: GameState | null;
  title?: string;
  edition?: string;
  onTheme: () => void;
  bar?: boolean; // the red EM27 title bar; the title screen has its own hero instead
}) {
  return (
    <>
      <div className="window-caption">
        <span>▣ Engineering Manager 2027</span>
        <button type="button" onClick={onTheme} aria-label="Switch light or dark theme">
          ◐ ▱ □ ×
        </button>
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
      {s && s.phase !== "recap" && (
        <div className="season">
          <span>
            Q{s.quarter} / {s.level.toUpperCase()}
          </span>
          <span>WEEK {String(s.week).padStart(2, "0")} OF 12 · {s.phase === "plan" ? "MON" : "FRI"}</span>
        </div>
      )}
      {s && s.phase !== "recap" && <CompanyStatus s={s} />}
    </>
  );
}

export function CompanyStatus({ s }: { s: GameState }) {
  if (s.company === "Vercel") {
    const flagship = s.projects.find((p) => p.flagship);
    const done = flagship && flagship.status !== "active";
    return (
      <div className="company-status">
        <b>KEYNOTE / WK {KEYNOTE_WEEK}</b>
        <span>
          {s.week > KEYNOTE_WEEK || (s.week === KEYNOTE_WEEK && s.phase !== "plan")
            ? flagship?.status === "shipped"
              ? "Shipped on stage"
              : "Keynote missed"
            : done && flagship!.status === "shipped"
              ? `Ready for stage · ${KEYNOTE_WEEK - s.week === 0 ? "this Friday" : `${KEYNOTE_WEEK - s.week} wk${KEYNOTE_WEEK - s.week === 1 ? "" : "s"}`}`
            : done
              ? "Flagship missed its date"
            : s.week < KEYNOTE_WEEK
              ? `${KEYNOTE_WEEK - s.week} week${KEYNOTE_WEEK - s.week === 1 ? "" : "s"} to stage`
              : s.week === KEYNOTE_WEEK
                ? "ON STAGE THIS FRIDAY"
                : "Keynote completed"}{" "}
          · fixed date
        </span>
      </div>
    );
  }
  if (s.company === "Stripe") {
    return (
      <div className="company-status">
        <b>INCIDENT REVIEWS</b>
        <span>
          {s.pendingPostmortem && s.phase === "plan" ? "Postmortem due this week" : `Incident Trust hit ×2${s.incidentMultiplier > 1 ? ` · ×${s.incidentMultiplier} penalty` : ""}`}
        </span>
      </div>
    );
  }
  return (
    <div className="company-status">
      <b>PROMO PACKET</b>
      <span>
        {s.packet}/{PACKET_TARGET} evidence · calibration at review
      </span>
    </div>
  );
}

export function Calendar({ s, onAgenda }: { s: GameState; onAgenda: () => void }) {
  const used = planCost(s);
  const cap = s.capacity;
  const shown = Math.min(Math.max(cap, used), 12);
  return (
    <section className="calendar" aria-label="Calendar budget">
      <div className="cal-head">
        <span className="eyebrow">
          WEEK {s.week} / {s.level.toUpperCase()}
        </span>
        <span className={`cal-value ${used > cap ? "bad" : ""}`}>{used > cap ? `${used - cap} OVERBOOKED` : `${cap - used} OF ${cap} LEFT`}</span>
      </div>
      <div className="slots" aria-label={`${used} slots used, ${cap} available`}>
        {Array.from({ length: shown }, (_, i) => (
          <span key={i} className={`slot ${i < used ? "filled" : ""} ${i >= cap ? "extra" : ""}`}>
            {i < used ? (i >= cap ? "+" : "■") : "·"}
          </span>
        ))}
        {used > 12 && <span className="slot extra">+{used - 12}</span>}
      </div>
      <div className="cal-foot">
        <span>{used > cap ? "! Extra time adds Stress" : `${used} booked · ${cap - used} available`}</span>
        <button type="button" onClick={onAgenda}>
          View bookings ↓
        </button>
      </div>
    </section>
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

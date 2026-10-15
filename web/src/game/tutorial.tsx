"use client";

import { useState, type ReactNode } from "react";
import { COMPANIES } from "@/content/companies";
import type { CompanyId } from "@/engine/types";
import { Btn } from "./ui";

export const TUTORIAL_KEY = "em27.tutorial.seen";

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === "1";
  } catch {
    return false;
  }
}

export function markTutorialSeen(): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, "1");
  } catch {
    /* per-device convenience only */
  }
}

/** A static row of calendar slots, as an illustration. */
function SlotsDemo({ used, cap = 8 }: { used: number; cap?: number }) {
  return (
    <div className="slots" aria-label={`${used} of ${cap} slots booked`} style={{ margin: "10px 0" }}>
      {Array.from({ length: Math.max(cap, used) }, (_, i) => (
        <span key={i} className={`slot ${i < used ? "filled" : ""} ${i >= cap ? "extra" : ""}`}>
          {i < used ? (i >= cap ? "+" : "■") : "·"}
        </span>
      ))}
    </div>
  );
}

interface Step {
  eyebrow: string;
  title: string;
  body: ReactNode;
}

function steps(company: CompanyId | null): Step[] {
  return [
    {
      eyebrow: "THE JOB",
      title: "You’re the engineering manager.",
      body: (
        <>
          <p className="subtitle">You run a team of six engineers. Each week has two halves:</p>
          <div className="panel">
            <div className="why">
              <b>Monday · you plan</b>
              <small>Decide what gets your time and who works on what.</small>
            </div>
            <div className="why">
              <b>Friday · it plays out</b>
              <small>Projects move, the pager fires, people react.</small>
            </div>
          </div>
          <p className="helper">12 weeks make a quarter, then you get a review. Climb to Director to win. Get fired twice and the run is over.</p>
        </>
      ),
    },
    {
      eyebrow: "THE CALENDAR",
      title: "You have 8 slots a week.",
      body: (
        <>
          <SlotsDemo used={3} />
          <p className="subtitle">There are always more demands than time. That’s the point.</p>
          <div className="panel">
            <div className="why">
              <b>Respond</b>
              <small>Costs 0–3 slots. Usually the better outcome.</small>
            </div>
            <div className="why">
              <b>Ignore</b>
              <small>Free, but it still plays out on Friday, often badly.</small>
            </div>
            <div className="why">
              <b className="bad">! Must respond</b>
              <small>One red demand a week can’t be ignored.</small>
            </div>
          </div>
          <p className="helper">Every demand needs a decision before Friday. You can go over 8 slots, but it adds Stress, and high Stress shrinks next week’s calendar.</p>
        </>
      ),
    },
    {
      eyebrow: "CHOOSING",
      title: "Read the hints.",
      body: (
        <>
          <p className="subtitle">Each response shows its cost and which way things will move.</p>
          <div className="intent" aria-hidden="true">
            <span className="intent-main">
              <span>Commit to the promo, in writing</span>
              <span className="cost">1 slot</span>
            </span>
            <span className="intent-hints">Morale ↑ · Promise due wk 10</span>
          </div>
          <p className="helper">Hints show direction, not exact numbers. You can change your mind until you press Continue. Promises are remembered, and they come back when they’re due.</p>
        </>
      ),
    },
    {
      eyebrow: "PROJECTS",
      title: "Staff your projects.",
      body: (
        <>
          <p className="subtitle">Engineers on a project add points to it every Friday. 100 points ships it.</p>
          <div className="panel project">
            <div className="split">
              <b>Checkout v2</b>
              <span className="mini good">On track</span>
            </div>
            <div className="meter" role="img" aria-label="Example project at 45 of 100 points">
              <b style={{ width: "45%" }} />
              <span className="deadline" style={{ left: "40%" }} />
            </div>
            <p className="mini">45 / 100 POINTS · DUE WEEK 6 · ~19/WK</p>
          </div>
          <div className="panel">
            <div className="why">
              <b>More people, faster</b>
              <small>Strong Coding, Morale and Energy add the most.</small>
            </div>
            <div className="why">
              <b>Ship before the due week</b>
              <small>Missing a date costs Trust and Reputation.</small>
            </div>
            <div className="why">
              <b>Rest and on call</b>
              <small>Unassigned engineers recover Energy. Someone also needs to be on call.</small>
            </div>
          </div>
          <p className="helper">Assigning is free. Change it any time on the Projects tab.</p>
        </>
      ),
    },
    {
      eyebrow: "FRIDAY",
      title: "Friday tells you why.",
      body: (
        <>
          <div className="commentary">
            <time>14:40</time>
            <p>
              PagerDuty fires. Dana is on call (Debugging 8)…
              <small>Incident roll · Tech Debt raises the odds</small>
            </p>
          </div>
          <div className="delta" style={{ marginTop: 10 }}>
            <b className="bad">↓ 4</b>
            <div>
              <strong>Dana’s Energy</strong>
              <small>Three-hour incident</small>
            </div>
          </div>
          <p className="helper">
            The back page lists every number that changed, and the cause. Tap any engineer to see their history. A 1:1 (1 slot) reveals hidden traits and how loyal they are.
          </p>
        </>
      ),
    },
    {
      eyebrow: "THE REVIEW",
      title: "Week 12 decides your career.",
      body: (
        <>
          <div className="rating-lines">
            <span>Delivery · did projects ship?</span>
            <b>40%</b>
            <span>Team health · morale, energy, who left</span>
            <b>30%</b>
            <span>Stakeholder Trust</span>
            <b>30%</b>
          </div>
          <p className="helper" style={{ marginTop: 12 }}>
            Two strong quarters in a row gets you promoted. A bad one gets you fired, and you job-hunt at another company. You get a check-in with your boss in week 6.
          </p>
          {company && (
            <div className="notice">
              <b>At {company}:</b>
              <p>{COMPANIES[company].mechanic}</p>
            </div>
          )}
        </>
      ),
    },
  ];
}

export function Tutorial({ company, finishLabel, onDone }: { company: CompanyId | null; finishLabel: string; onDone: () => void }) {
  const all = steps(company);
  const [i, setI] = useState(0);
  const step = all[i];
  const last = i === all.length - 1;
  return (
    <>
      <div className="split">
        <span className="eyebrow">
          HOW TO PLAY · {step.eyebrow}
        </span>
        <span className="mini">
          {i + 1} / {all.length}
        </span>
      </div>
      <h1 style={{ marginTop: 8 }}>{step.title}</h1>
      {step.body}
      <div style={{ marginTop: 16 }}>
        <Btn
          kind="primary"
          onClick={() => {
            if (last) {
              markTutorialSeen();
              onDone();
            } else setI(i + 1);
          }}
        >
          {last ? finishLabel : "Next →"}
        </Btn>
        {i > 0 && <Btn onClick={() => setI(i - 1)}>← Back</Btn>}
        {!last && (
          <Btn
            onClick={() => {
              markTutorialSeen();
              onDone();
            }}
          >
            Skip the tutorial
          </Btn>
        )}
      </div>
    </>
  );
}

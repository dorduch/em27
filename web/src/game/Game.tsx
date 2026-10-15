"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  acceptOffer,
  applyReview,
  backToHunt,
  chooseOffer,
  declineOffer,
  leverageOffer,
  startNewJob,
} from "@/engine/career";
import { applyDirectorPlan, directorBrief } from "@/engine/director";
import { planCost, undecided } from "@/engine/plan";
import { advanceFromBackPage, finishCheckin, finishFriday, resolveWeek } from "@/engine/resolve";
import { newGame } from "@/engine/setup";
import type { CompanyId, DirectorPlan, GameState } from "@/engine/types";
import {
  AssignScreen,
  CareerScreen,
  EventScreen,
  OfficeScreen,
  PacketScreen,
  PlayerScreen,
  ProjectsScreen,
  SquadScreen,
  WeekScreen,
  type View,
} from "./planning";
import {
  BackPageScreen,
  CheckinScreen,
  FarewellScreen,
  FridayScreen,
  HuntScreen,
  OfferScreen,
  RecapScreen,
  ReviewScreen,
  TitleScreen,
} from "./phases";
import { track } from "./analytics";
import { loadSave, writeSave } from "./save";
import { Tutorial, tutorialSeen } from "./tutorial";
import { Calendar, Dock, Header, type Tab } from "./ui";

const tabFor = (v: View): Tab =>
  v.name === "event" || v.name === "week" || v.name === "packet"
    ? "week"
    : v.name === "player" || v.name === "squad"
      ? "squad"
      : v.name === "assign" || v.name === "projects"
        ? "projects"
        : "office";

export default function Game() {
  const [game, setGameState] = useState<GameState | null>(null);
  const [saved] = useState<GameState | null>(() => loadSave());
  const [onTitle, setOnTitle] = useState(true);
  const [view, setView] = useState<View>({ name: "week" });
  const [toastMsg, setToastMsg] = useState("");
  const [storageOK, setStorageOK] = useState(true);
  // The how-to-play screens: on a first career, replayed from Office, or opened from the title.
  const [intro, setIntro] = useState<null | "first" | "replay" | "title">(null);
  // Title screen: whether the company picker is open (the tutorial opens it when finished from the title).
  const [pickerOpen, setPickerOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mainRef = useRef<HTMLElement>(null);

  // Latest state for async callbacks (the director answers after a delay).
  const gameRef = useRef<GameState | null>(null);

  // Every state change is saved immediately.
  const setGame = useCallback((s: GameState) => {
    gameRef.current = s;
    setGameState(s);
    setStorageOK(writeSave(s));
  }, []);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 2800);
  }, []);

  const go = useCallback((v: View) => {
    setView(v);
    mainRef.current?.scrollTo({ top: 0 });
    if (v.name === "event") mainRef.current?.focus({ preventScroll: true });
  }, []);

  // Why the last director request did or didn't shape the inbox (shown in the Week debug panel).
  const [directorStatus, setDirectorStatus] = useState("");

  /** Ask the AI director for next week's demands while Friday plays. Never blocks the game. */
  const askDirector = useCallback(async (s: GameState) => {
    const brief = directorBrief(s);
    if (!brief) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const res = await fetch("/api/director", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(brief),
        signal: ctrl.signal,
      });
      const body = await res.json();
      if (!res.ok || !body.plan) {
        setDirectorStatus(`Random draw: ${body.reason ?? `director returned ${res.status}`}.`);
        return;
      }
      // Only apply to the same week, and only before Monday's inbox exists.
      const current = gameRef.current;
      const result = current && current.quarter === s.quarter && current.week === s.week ? applyDirectorPlan(current, body.plan as DirectorPlan) : null;
      if (result?.accepted) {
        setGame(result.state);
        setDirectorStatus("");
      } else {
        setDirectorStatus("Random draw: the director's picks didn't pass validation, or arrived after Monday.");
      }
    } catch {
      setDirectorStatus("Random draw: the director didn't answer in time.");
    } finally {
      clearTimeout(timer);
    }
  }, [setGame]);

  // Phase changes always start at the top of the page.
  const phase = game?.phase;
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [phase, onTitle, intro]);

  const toggleTheme = () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("em27.theme", next);
    } catch {
      /* per-device convenience only */
    }
  };

  const start = (company: CompanyId) => {
    const seed = Math.floor(Math.random() * 2 ** 31);
    const s = newGame(company, seed);
    setGame(s);
    setOnTitle(false);
    setView({ name: "week" });
    track("career_start", { company });
    if (!tutorialSeen()) setIntro("first");
    else toast("New career · your team is ready");
  };

  let content: React.ReactNode;
  let planning = false;
  let headerTitle: string | undefined;
  let headerEdition: string | undefined;

  if (intro) {
    content = (
      <Tutorial
        company={intro === "title" ? null : (game?.company ?? null)}
        finishLabel={intro === "first" ? "Start week 1 →" : intro === "replay" ? "Back to the game →" : "Got it →"}
        onDone={() => {
          if (intro === "first") toast("Your team is ready · start with the red demand");
          track("tutorial_done", { mode: intro });
          if (intro === "title") setPickerOpen(true);
          setIntro(null);
        }}
      />
    );
  } else if (onTitle || !game) {
    content = (
      <TitleScreen
        saved={saved}
        picking={pickerOpen}
        setPicking={setPickerOpen}
        onHowTo={() => setIntro("title")}
        onTheme={toggleTheme}
        onStart={start}
        onResume={() => {
          if (saved) {
            setGame(saved);
            setOnTitle(false);
            setView({ name: "week" });
          }
        }}
      />
    );
  } else {
    const props = { s: game, set: setGame, go, toast };
    switch (game.phase) {
      case "plan": {
        planning = true;
        if (view.name === "player") {
          const e = game.engineers.find((x) => x.id === view.id);
          if (e) {
            headerTitle = e.name;
            headerEdition = `L${e.level} · ${e.level >= 5 ? "SENIOR ENGINEER" : "ENGINEER"}`;
          }
        }
        content =
          view.name === "event" ? (
            <EventScreen {...props} itemId={view.itemId} />
          ) : view.name === "squad" ? (
            <SquadScreen {...props} />
          ) : view.name === "player" ? (
            <PlayerScreen {...props} id={view.id} />
          ) : view.name === "projects" ? (
            <ProjectsScreen {...props} />
          ) : view.name === "assign" ? (
            <AssignScreen {...props} projectId={view.projectId} />
          ) : view.name === "office" ? (
            <OfficeScreen {...props} onNewGame={() => setOnTitle(true)} onTheme={toggleTheme} onHowTo={() => setIntro("replay")} />
          ) : view.name === "career" ? (
            <CareerScreen {...props} />
          ) : view.name === "packet" ? (
            <PacketScreen {...props} />
          ) : (
            <WeekScreen {...props} directorStatus={directorStatus} />
          );
        break;
      }
      case "friday":
        content = <FridayScreen key={`${game.quarter}-${game.week}`} s={game} onDone={() => setGame(finishFriday(game))} />;
        break;
      case "back":
        content = (
          <BackPageScreen
            s={game}
            onNext={() => {
              setGame(advanceFromBackPage(game));
              setView({ name: "week" });
            }}
          />
        );
        break;
      case "checkin":
        content = <CheckinScreen s={game} onDone={(f) => setGame(finishCheckin(game, f))} />;
        break;
      case "review":
        content = (
          <ReviewScreen
            key={`review-${game.quarter}`}
            s={game}
            onContinue={() => {
              const next = applyReview(game);
              const r = game.review!;
              track("quarter_review", { company: game.company, level: game.level, quarter: game.quarter, grade: r.grade, outcome: r.outcome, score: r.weighted });
              if (next.runEnd) track("run_end", { result: next.runEnd, quarters: next.history.filter((h) => h.grade !== "New role").length, company: next.company });
              setGame(next);
              setView({ name: "week" });
              if (next.phase === "plan") toast(next.level !== game.level ? `${next.level} · ${next.engineers.length} engineers · ${next.capacity} slots` : `Q${next.quarter} begins · same squad`);
            }}
          />
        );
        break;
      case "hunt":
        content = <HuntScreen s={game} onPick={(o) => setGame(chooseOffer(game, o))} />;
        break;
      case "offer":
        content = (
          <OfferScreen
            s={game}
            onAccept={() => {
              track("career_offer", { kind: game.pendingOffer!.kind, action: "accept", company: game.pendingOffer!.company, level: game.pendingOffer!.level });
              setGame(acceptOffer(game));
            }}
            onBack={() => setGame(backToHunt(game))}
            onDecline={() => {
              track("career_offer", { kind: "poach", action: "decline", company: game.pendingOffer!.company, level: game.pendingOffer!.level });
              setGame(declineOffer(game));
              toast("Offer declined · squad Loyalty ↑");
            }}
            onLeverage={() => {
              const before = game.stakeholders.find((x) => x.role === "skip")!.trust;
              track("career_offer", { kind: "poach", action: "leverage", company: game.pendingOffer!.company, level: game.pendingOffer!.level });
              const next = leverageOffer(game);
              const after = next.stakeholders.find((x) => x.role === "skip")!.trust;
              setGame(next);
              toast(`Political Capital +10 · Skip Trust −${before - after}${before - after > 8 ? " · it backfired" : ""}`);
            }}
          />
        );
        break;
      case "farewell":
        content = (
          <FarewellScreen
            s={game}
            onStart={() => {
              const next = startNewJob(game);
              setGame(next);
              setView({ name: "week" });
              toast(`Welcome to ${next.company} · Reputation carried over`);
            }}
          />
        );
        break;
      case "recap":
        content = <RecapScreen s={game} onNewGame={start} toast={toast} />;
        break;
    }
  }

  const onContinue = () => {
    if (!game) return;
    // Every demand needs a decision before Friday. Ignore counts; only the must-respond item can't be ignored.
    const open = undecided(game);
    if (open.length) {
      go({ name: "event", itemId: open[0].id });
      toast(
        open[0].required
          ? `${open[0].from} needs a response before you lock the week.`
          : `${open.length} demand${open.length === 1 ? "" : "s"} left · respond or ignore`,
      );
      return;
    }
    const resolved = resolveWeek(game);
    const used = planCost(game);
    track("week_locked", {
      company: game.company,
      level: game.level,
      quarter: game.quarter,
      week: game.week,
      slots_used: used,
      capacity: game.capacity,
      overbooked: used > game.capacity,
      ignored: game.inbox.filter((i) => game.plan.choices[i.id] === "ignore").length,
      inbox_source: game.inboxSource.by,
    });
    for (const item of game.inbox) {
      track("demand_decision", { event_type: item.type, choice: game.plan.choices[item.id] ?? "ignore", required: item.required, company: game.company });
    }
    setGame(resolved);
    void askDirector(resolved);
  };

  return (
    <div className="device">
      <div className="app" id="app">
        <Header s={onTitle ? null : game} title={headerTitle} edition={headerEdition} bar={!(onTitle && !intro)} />
        {planning && game && <Calendar s={game} onAgenda={() => (view.name === "week" ? document.getElementById("agenda")?.scrollIntoView({ block: "center", behavior: "smooth" }) : go({ name: "week" }))} />}
        {/* Feedback appears just under the calendar (or the header), never over the controls it reports on. */}
        <div className="toast-anchor">
          <div id="toast" role="status" aria-live="polite" className={toastMsg ? "show" : ""}>
            {toastMsg}
          </div>
        </div>
        <main id="main" tabIndex={-1} ref={mainRef}>
          {!storageOK && (
            <div className="notice danger">
              <b>This device can’t save right now.</b>
              <p>Keep this tab open, or copy a save code from Office.</p>
            </div>
          )}
          {content}
        </main>
        {planning && game && (
          <Dock
            s={game}
            active={tabFor(view)}
            onTab={(t) => go({ name: t })}
            onContinue={onContinue}
          />
        )}
      </div>
    </div>
  );
}

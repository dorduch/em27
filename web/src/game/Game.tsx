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
import { undecided } from "@/engine/plan";
import { advanceFromBackPage, finishCheckin, finishFriday, resolveWeek } from "@/engine/resolve";
import { newGame } from "@/engine/setup";
import type { CompanyId, GameState } from "@/engine/types";
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
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mainRef = useRef<HTMLElement>(null);

  // Every state change is saved immediately.
  const setGame = useCallback((s: GameState) => {
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
          setIntro(null);
        }}
      />
    );
  } else if (onTitle || !game) {
    content = (
      <TitleScreen
        saved={saved}
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
            <WeekScreen {...props} />
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
            onAccept={() => setGame(acceptOffer(game))}
            onBack={() => setGame(backToHunt(game))}
            onDecline={() => {
              setGame(declineOffer(game));
              toast("Offer declined · squad Loyalty ↑");
            }}
            onLeverage={() => {
              const before = game.stakeholders.find((x) => x.role === "skip")!.trust;
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
    setGame(resolveWeek(game));
  };

  return (
    <div className="device">
      <div className="app" id="app">
        <Header s={onTitle ? null : game} title={headerTitle} edition={headerEdition} onTheme={toggleTheme} />
        {planning && game && <Calendar s={game} onAgenda={() => (view.name === "week" ? document.getElementById("agenda")?.scrollIntoView({ block: "center", behavior: "smooth" }) : go({ name: "week" }))} />}
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
      <div id="toast" role="status" aria-live="polite" className={toastMsg ? "show" : ""}>
        {toastMsg}
      </div>
    </div>
  );
}

"use client";

import dynamic from "next/dynamic";

// The game lives in localStorage, so it renders on the client only.
const Game = dynamic(() => import("@/game/Game"), { ssr: false });

export default function Page() {
  return <Game />;
}

"use client";

// Firebase Analytics (GA4). Only gameplay events, no personal data: engineer and
// stakeholder names are fictional and never sent. Does nothing until a measurement id
// is configured, in development, or where the browser blocks analytics.

import type { Analytics } from "firebase/analytics";

// Firebase web config is public by design; access is controlled by Firebase security settings.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBFL1XHD7M5-1xeWe9WjwQiJduK5U6YQHw",
  authDomain: "em27-game.firebaseapp.com",
  projectId: "em27-game",
  storageBucket: "em27-game.firebasestorage.app",
  messagingSenderId: "480776165801",
  appId: "1:480776165801:web:b8d6412506035c31694cb8",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-2GMQGVY3LZ",
};

const enabled = !!FIREBASE_CONFIG.measurementId && process.env.NODE_ENV === "production";

let analytics: Promise<Analytics | null> | null = null;

function load(): Promise<Analytics | null> {
  if (!enabled || typeof window === "undefined") return Promise.resolve(null);
  analytics ??= (async () => {
    try {
      const [{ initializeApp, getApps }, { getAnalytics, isSupported }] = await Promise.all([
        import("firebase/app"),
        import("firebase/analytics"),
      ]);
      if (!(await isSupported())) return null;
      const app = getApps()[0] ?? initializeApp(FIREBASE_CONFIG);
      return getAnalytics(app);
    } catch {
      return null;
    }
  })();
  return analytics;
}

export type GameEvent =
  | "career_start"
  | "tutorial_done"
  | "week_locked"
  | "demand_decision"
  | "quarter_review"
  | "career_offer"
  | "run_end";

/** Fire-and-forget. Never throws, never blocks gameplay. */
export function track(name: GameEvent, params: Record<string, string | number | boolean>): void {
  void load().then(async (a) => {
    if (!a) return;
    const { logEvent } = await import("firebase/analytics");
    logEvent(a, name, params);
  });
}

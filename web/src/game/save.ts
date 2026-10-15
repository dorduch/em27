import type { GameState } from "@/engine/types";

export const SAVE_KEY = "em27.save.v1";

function isGameState(v: unknown): v is GameState {
  const s = v as GameState;
  return !!s && s.version === 1 && Array.isArray(s.engineers) && Array.isArray(s.inbox) && typeof s.week === "number";
}

/** Fill fields added after a save was written, so older saves keep loading. */
function upgrade(s: GameState): GameState {
  return { ...s, directorPlan: s.directorPlan ?? null, inboxSource: s.inboxSource ?? { by: "random" } };
}

export function loadSave(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isGameState(parsed) ? upgrade(parsed) : null;
  } catch {
    return null;
  }
}

/** Returns false when storage is unavailable (private mode, quota). */
export function writeSave(s: GameState): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export function exportSave(s: GameState): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(s))));
}

export function importSave(text: string): GameState | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(text.trim()))));
    return isGameState(parsed) ? upgrade(parsed) : null;
  } catch {
    return null;
  }
}

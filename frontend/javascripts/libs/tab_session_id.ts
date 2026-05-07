/*
 * Provides TAB_SESSION_ID: a stable, unique identifier for the current browser tab.
 * It is persisted to sessionStorage so that it survives page reloads within the same tab.
 * If the tab was opened from an opener (e.g. Ctrl+click), its sessionStorage is
 * initially a copy of the opener's — in that case a fresh ID is generated to guarantee
 * uniqueness across tabs.
 */

import { getUid } from "libs/uid_generator";
import window from "libs/window";

const SESSION_ID_STORAGE_KEY = "wk_tab_session_id";

function getOrCreateSessionId(): string {
  if (window.opener != null) {
    // This tab inherited a copy of the opener's sessionStorage; discard it.
    const freshId = getUid();
    sessionStorage.setItem(SESSION_ID_STORAGE_KEY, freshId);
    return freshId;
  }
  const stored = sessionStorage.getItem(SESSION_ID_STORAGE_KEY);
  if (stored != null) {
    return stored;
  }
  const newId = getUid();
  sessionStorage.setItem(SESSION_ID_STORAGE_KEY, newId);
  return newId;
}

export const TAB_SESSION_ID = getOrCreateSessionId();

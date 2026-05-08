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

function getHumanReadablePrefix(): string {
  const ua = navigator.userAgent;

  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";

  let os = "Unknown";
  if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad/.test(ua)) os = "iOS";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac/.test(ua)) os = "Mac";
  else if (/Linux/.test(ua)) os = "Linux";

  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  return `${browser}_${os}_${date}_${time}`;
}

function createSessionId(): string {
  return `${getHumanReadablePrefix()}_${getUid()}`;
}

function getOrCreateSessionId(): string {
  if (window.opener != null) {
    // This tab inherited a copy of the opener's sessionStorage; discard it.
    const freshId = createSessionId();
    sessionStorage.setItem(SESSION_ID_STORAGE_KEY, freshId);
    return freshId;
  }
  const stored = sessionStorage.getItem(SESSION_ID_STORAGE_KEY);
  if (stored != null) {
    return stored;
  }
  const newId = createSessionId();
  sessionStorage.setItem(SESSION_ID_STORAGE_KEY, newId);
  return newId;
}

export const TAB_SESSION_ID = getOrCreateSessionId();

import {
  type BrowserKeyEvent,
  browserOnKeyPressedBinder,
  browserOnKeyReleasedBinder,
  getGlobalKeystrokes,
  setGlobalKeystrokesOptions,
} from "@rwh/keystrokes";

// Lives apart from libs/input.ts so that it can be unit tested without pulling in
// the Redux store (input.ts imports listener_helpers, which imports viewer/store).

// Must be set so that keystrokes reports the spacebar as "space" and not as " ".
export const KEY_REMAP = { " ": "space" };

// The pre-#9081 extended-command window was EXTENDED_COMMAND_DURATION = 3000ms.
// The keystrokes default is 1000ms, which is a noticeably tighter window for the
// "Control + k, <x>" tool switching chords.
export const SEQUENCE_TIMEOUT = 3000;

// Normalizes digit key events so that modifiers don't change the reported key name,
// e.g. Shift+2 on a US keyboard fires event.key="@", but the binding is "2".
// Note this is about *matching* only. Keeping keydown and keyup consistent is the
// library's job: it tracks held keys by KeyEvent#identity (event.code) rather than
// by the reported key, which otherwise strands keys whose label changes mid-press.
export function normalizeDigitKeyEvent(event: BrowserKeyEvent): BrowserKeyEvent {
  const code = event.originalEvent?.code ?? "";
  const match = code.match(/^Digit([0-9])$/);
  if (match) {
    return { ...event, key: match[1] };
  }
  return event;
}

export function initializeKeystrokes() {
  setGlobalKeystrokesOptions({
    keyRemap: KEY_REMAP,
    onKeyPressed: (handler) =>
      browserOnKeyPressedBinder((event) => handler(normalizeDigitKeyEvent(event))),
    onKeyReleased: (handler) =>
      browserOnKeyReleasedBinder((event) => handler(normalizeDigitKeyEvent(event))),
  });
  getGlobalKeystrokes().sequenceTimeout = SEQUENCE_TIMEOUT;
}

// No key state safety nets here on purpose. The library tracks held keys by physical
// key, so a key cannot get stranded by its label changing mid-press, and it already
// releases everything on blur, pagehide and visibilitychange. Adding another net on
// top would not be free either: releaseAllKeys() fires onReleased for keys that are
// genuinely held, so e.g. resetting on focusout would cut short a held movement key.
// Places that knowingly swallow keyups call releaseAllKeys() themselves — see
// shortcut_recorder_modal.tsx.

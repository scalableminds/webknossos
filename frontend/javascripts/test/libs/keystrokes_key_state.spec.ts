import { createTestKeystrokes } from "@rwh/keystrokes";
import { KEY_REMAP, normalizeDigitKeyEvent } from "libs/keystrokes_options";
import { describe, expect, it, vi } from "vitest";

// Guards the fix for the bug where every single-key shortcut (1, 2, 3, b, j, ...)
// stopped working for the rest of the session after typing a shifted punctuation
// character into any text field.
//
// The fix lives in the scalableminds fork of @rwh/keystrokes.
describe("keystrokes key state", () => {
  // Mirrors what the browser bindings pass: `identity` is the physical key
  // (event.code) and `key` is the label, which depends on modifier state.
  const ev = (key: string, code: string) => ({ key, aliases: [`@${code}`], identity: code }) as any;

  it("does not strand a key whose label differs between keydown and keyup", () => {
    const keystrokes = createTestKeystrokes({ keyRemap: KEY_REMAP });
    const branchPointHandler = vi.fn();
    keystrokes.bindKeyCombo("b", { onPressed: branchPointHandler });

    // Typing "?" and letting go of shift before the slash key: the keydown reports
    // "?" while the keyup reports "/".
    keystrokes.press(ev("shift", "ShiftLeft"));
    keystrokes.press(ev("?", "Slash"));
    keystrokes.release(ev("shift", "ShiftLeft"));
    keystrokes.release(ev("/", "Slash"));

    expect(keystrokes.pressedKeys).toEqual([]);

    // A stranded key sits at the head of the held-key list, and because combo
    // matching is positional that stops every single-key combo from matching.
    keystrokes.press(ev("b", "KeyB"));
    expect(branchPointHandler).toHaveBeenCalledTimes(1);
  });

  it("exposes releaseAllKeys so held state can be recovered", () => {
    const keystrokes = createTestKeystrokes({ keyRemap: KEY_REMAP });

    keystrokes.press(ev("b", "KeyB"));
    expect(keystrokes.pressedKeys).toEqual(["b"]);

    keystrokes.releaseAllKeys();
    expect(keystrokes.pressedKeys).toEqual([]);
  });
});

describe("normalizeDigitKeyEvent", () => {
  // Digits are normalized so that "shift + 2" still matches the binding "2".
  // This is about matching only; keeping keydown and keyup consistent is handled
  // by the library tracking keys via `identity`.
  it("reports the digit regardless of the modifiers held", () => {
    const digitEvent = (key: string) => ({ key, originalEvent: { code: "Digit3" } }) as any;

    expect(normalizeDigitKeyEvent(digitEvent("3")).key).toBe("3");
    expect(normalizeDigitKeyEvent(digitEvent("§")).key).toBe("3");
  });

  it("leaves non-digit keys untouched", () => {
    const event = { key: "?", originalEvent: { code: "Slash" } } as any;
    expect(normalizeDigitKeyEvent(event).key).toBe("?");
  });
});

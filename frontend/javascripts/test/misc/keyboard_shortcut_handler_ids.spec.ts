import {
  ALL_KEYBOARD_SHORTCUT_IDS,
  ALL_KEYBOARD_SHORTCUT_META_INFOS,
  getAllDefaultKeyboardShortcuts,
} from "viewer/view/keyboard_shortcuts/keyboard_shortcut_constants";
import { describe, expect, it } from "vitest";

describe("Keyboard shortcut handler IDs", () => {
  it("ALL_KEYBOARD_HANDLER_IDS contains no duplicate handler IDs", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const id of ALL_KEYBOARD_SHORTCUT_IDS) {
      if (seen.has(id)) duplicates.push(id);
      else seen.add(id);
    }
    // If this fails, the error output will list which IDs are duplicated.
    expect(duplicates).toHaveLength(0);
  });

  it("ALL_KEYBOARD_SHORTCUT_META_INFOS covers every handler ID", () => {
    const missing = ALL_KEYBOARD_SHORTCUT_IDS.filter(
      (id) => ALL_KEYBOARD_SHORTCUT_META_INFOS[id] == null,
    );
    expect(missing).toHaveLength(0);
  });

  it("getAllDefaultKeyboardShortcuts covers every handler ID", () => {
    const defaults = getAllDefaultKeyboardShortcuts();
    const missing = ALL_KEYBOARD_SHORTCUT_IDS.filter((id) => defaults[id] == null);
    expect(missing).toHaveLength(0);
  });
});

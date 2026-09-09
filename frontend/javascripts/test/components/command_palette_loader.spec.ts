import { shouldOpenCommandPalette } from "viewer/view/components/command_palette_loader";
import { describe, expect, it } from "vitest";

const keydown = (overrides: Partial<Parameters<typeof shouldOpenCommandPalette>[0]> = {}) => ({
  key: "p",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  target: null,
  ...overrides,
});

describe("shouldOpenCommandPalette", () => {
  it("opens on ctrl+p and cmd+p", () => {
    expect(shouldOpenCommandPalette(keydown({ ctrlKey: true }))).toBe(true);
    expect(shouldOpenCommandPalette(keydown({ metaKey: true }))).toBe(true);
  });

  it("is case insensitive, so it still fires when caps lock is on", () => {
    expect(shouldOpenCommandPalette(keydown({ key: "P", ctrlKey: true }))).toBe(true);
  });

  it("ignores p without a ctrl or cmd modifier", () => {
    expect(shouldOpenCommandPalette(keydown())).toBe(false);
  });

  it("ignores other keys", () => {
    expect(shouldOpenCommandPalette(keydown({ key: "k", ctrlKey: true }))).toBe(false);
  });

  it("ignores additional alt or shift modifiers, to avoid stealing other shortcuts", () => {
    expect(shouldOpenCommandPalette(keydown({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(shouldOpenCommandPalette(keydown({ ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it("does not fire while the user is typing in a form field", () => {
    for (const tagName of ["INPUT", "SELECT", "TEXTAREA"]) {
      expect(shouldOpenCommandPalette(keydown({ ctrlKey: true, target: { tagName } as any }))).toBe(
        false,
      );
    }
    expect(
      shouldOpenCommandPalette(
        keydown({ ctrlKey: true, target: { isContentEditable: true } as any }),
      ),
    ).toBe(false);
  });

  it("still fires when the event target is an ordinary element", () => {
    expect(
      shouldOpenCommandPalette(keydown({ ctrlKey: true, target: { tagName: "DIV" } as any })),
    ).toBe(true);
  });
});

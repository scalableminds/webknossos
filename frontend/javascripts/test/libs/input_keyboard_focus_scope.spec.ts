// @vitest-environment jsdom
import { InputKeyboard } from "libs/input";
import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom lacks matchMedia, which is needed when the store module is imported by libs/input.
vi.hoisted(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

const pressDelete = () => {
  const init = { key: "Delete", code: "Delete", bubbles: true };
  document.dispatchEvent(new KeyboardEvent("keydown", init));
  document.dispatchEvent(new KeyboardEvent("keyup", init));
};

describe("InputKeyboard focus scope", () => {
  const keyboards: InputKeyboard[] = [];
  afterEach(() => {
    for (const keyboard of keyboards.splice(0)) keyboard.destroy();
    document.body.innerHTML = "";
  });

  const setup = () => {
    document.body.innerHTML = `<div id="scope"><span id="inside" tabindex="0"></span><input id="input" /></div><span id="outside" tabindex="0"></span>`;
    const scope = document.getElementById("scope") as HTMLElement;
    const scoped = vi.fn();
    const global = vi.fn();
    keyboards.push(
      new InputKeyboard({ Delete: { onPressed: scoped } }, { focusScope: () => scope }),
      new InputKeyboard({ Delete: { onPressed: global } }),
    );
    return { scoped, global };
  };
  const focus = (id: string) => document.getElementById(id)?.focus();

  it("only triggers the scoped handler, and not the global one, while focus is inside the scope", () => {
    const { scoped, global } = setup();
    focus("inside");
    pressDelete();
    expect(scoped).toHaveBeenCalledTimes(1);
    expect(global).not.toHaveBeenCalled();
  });

  it("only triggers the global handler while focus is outside of the scope", () => {
    const { scoped, global } = setup();
    focus("outside");
    pressDelete();
    expect(scoped).not.toHaveBeenCalled();
    expect(global).toHaveBeenCalledTimes(1);
  });

  it("triggers neither handler while an editable element inside the scope is focused", () => {
    const { scoped, global } = setup();
    focus("input");
    pressDelete();
    expect(scoped).not.toHaveBeenCalled();
    expect(global).not.toHaveBeenCalled();
  });

  it("releases the claim when the scoped keyboard is destroyed", () => {
    const { scoped, global } = setup();
    keyboards[0].destroy();
    focus("inside");
    pressDelete();
    expect(scoped).not.toHaveBeenCalled();
    expect(global).toHaveBeenCalledTimes(1);
  });
});

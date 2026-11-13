import { InputKeyboard } from "libs/input";
import { useWkSelector } from "libs/react_hooks";
import { type RefObject, useEffect, useEffectEvent } from "react";
import type { KeyboardShortcutHandlerMap } from "viewer/view/keyboard_shortcuts/keyboard_shortcut_types";
import { buildKeyBindingsFromConfig } from "viewer/view/keyboard_shortcuts/keyboard_shortcut_utils";

/*
 * Registers the configurable shortcuts of the segment list. They only fire while the focus
 * is inside `containerRef`. While it is, the same key combos are ignored by all other
 * keyboards (e.g. Delete in the skeleton tool), so that one key press never does two things.
 * Text inputs inside the container (e.g. the rename input) keep their native key handling.
 */
export function useSegmentListKeyboardShortcuts(
  containerRef: RefObject<HTMLElement | null>,
  removeSelectedSegments: () => void,
) {
  const shortcutsConfig = useWkSelector((state) => state.keyboardConfiguration.shortcutsConfig);

  // Effect events keep the handler fresh without re-creating the keyboard on every render.
  const onRemoveSelectedSegments = useEffectEvent(removeSelectedSegments);

  useEffect(() => {
    const keyboardHandlers: Partial<KeyboardShortcutHandlerMap> = {
      REMOVE_SELECTED_SEGMENTS: {
        onPressed: () => onRemoveSelectedSegments(),
      },
    };
    // supportInputElements is needed so that a focused button inside a row doesn't swallow the
    // shortcut. Editable elements are excluded by the focus scope instead.
    const keyboard = new InputKeyboard(
      buildKeyBindingsFromConfig(shortcutsConfig, keyboardHandlers),
      { supportInputElements: true, focusScope: () => containerRef.current },
    );
    return () => keyboard.destroy();
  }, [shortcutsConfig, containerRef]);
}

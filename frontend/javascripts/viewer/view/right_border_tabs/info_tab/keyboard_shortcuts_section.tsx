import { useWkSelector } from "libs/react_hooks";
import type React from "react";
import constants from "viewer/constants";
import {
  Keycap,
  MouseLeftDragKeycap,
  MouseRightDragKeycap,
  MouseWheelKeycap,
} from "../../components/keycap";
import type { KeyboardShortcutId } from "../../keyboard_shortcuts/keyboard_shortcut_constants";
import type {
  KeyboardShortcutsMap,
  UnmodifiedLayoutMap,
} from "../../keyboard_shortcuts/keyboard_shortcut_types";
import { keySequenceToUiElements } from "../../keyboard_shortcuts/keyboard_shortcut_utils";
import { InfoTabSection } from "./info_tab_layout";

const SHORTCUT_DOCUMENTATION_URL =
  "https://docs.webknossos.org/webknossos/ui/keyboard_shortcuts.html";

type Shortcut = {
  key: string;
  action: string;
  keys: React.ReactNode[];
};

/** A separator ("/", "+") or a connector word ("or", "drag") between keycaps. */
function Connector({ children }: { children: React.ReactNode }) {
  return <span className="info-tab-shortcut-connector">{children}</span>;
}

const getShortcuts = (
  keyboardShortcutsConfig: KeyboardShortcutsMap,
  unmodifiedLayoutMap: UnmodifiedLayoutMap,
  isInPlaneMode: boolean,
): Shortcut[] => {
  const toKeycaps = (keyboardShortcutId: KeyboardShortcutId) =>
    (keyboardShortcutsConfig[keyboardShortcutId] ?? []).flatMap((keySeq, comboIndex) => {
      // Only single characters are capitalized for display ("i" reads better as "I" on a
      // keycap). Anything longer is a semantic identifier — "Control", "ArrowLeft",
      // "@BracketRight" — that sortKeyCombination, keyToUiElement and the layout map all
      // match verbatim, so uppercasing it would strand it as raw text in the wrong position.
      const capitalizedKeySeq = keySeq.map((keys) =>
        keys.map((key) => (key.length === 1 ? key.toUpperCase() : key)),
      );
      const elements = keySequenceToUiElements(
        capitalizedKeySeq,
        true,
        `${keyboardShortcutId}-${comboIndex}-`,
        unmodifiedLayoutMap,
      );
      // A shortcut can have several alternative bindings. Without a connector their caps
      // would sit side by side and read as one chord.
      return comboIndex === 0
        ? elements
        : [<Connector key={`${keyboardShortcutId}-alt-${comboIndex}`}>or</Connector>, ...elements];
    });

  return [
    {
      key: "zoom",
      action: "Zoom in / out",
      keys: [
        isInPlaneMode ? toKeycaps("ZOOM_IN_PLANE") : toKeycaps("ZOOM_IN_FLIGHT"),
        <Connector key="zoom-sep">/</Connector>,
        isInPlaneMode ? toKeycaps("ZOOM_OUT_PLANE") : toKeycaps("ZOOM_OUT_FLIGHT"),
      ],
    },
    {
      key: "move-3rd-axis",
      action: "Move along 3rd axis",
      keys: [
        <MouseWheelKeycap key="move-wheel" />,
        <Connector key="move-or">or</Connector>,
        isInPlaneMode
          ? toKeycaps("MOVE_ONE_BACKWARD_DIRECTION_AWARE")
          : toKeycaps("MOVE_BACKWARD_WITHOUT_RECORDING"),
        <Connector key="move-sep">/</Connector>,
        isInPlaneMode
          ? toKeycaps("MOVE_ONE_FORWARD_DIRECTION_AWARE")
          : toKeycaps("MOVE_FORWARD_WITHOUT_RECORDING"),
      ],
    },
    // Dragging means different things per view mode: in the plane viewports the left
    // button pans and the 3D viewport's trackball rotates on the right button (see
    // libs/trackball_controls.ts), while in flight/oblique mode a left drag yaws and
    // pitches the flycam (see arbitrary_controller.tsx) — it does not move.
    // The speed lines carry the "drag" meaning, so no connector word is needed.
    ...(isInPlaneMode
      ? [
          {
            key: "move",
            action: "Move",
            keys: [<MouseLeftDragKeycap key="move-mouse" />],
          },
          {
            key: "rotate",
            action: "Rotate 3D view",
            keys: [<MouseRightDragKeycap key="rotate-mouse" />],
          },
        ]
      : [
          {
            key: "rotate-flight",
            action: "Rotate",
            keys: [<MouseLeftDragKeycap key="rotate-flight-mouse" />],
          },
        ]),
    {
      key: "zoom-wheel",
      action: "Zoom with wheel",
      keys: [
        <Keycap key="alt">Alt</Keycap>,
        <Connector key="zoom-wheel-plus">+</Connector>,
        <MouseWheelKeycap key="zoom-wheel-mouse" />,
      ],
    },
  ];
};

export function KeyboardShortcutsSection() {
  const keyboardShortcutsConfig = useWkSelector(
    (state) => state.keyboardConfiguration.shortcutsConfig,
  );
  const unmodifiedLayoutMap = useWkSelector(
    (state) => state.keyboardConfiguration.unmodifiedLayoutMap,
  );
  const isPlaneMode = useWkSelector((state) =>
    constants.MODES_PLANE.includes(state.temporaryConfiguration.viewMode),
  );

  return (
    <InfoTabSection label="Keyboard shortcuts">
      {getShortcuts(keyboardShortcutsConfig, unmodifiedLayoutMap, isPlaneMode).map((shortcut) => (
        <div className="info-tab-shortcut-row" key={shortcut.key}>
          <div>{shortcut.action}</div>
          <div className="info-tab-shortcut-keys">{shortcut.keys}</div>
        </div>
      ))}
      <a
        className="info-tab-all-shortcuts"
        target="_blank"
        href={SHORTCUT_DOCUMENTATION_URL}
        rel="noopener noreferrer"
      >
        All shortcuts ›
      </a>
    </InfoTabSection>
  );
}

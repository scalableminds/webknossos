import Icon from "@ant-design/icons";
import IconMousewheel from "@images/icons/icon-mousewheel.svg?react";
import { Space, Typography } from "antd";
import { ThemedIcon } from "components/themed_icon";
import { useWkSelector } from "libs/react_hooks";
import type React from "react";
import constants from "viewer/constants";
import { KeyboardKeyIcon } from "../../components/keyboard_key_icon";
import type { KeyboardShortcutId } from "../../keyboard_shortcuts/keyboard_shortcut_constants";
import type {
  KeyboardShortcutsMap,
  UnmodifiedLayoutMap,
} from "../../keyboard_shortcuts/keyboard_shortcut_types";
import { keySequenceToUiElements } from "../../keyboard_shortcuts/keyboard_shortcut_utils";

type ShortcutInfo = {
  key: string;
  keybinding: React.ReactNode[];
  action: string;
};

const getShortcuts = (
  keyboardShortcutsConfig: KeyboardShortcutsMap,
  unmodifiedLayoutMap: UnmodifiedLayoutMap,
  isInPlaneMode: boolean,
): ShortcutInfo[] => {
  const toUiElement = (keyboardShortcutId: KeyboardShortcutId) =>
    (keyboardShortcutsConfig[keyboardShortcutId] ?? []).flatMap((keySeq, comboIndex) => {
      const capitalizedKeySeq = keySeq.map((keys) => keys.map((key) => key.toUpperCase()));
      return keySequenceToUiElements(
        capitalizedKeySeq,
        true,
        `${keyboardShortcutId}-${comboIndex}-`,
        unmodifiedLayoutMap,
      );
    });
  return [
    {
      key: "1",
      keybinding: [
        isInPlaneMode ? toUiElement("ZOOM_IN_PLANE") : toUiElement("ZOOM_IN_FLIGHT"),
        "/",
        isInPlaneMode ? toUiElement("ZOOM_OUT_PLANE") : toUiElement("ZOOM_OUT_FLIGHT"),

        "or",
        <KeyboardKeyIcon label="ALT" key="zoom-3" className="keyboard-key-icon" />,
        "+",

        <Icon
          component={IconMousewheel}
          key="zoom-4"
          className="keyboard-mouse-icon"
          aria-label="Mouse Wheel"
          title="Mouse Wheel"
          style={{ color: "var(--ant-color-primary)" }}
        />,
      ],
      action: "Zoom in/out",
    },
    {
      key: "2",
      keybinding: [
        <Icon
          component={IconMousewheel}
          key="move-1"
          className="keyboard-mouse-icon"
          aria-label="Mouse Wheel"
          title="Mouse Wheel"
          style={{ color: "var(--ant-color-primary)" }}
        />,
        "or",
        isInPlaneMode
          ? toUiElement("MOVE_ONE_BACKWARD_DIRECTION_AWARE")
          : toUiElement("MOVE_BACKWARD_WITHOUT_RECORDING"),
        "/",
        isInPlaneMode
          ? toUiElement("MOVE_ONE_FORWARD_DIRECTION_AWARE")
          : toUiElement("MOVE_FORWARD_WITHOUT_RECORDING"),
      ],
      action: "Move Along 3rd Axis",
    },
    {
      key: "3",
      keybinding: [
        <ThemedIcon
          name="icon-mouse-left"
          key="move"
          className="keyboard-mouse-icon"
          aria-label="Left Mouse Button Drag"
          style={{ color: "var(--ant-color-primary)" }}
        />,
      ],
      action: "Move",
    },
    {
      key: "4",
      keybinding: [
        <ThemedIcon
          name="icon-mouse-right"
          key="rotate"
          className="keyboard-mouse-icon"
          aria-label="Right Mouse Button Drag"
          style={{ color: "var(--ant-color-primary)" }}
        />,
        "in 3D View",
      ],
      action: "Rotate 3D View",
    },
  ];
};

export function KeyboardShortcutsBlock() {
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
    <div className="info-tab-block">
      <Typography.Title level={5}>Keyboard Shortcuts</Typography.Title>
      <p>
        Find the complete list of shortcuts in the{" "}
        <a
          target="_blank"
          href="https://docs.webknossos.org/webknossos/ui/keyboard_shortcuts.html"
          rel="noopener noreferrer"
        >
          documentation
        </a>
        .
      </p>
      <table className="shortcut-table-info-tab">
        <tbody>
          {getShortcuts(keyboardShortcutsConfig, unmodifiedLayoutMap, isPlaneMode).map(
            (shortcut) => (
              <tr key={shortcut.key}>
                <td
                  style={{
                    width: 170,
                  }}
                >
                  <Space size={4} align="center">
                    {shortcut.keybinding}
                  </Space>
                </td>
                <td>{shortcut.action}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

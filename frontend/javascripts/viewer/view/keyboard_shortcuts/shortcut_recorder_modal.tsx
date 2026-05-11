import { Alert, Button, Flex, Modal, Space, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { registerKeyForLayoutMap } from "./keyboard_layout_utils";
import {
  ALL_KEYBOARD_SHORTCUT_META_INFOS,
  type KeyboardShortcutId,
} from "./keyboard_shortcut_constants";
import {
  DOMAIN_DISPLAY_NAMES,
  type KeyboardShortcutsMap,
  type KeyCombination,
  type KeySequence,
} from "./keyboard_shortcut_types";
import {
  areComparableSequencesEqual,
  type Collision,
  checkCollisionForShortcut,
  keySequenceToComparableKeySequence,
  keySequenceToUiElements,
} from "./keyboard_shortcut_utils";

const { Text } = Typography;

type CollisionWarningAlertProps = {
  shortcutCollisions: Collision[];
};

export const CollisionWarningAlert: React.FC<CollisionWarningAlertProps> = ({
  shortcutCollisions,
}) => {
  const unmodifiedLayoutMap = useWkSelector(
    (state) => state.keyboardConfiguration.unmodifiedLayoutMap,
  );
  return (
    shortcutCollisions.length > 0 && (
      <Alert
        type="warning"
        style={{ marginTop: 16, marginBottom: 16 }}
        title="Shortcut Collisions Detected"
        description={
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {shortcutCollisions.map((collision, index) => {
              const keySequence = collision.keySequence.map((s) => [...s]);
              return (
                <li key={index}>
                  <Space wrap>
                    <span>
                      {keySequenceToUiElements(keySequence, false, "", unmodifiedLayoutMap)}
                    </span>
                    <Text>is used by:</Text>
                  </Space>
                  <ul style={{ margin: "2px 0 0", paddingLeft: 20 }}>
                    {collision.conflictingShortcutIds.map((id) => {
                      const meta = ALL_KEYBOARD_SHORTCUT_META_INFOS[id];
                      return (
                        <li key={id}>
                          <Text>
                            {meta
                              ? `${meta.description} (${DOMAIN_DISPLAY_NAMES[meta.domain]})`
                              : id}
                          </Text>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        }
      />
    )
  );
};

const SAMPLE_KEY_SEQUENCE: KeySequence = [["Control", "a"], ["o"]];

// Derive a layout-independent key identifier from a keyboard event.
// - Modifier keys (Shift, Control, Alt, Meta) are returned as-is.
// - ASCII letter keys use e.code ("KeyJ" → "j") so Shift+j stays "j", not "J".
// - Digit keys use e.code ("Digit2" → "2") so Shift+2 stays "2" on any layout.
// - Non-ASCII letter keys (ü, ö, ä, ß, …) are normalized to lowercase so that
//   Shift+ü records as "ü", not "Ü".
// - Dead keys (e.g. ^ on German keyboards fires e.key === "Dead") are resolved to
//   their base character via an e.code lookup table.
// - F-keys, Enter, Space, arrows, and all remaining named keys fall back to e.key.
function getKeyIdentifier(e: KeyboardEvent): string {
  if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) {
    return e.key;
  }
  // ASCII letters: e.code identifies the physical key position; e.keyCode gives the
  // layout-dependent letter (e.g. the Z-position key produces "y" on a German keyboard).
  // keyCode is deprecated but is the only cross-browser way to get this without the
  // Keyboard Layout API, which is not available in Firefox/Safari.
  const letterMatch = e.code.match(/^Key([A-Z])$/);
  if (letterMatch) {
    return String.fromCharCode(e.keyCode).toLowerCase();
  }
  // Digits: always the digit character regardless of Shift
  const digitMatch = e.code.match(/^Digit([0-9])$/);
  if (digitMatch) {
    return digitMatch[1];
  }
  // Non-ASCII single-character letter keys (ü, ö, ä, ß, é, …):
  // toLowerCase() !== toUpperCase() is true for any cased letter.
  if (e.key.length === 1 && e.key.toLowerCase() !== e.key.toUpperCase()) {
    return e.key.toLowerCase();
  }
  // Dead keys: certain sign keys act as dead keys on some layouts and fire
  // e.key === "Dead" instead of the actual character (e.g. ^ on German keyboards).
  // Resolve them to the base character via their physical key code.
  if (e.key === "Dead") {
    const deadKeyCharMap: Partial<Record<string, string>> = {
      Backquote: "^", // ^ on German keyboard (shifted: °)
      Equal: "´", // ´ acute-accent dead key on German keyboard
    };
    return deadKeyCharMap[e.code] ?? e.code;
  }
  // Normalize the Space key: e.key is " " but the codebase uses "Space".
  if (e.key === " ") return "Space";
  // Single printable-character keys (sign/punctuation): store as "@code" so the
  // binding is layout-independent. Keystrokes natively matches @code via its alias
  // system regardless of what character the key produces with any modifier held.
  // e.g. pressing "+" on a German keyboard (BracketRight) → "@BracketRight"
  //      pressing Shift+same key (* on German)            → "@BracketRight" too
  if (e.key.length === 1) {
    return `@${e.code}`;
  }
  // Named keys (F-keys, arrows, Enter, Escape, Tab, …) are the same on all layouts.
  return e.key;
}

type ShortcutRecorderModalProps = {
  keyboardShortcutConfig: KeyboardShortcutsMap;
  keyboardShortcutId: KeyboardShortcutId | null; // The handlerId for which the shortcut should be added.
  isOpen: boolean;
  initialKeySequence?: KeySequence; // optional preview of current binding
  onCancel: () => void; // do not overwrite
  onSave: (newKeySequence: KeySequence) => void; // returns final sequence like [["Control", "a"], ["o"]]
};

export function ShortcutRecorderModal({
  isOpen,
  keyboardShortcutId,
  keyboardShortcutConfig,
  initialKeySequence,
  onCancel,
  onSave,
}: ShortcutRecorderModalProps) {
  const unmodifiedLayoutMap = useWkSelector(
    (state) => state.keyboardConfiguration.unmodifiedLayoutMap,
  );
  const [keySequence, setKeySequence] = useState<KeySequence>(initialKeySequence ?? []);
  const [previewKeyCombination, setPreviewKeyCombination] = useState<KeyCombination>([]);
  const keyboardShortcutConfigWithoutInitialKeySequence = useMemo<KeyboardShortcutsMap>(() => {
    if (!keyboardShortcutId) {
      return keyboardShortcutConfig;
    }
    const shortcutWithoutInitialKeySequence = initialKeySequence
      ? keyboardShortcutConfig[keyboardShortcutId].filter(
          (seq) =>
            !areComparableSequencesEqual(
              keySequenceToComparableKeySequence(seq),
              keySequenceToComparableKeySequence(initialKeySequence),
            ),
        )
      : keyboardShortcutConfig[keyboardShortcutId];
    return { ...keyboardShortcutConfig, [keyboardShortcutId]: shortcutWithoutInitialKeySequence };
  }, [keyboardShortcutConfig, initialKeySequence, keyboardShortcutId]);

  const shortcutCollisions = useMemo(
    () =>
      keyboardShortcutId
        ? checkCollisionForShortcut(
            keyboardShortcutId,
            [...keyboardShortcutConfigWithoutInitialKeySequence[keyboardShortcutId], keySequence],
            keyboardShortcutConfigWithoutInitialKeySequence,
          )
        : [],
    [keySequence, keyboardShortcutId, keyboardShortcutConfigWithoutInitialKeySequence],
  );

  const currentDownSetRef = useRef<Set<string>>(new Set());
  const currentSeenSetRef = useRef<Set<string>>(new Set());

  const clearCurrentPreview = useCallback(() => {
    currentDownSetRef.current.clear();
    currentSeenSetRef.current.clear();
    setPreviewKeyCombination([]);
  }, []);

  const handleReset = useCallback(() => {
    setKeySequence([]);
    clearCurrentPreview();
  }, [clearCurrentPreview]);

  useEffect(() => {
    if (isOpen) {
      setKeySequence(initialKeySequence ?? []);
      clearCurrentPreview();
    } else {
      handleReset();
    }
  }, [isOpen, handleReset, clearCurrentPreview, initialKeySequence]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      // prevent the rest of the app reacting while recording
      e.preventDefault();
      e.stopPropagation();
      // Register the pressed key to the layout map if it is unmodified.
      // The layout map is used to display the proper base key for shortcuts with modifiers.
      registerKeyForLayoutMap(e);

      const pressedKeyId = getKeyIdentifier(e);

      // ignore repeated keydown for held keys (auto-repeat)
      if (currentDownSetRef.current.has(pressedKeyId)) {
        return;
      }
      currentDownSetRef.current.add(pressedKeyId);

      if (currentSeenSetRef.current.has(pressedKeyId)) {
        return;
      }

      // add to currentDown set & order
      currentSeenSetRef.current.add(pressedKeyId);

      // Update the preview state
      setPreviewKeyCombination((prevPreviewStroke) => [...prevPreviewStroke, pressedKeyId]);
    }

    function handleKeyUp(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      const pressedKeyId = getKeyIdentifier(e);

      // Remove from currentDown
      currentDownSetRef.current.delete(pressedKeyId);
      // Keep order array coherent: don't remove the entry from the order array (we only use order snapshot)
      // We only finalize when *no* keys remain pressed.

      if (currentDownSetRef.current.size === 0) {
        // Finalize this stroke using lastStrokeOrderRef
        setPreviewKeyCombination((prevPreviewKeyCombination) => {
          if (prevPreviewKeyCombination.length > 0) {
            setKeySequence((prevKeySequence) => [...prevKeySequence, prevPreviewKeyCombination]);
          }
          return prevPreviewKeyCombination;
        });
        // clear order and last snapshot
        clearCurrentPreview();
      }
    }

    // Also support user pressing Escape to cancel recording immediately
    function handleEscapeAndCtrlKey(e: KeyboardEvent) {
      if (e.key === "Escape" && e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        // behave like cancel: clear in-progress state but do not call onCancel
        // keep strokes previously completed strokes.
        handleReset();
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("keydown", handleEscapeAndCtrlKey, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("keydown", handleEscapeAndCtrlKey, true);
      // cleanup
      clearCurrentPreview();
    };
  }, [clearCurrentPreview, isOpen, handleReset]);

  function handleCancel() {
    // do not overwrite; simply call onCancel
    handleReset();
    onCancel();
  }

  function handleOk() {
    // final string
    if (keySequence.length > 0) {
      onSave(keySequence);
    } else {
      // Nothing was recorded so treat as cancelled.
      onCancel();
    }
    handleReset();
  }

  // remove last stroke
  function handleRemoveLastStroke() {
    setKeySequence((prev) => prev.slice(0, -1));
  }

  return (
    <Modal
      open={isOpen}
      onCancel={handleCancel}
      onOk={handleOk}
      okButtonProps={{ disabled: keySequence.length <= 0 || currentDownSetRef.current.size > 0 }}
      title="Record Shortcut"
      destroyOnHidden={true}
    >
      <div style={{ padding: 8 }}>
        <CollisionWarningAlert shortcutCollisions={shortcutCollisions} />
        <Text type="secondary">
          Press a keyboard combination now to record it. You can also record a sequence of keys.
          Example: {keySequenceToUiElements(SAMPLE_KEY_SEQUENCE, false, "", unmodifiedLayoutMap)}.
          Reset everything with <Text code>Ctrl</Text> + <Text code>Esc</Text>
        </Text>
        .
        <div
          style={{
            marginTop: 16,
            display: "flex",
            gap: 8,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{
                padding: 14,
                border: "1px dashed #d9d9d9",
                borderRadius: 6,
                minHeight: 56,
                display: "flex",
                alignItems: "center",
                fontSize: 16,
                background: "#fafafa",
              }}
            >
              <div style={{ width: "100%", overflow: "auto" }}>
                <Text strong>Recorded:</Text>{" "}
                <span style={{ marginLeft: 8 }}>
                  {keySequenceToUiElements(keySequence, false, "", unmodifiedLayoutMap) ||
                    "— waiting for user input —"}
                </span>
              </div>
            </div>
            <Flex style={{ marginTop: 8 }} justify={"flex-end"} align={"flex-start"} gap="middle">
              <Button onClick={handleRemoveLastStroke} disabled={keySequence.length === 0}>
                Remove last stroke
              </Button>
              <Button onClick={handleReset}>Reset</Button>
            </Flex>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <Text type="secondary">Current stroke preview (updates while keys are pressed):</Text>
          <div
            style={{
              marginTop: 8,
              padding: 10,
              borderRadius: 6,
              border: "1px solid #eee",
              minHeight: 44,
            }}
          >
            <Text italic>
              {previewKeyCombination.length > 0
                ? keySequenceToUiElements([previewKeyCombination], false, "", unmodifiedLayoutMap)
                : "— no keys down —"}
            </Text>
          </div>
        </div>
      </div>
    </Modal>
  );
}

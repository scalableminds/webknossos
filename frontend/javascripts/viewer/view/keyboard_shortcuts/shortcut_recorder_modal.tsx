import { Alert, Button, Flex, Modal, Space, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_KEYBOARD_SHORTCUT_META_INFOS,
  type KeyboardShortcutId,
} from "./keyboard_shortcut_constants";
import type {
  KeyboardShortcutDomain,
  KeyboardShortcutsMap,
  KeyCombination,
  KeySequence,
} from "./keyboard_shortcut_types";
import {
  areComparableSequencesEqual,
  type Collision,
  checkCollisionForShortcut,
  keySequenceToComparableKeySequence,
  keySequenceToUiElements,
} from "./keyboard_shortcut_utils";

const { Text } = Typography;

export const DomainNameToUiName: Record<KeyboardShortcutDomain, string> = {
  GENERAL: "General",
  GENERAL_EDITING: "General Editing",
  GENERAL_LAYOUT: "General Layout",
  GENERAL_COMMENT_TAB: "Comments Tab",
  ARBITRARY_NAVIGATION: "Arbitrary Mode Navigation",
  ARBITRARY_EDITING: "Arbitrary Mode Editing",
  PLANE_NAVIGATION: "Plane Mode Navigation",
  PLANE_TOOL_SWITCHING: "Plane Mode Tool Switching",
  PLANE_SKELETON_TOOL: "Plane Mode Skeleton Tool",
  PLANE_VOLUME_TOOL: "Plane Mode Volume Tool",
  PLANE_BOUNDING_BOX_TOOL: "Plane Mode Bounding Box Tool",
  PLANE_PROOFREADING_TOOL: "Plane Mode Proofreading Tool",
};

type CollisionWarningAlertProps = {
  shortcutCollisions: Collision[];
};

export const CollisionWarningAlert: React.FC<CollisionWarningAlertProps> = ({
  shortcutCollisions,
}) => {
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
                    <span>{keySequenceToUiElements(keySequence, false)}</span>
                    <Text>is used by:</Text>
                  </Space>
                  <ul style={{ margin: "2px 0 0", paddingLeft: 20 }}>
                    {collision.conflictingShortcutIds.map((id) => {
                      const meta = ALL_KEYBOARD_SHORTCUT_META_INFOS[id];
                      return (
                        <li key={id}>
                          <Text>
                            {meta ? `${meta.description} (${DomainNameToUiName[meta.domain]})` : id}
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
  // ASCII letters: always lowercase regardless of Shift
  const letterMatch = e.code.match(/^Key([A-Z])$/);
  if (letterMatch) {
    return letterMatch[1].toLowerCase();
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
  // All other keys: single printable sign characters (+, #, -, ., ,, …),
  // F-keys, Enter, arrows, etc. — use e.key directly.
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
  }, [clearCurrentPreview, isOpen, handleReset, keySequence]);

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
          Example: {keySequenceToUiElements(SAMPLE_KEY_SEQUENCE, false)}. Reset everything with{" "}
          <Text code>Ctrl</Text> + <Text code>Esc</Text>
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
                  {keySequenceToUiElements(keySequence, false) || "— waiting for user input —"}
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
                ? keySequenceToUiElements([previewKeyCombination], false)
                : "— no keys down —"}
            </Text>
          </div>
        </div>
      </div>
    </Modal>
  );
}

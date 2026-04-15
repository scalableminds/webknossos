import { Alert, Button, Flex, Modal, Space, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ALL_KEYBOARD_SHORTCUT_META_INFOS } from "./keyboard_shortcut_constants";
import type { KeyboardComboChain, KeyboardShortcutsMap } from "./keyboard_shortcut_types";
import {
  type Collision,
  checkCollisionForShortcut,
  keyComboChainToUiElements,
} from "./keyboard_shortcut_utils";

const { Text } = Typography;

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
              const comboChain = collision.keyCombo.map((s) => [...s]);
              return (
                <li key={index}>
                  <Space wrap>
                    <span>{keyComboChainToUiElements(comboChain, false)}</span>
                    <Text>is used by:</Text>
                  </Space>
                  <ul style={{ margin: "2px 0 0", paddingLeft: 20 }}>
                    {collision.conflictingHandlerIds.map((id) => {
                      const meta = ALL_KEYBOARD_SHORTCUT_META_INFOS[id];
                      return (
                        <li key={id}>
                          <Text>{meta ? `${meta.description} (${meta.domain})` : id}</Text>
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

const SampleKeyCombo: KeyboardComboChain = [["Control", "a"], ["o"]];

type ShortcutRecorderModalProps = {
  keyboardShortcutConfig: KeyboardShortcutsMap<string>;
  handlerId: string | null; // The handlerId for which the shortcut should be added.
  isOpen: boolean;
  initialKeyComboChain?: KeyboardComboChain; // optional preview of current binding
  onCancel: () => void; // do not overwrite
  onSave: (newKeyComboChain: KeyboardComboChain) => void; // returns final combo like [["Control", "a"], ["o"]]
};

export function ShortcutRecorderModal({
  isOpen,
  handlerId,
  keyboardShortcutConfig,
  initialKeyComboChain,
  onCancel,
  onSave,
}: ShortcutRecorderModalProps) {
  const [keyComboChain, setKeyComboChain] = useState<KeyboardComboChain>(
    initialKeyComboChain ?? [],
  );
  const [previewKeyCombo, setPreviewKeyCombo] = useState<string[]>([]);
  const shortcutCollisions = useMemo(
    () =>
      handlerId
        ? checkCollisionForShortcut(
            handlerId,
            [...keyboardShortcutConfig[handlerId], keyComboChain],
            keyboardShortcutConfig,
          )
        : [],
    [keyComboChain, handlerId, keyboardShortcutConfig],
  );

  const currentDownSetRef = useRef<Set<string>>(new Set());
  const currentSeenSetRef = useRef<Set<string>>(new Set());

  const clearCurrentPreview = useCallback(() => {
    currentDownSetRef.current.clear();
    currentSeenSetRef.current.clear();
    console.log("clearing");
    setPreviewKeyCombo([]);
  }, []);

  const handleReset = useCallback(() => {
    setKeyComboChain([]);
    console.log("resetting");
    clearCurrentPreview();
  }, [clearCurrentPreview]);

  useEffect(() => {
    if (!isOpen) {
      console.log("resetting as not open");
      handleReset();
    }
  }, [isOpen, handleReset]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      // prevent the rest of the app reacting while recording
      e.preventDefault();
      e.stopPropagation();

      const pressedKeyId = e.key;

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
      setPreviewKeyCombo((prevPreviewStroke) => [...prevPreviewStroke, pressedKeyId]);
    }

    function handleKeyUp(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      const pressedKeyId = e.key;

      // Remove from currentDown
      currentDownSetRef.current.delete(pressedKeyId);
      // Keep order array coherent: don't remove the entry from the order array (we only use order snapshot)
      // We only finalize when *no* keys remain pressed.

      if (currentDownSetRef.current.size === 0) {
        // Finalize this stroke using lastStrokeOrderRef
        setPreviewKeyCombo((prevPreviewKeyCombo) => {
          if (prevPreviewKeyCombo.length > 0) {
            setKeyComboChain([...keyComboChain, prevPreviewKeyCombo]);
          }
          return prevPreviewKeyCombo; // TODO maybe undo
        });
        // clear order and last snapshot
        console.log("clearing as no keys pressed");
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
        console.log("resetting as escape combo used");
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
      console.log("clearing as useEffect remount");
      clearCurrentPreview();
    };
  }, [clearCurrentPreview, isOpen, handleReset, keyComboChain]);

  function handleCancel() {
    // do not overwrite; simply call onCancel
    console.log("resetting due to handle cancel");
    handleReset();
    onCancel();
  }

  function handleOk() {
    // final string
    if (keyComboChain.length > 0) {
      onSave(keyComboChain);
    } else {
      // nothing recorded -> treat as cancel (or you can choose to save empty)
      onCancel();
    }
    console.log("resetting due to handleOk");
    handleReset();
  }

  // remove last stroke
  function handleRemoveLastStroke() {
    setKeyComboChain((prev) => prev.slice(0, -1));
  }

  console.log("rendering", previewKeyCombo);

  return (
    <Modal
      open={isOpen}
      onCancel={handleCancel}
      onOk={handleOk}
      okButtonProps={{ disabled: keyComboChain.length <= 0 || currentDownSetRef.current.size > 0 }}
      title="Record Shortcut"
      destroyOnHidden={true}
    >
      <div style={{ padding: 8 }}>
        <CollisionWarningAlert shortcutCollisions={shortcutCollisions} />
        <Text type="secondary">
          Press keys now. Release all keys to finish the current stroke. Press keys again to add a
          subsequent stroke. Example: {keyComboChainToUiElements(SampleKeyCombo, false)}. Reset
          everything with Esc + Ctrl.
        </Text>

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
                  {keyComboChainToUiElements(keyComboChain, false) || "— waiting —"}
                </span>
              </div>
            </div>
            <Flex style={{ marginTop: 8 }} justify={"flex-end"} align={"flex-start"} gap="middle">
              <Button onClick={handleRemoveLastStroke} disabled={keyComboChain.length === 0}>
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
              {previewKeyCombo.length > 0
                ? keyComboChainToUiElements([previewKeyCombo], false)
                : "— no keys down —"}
            </Text>
          </div>
        </div>
      </div>
    </Modal>
  );
}

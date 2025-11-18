import { Modal, Typography, Button, Flex } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeKeyName, formatKeyCombo, formatKeyComboChain } from "./keyboard_shortcut_utils";
import type { KeyboardComboChain } from "./keyboard_shortcut_constants";

const { Text } = Typography;

type ShortcutRecorderModalProps = {
  isOpen: boolean;
  initialKeyComboChain?: KeyboardComboChain; // optional preview of current binding
  onCancel: () => void; // do not overwrite
  onSave: (newKeyComboChain: KeyboardComboChain) => void; // returns final combo like "ctrl + a, o"
};

export function ShortcutRecorderModal({
  isOpen,
  initialKeyComboChain,
  onCancel,
  onSave,
}: ShortcutRecorderModalProps) {
  const [keyComboChain, setKeyComboChain] = useState<KeyboardComboChain>(
    initialKeyComboChain ?? [],
  );
  const [previewKeyCombo, setPreviewKeyCombo] = useState<string[]>([]);

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

      const raw = e.key;
      const normalized = normalizeKeyName(raw);

      // ignore repeated keydown for held keys (auto-repeat)
      if (currentDownSetRef.current.has(normalized)) {
        return;
      }
      currentDownSetRef.current.add(normalized);

      if (currentSeenSetRef.current.has(normalized)) {
        return;
      }

      // add to currentDown set & order
      currentSeenSetRef.current.add(normalized);

      // Update the preview state
      setPreviewKeyCombo((prevPreviewStroke) => [...prevPreviewStroke, normalized]);
    }

    function handleKeyUp(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      const raw = e.key;
      const normalized = normalizeKeyName(raw);

      // Remove from currentDown
      currentDownSetRef.current.delete(normalized);
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
      destroyOnClose={true}
    >
      <div style={{ padding: 8 }}>
        <Text type="secondary">
          Press keys now. Release all keys to finish the current stroke. Press keys again to add a
          subsequent stroke. Example: <code>ctrl + a, o</code>. Reset everything with Esc + Ctrl.
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
                  {formatKeyComboChain(keyComboChain) || "— waiting —"}
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
              {previewKeyCombo.length > 0 ? formatKeyCombo(previewKeyCombo) : "— no keys down —"}
            </Text>
          </div>
        </div>
      </div>
    </Modal>
  );
}

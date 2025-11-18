import { useState, useMemo } from "react";
import { Modal, Table, Switch, Input, Button, Typography, Space, Flex } from "antd";
import { EditOutlined, RollbackOutlined } from "@ant-design/icons";
import { Validator } from "jsonschema";
import {
  ALL_HANDLER_IDS,
  GeneralEditingKeyboardShortcuts,
  KeyboardShortcutsSchema,
} from "viewer/view/keyboard_shortcuts/keyboard_shortcut_constants";
import {
  getDefaultShortcuts,
  loadKeyboardShortcuts,
  saveKeyboardShortcuts,
} from "./keyboard_shortcut_persistence";
import app from "app";
import { ShortcutRecorderModal } from "./shortcut_recorder_modal";

const { Text, Title } = Typography;

export type ShortcutConfigModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

function validateShortcutMapText(input: string): {
  valid: boolean;
  errors: string[];
  parsed: Record<string, string> | null;
} {
  const errors: string[] = [];
  let parsed: any = null;

  // 1. JSON parsing
  try {
    parsed = JSON.parse(input);
  } catch (err) {
    return { valid: false, errors: ["Invalid JSON: " + err], parsed: null };
  }

  // 2. Schema validation
  const validator = new Validator();
  const schemaResult = validator.validate(parsed, KeyboardShortcutsSchema);

  if (!schemaResult.valid) {
    errors.push(...schemaResult.errors.map((e) => `Schema: ${e.stack}`));
  }

  // 3. Custom "each handler must appear"
  const values = new Set(Object.values(parsed));

  for (const id of ALL_HANDLER_IDS) {
    if (!values.has(id)) {
      errors.push(`Handler '${id}' is missing. Add a keybinding for this action.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    parsed,
  };
}

export default function KeyboardShortcutConfigModal({ isOpen, onClose }: ShortcutConfigModalProps) {
  const [isJsonView, setIsJsonView] = useState(false);
  const [isRecorderOpen, setIsRecorderOpen] = useState(false);
  const [recorderTargetHandlerId, setRecorderTargetHandlerId] = useState<string | null>(null);
  const [localConfig, setLocalConfig] = useState(loadKeyboardShortcuts());

  const [jsonString, setJsonString] = useState(() => JSON.stringify(localConfig, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Convert config into grouped table rows
  const tableData = useMemo(() => {
    const rows = Object.entries(localConfig).map(([handlerId, keyCombos]) => ({
      key: handlerId,
      combos: keyCombos,
      handlerId,
      group: handlerId in GeneralEditingKeyboardShortcuts ? "General Editing" : "General",
    }));
    return rows;
  }, [localConfig]);

  const columns = [
    {
      title: "Shortcut",
      dataIndex: "combo",
      key: "combo",
    },
    {
      title: "Action",
      dataIndex: "handlerId",
      key: "handlerId",
      render: (handlerId: string) =>
        handlerId in HandlerIdToNameMap
          ? HandlerIdToNameMap[handlerId as keyof typeof HandlerIdToNameMap]
          : handlerId,
    },
    {
      title: "Edit",
      key: "edit",
      render: (_: any, record: any) => (
        <Button
          style={{ padding: "0px 20px" }}
          icon={<EditOutlined />}
          onClick={() => {
            setRecorderTargetHandlerId(record.handlerId);
            setIsRecorderOpen(true);
          }}
        />
      ),
    },
  ];

  // Handle JSON editor changes
  const onChangeJson = (value: string) => {
    setJsonString(value);
    const { valid, errors, parsed } = validateShortcutMapText(value);
    if (valid && parsed) {
      setLocalConfig(parsed);
    }
    if (valid) {
      setJsonError(null);
    } else {
      setJsonError(errors.join("\n"));
    }
  };

  const handleSave = () => {
    if (isJsonView && jsonError) {
      return;
    }
    saveKeyboardShortcuts(localConfig);
    app.vent.emit("refreshKeyboardShortcuts");
    onClose();
  };
  const onReset = () => {
    setLocalConfig(getDefaultShortcuts());
  };

  return (
    <Modal
      open={isOpen}
      onCancel={onClose}
      onOk={handleSave}
      width={800}
      style={{ padding: 20 }}
      title="Keyboard Shortcut Configuration"
    >
      <Flex justify={"flex-end"} align={"flex-start"}>
        <Space style={{ marginBottom: 16 }}>
          <Text>Edit Mode</Text>
          <Switch
            checked={isJsonView}
            onChange={setIsJsonView}
            checkedChildren="Manual"
            unCheckedChildren="Table"
          />
        </Space>
      </Flex>

      {/* TABLE VIEW */}
      {!isJsonView && (
        <>
          <Title level={5}>General Shortcuts</Title>
          <Table
            dataSource={tableData.filter((r) => r.group === "General")}
            columns={columns}
            pagination={false}
            size="small"
            style={{ marginBottom: 24 }}
          />

          <Title level={5}>General Editing Shortcuts</Title>
          <Table
            dataSource={tableData.filter((r) => r.group === "General Editing")}
            columns={columns}
            pagination={false}
            size="small"
          />
        </>
      )}

      {/* JSON VIEW */}
      {isJsonView && (
        <>
          <Input.TextArea
            rows={18}
            value={jsonString}
            onChange={(e) => onChangeJson(e.target.value)}
            style={{ fontFamily: "monospace" }}
          />
          {jsonError && <Text type="danger">JSON Error: {jsonError}</Text>}
        </>
      )}
      <Flex justify={"flex-end"} align={"flex-start"}>
        <Space style={{ marginTop: 24 }}>
          <Button onClick={onReset}>
            <RollbackOutlined /> Reset Shortcuts
          </Button>
        </Space>
      </Flex>

      {/*Keyboard Shortcut Recorder*/}
      <ShortcutRecorderModal
        isOpen={isRecorderOpen}
        initialShortcut={
          recorderTargetHandlerId
            ? Object.entries(localConfig).find(
                ([_combo, handlerId]) => handlerId === recorderTargetHandlerId,
              )?.[0]
            : undefined
        }
        onCancel={() => {
          setIsRecorderOpen(false);
          setRecorderTargetHandlerId(null);
        }}
        onSave={(newCombo) => {
          if (!recorderTargetHandlerId) return;

          // Build updated map: remove any existing key(s) that pointed to this handlerId
          const updated: Record<string, string> = {};
          for (const [keyCombo, handlerId] of Object.entries(localConfig)) {
            if (handlerId !== recorderTargetHandlerId) {
              updated[keyCombo] = handlerId;
            }
          }
          // assign the new combo
          updated[newCombo] = recorderTargetHandlerId;

          setLocalConfig(updated);
          setJsonString(JSON.stringify(updated, null, 2));

          setIsRecorderOpen(false);
          setRecorderTargetHandlerId(null);
        }}
      />
    </Modal>
  );
}

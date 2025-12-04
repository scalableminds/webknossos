import { CloseOutlined, EditOutlined, PlusOutlined, RollbackOutlined } from "@ant-design/icons";
import { Button, Flex, Input, Modal, Space, Switch, Table, Typography } from "antd";
import app from "app";
import Toast from "libs/toast";
import _ from "lodash";
import { useMemo, useState } from "react";
import {
  ALL_KEYBOARD_SHORTCUT_META_INFOS,
  type KeyboardComboChain,
  KeyboardShortcutDomain,
  getAllDefaultKeyboardShortcuts,
} from "viewer/view/keyboard_shortcuts/keyboard_shortcut_constants";
import {
  loadKeyboardShortcuts,
  saveKeyboardShortcuts,
  validateShortcutMapText,
} from "./keyboard_shortcut_persistence";
import { formatKeyComboChain } from "./keyboard_shortcut_utils";
import { ShortcutRecorderModal } from "./shortcut_recorder_modal";

const { Text, Title } = Typography;

export type ShortcutConfigModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function KeyboardShortcutConfigModal({ isOpen, onClose }: ShortcutConfigModalProps) {
  const [isJsonView, setIsJsonView] = useState(false);
  const [isRecorderOpen, setIsRecorderOpen] = useState(false);
  const [recorderTargetHandlerId, setRecorderTargetHandlerId] = useState<string | null>(null);
  const [recorderEditingKeyCombo, setRecorderEditingKeyCombo] = useState<KeyboardComboChain | null>(
    null,
  );
  const [localConfig, setLocalConfig] = useState(loadKeyboardShortcuts());

  const [jsonString, setJsonString] = useState(() => JSON.stringify(localConfig, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const handleRemoveComboChain = (handlerId: string, comboChain: string[][]) => {
    setLocalConfig((prevConfig) => {
      const updatedCombos = prevConfig[handlerId].filter((c) => c !== comboChain);

      if (updatedCombos.length > 0) {
        return { ...prevConfig, [handlerId]: updatedCombos };
      }
      // @ts-ignore TODOM
      const defaultCombo = getAllDefaultKeyboardShortcuts()[handlerId] as KeyboardComboChain[];
      Toast.info("Default shortcut restored to keep the shortcut reachable.");
      return { ...prevConfig, [handlerId]: defaultCombo };
    });
  };

  // Convert config into grouped table rows
  type TableDataEntry = {
    key: string;
    combos: KeyboardComboChain[];
    handlerId: string;
    domain: string;
    description: string;
  };

  const tableData = useMemo(() => {
    const rows: TableDataEntry[] = Object.entries(localConfig).map(([handlerId, keyCombos]) => {
      const metaInfo =
        ALL_KEYBOARD_SHORTCUT_META_INFOS[
          handlerId as keyof typeof ALL_KEYBOARD_SHORTCUT_META_INFOS
        ];
      return {
        key: handlerId,
        combos: keyCombos,
        handlerId,
        domain: metaInfo.domain,
        description: metaInfo.description,
      };
    });
    return rows;
  }, [localConfig]);

  const columns = [
    {
      title: "Shortcuts",
      dataIndex: "combos",
      key: "combos",
      render: (combos: KeyboardComboChain[], record: TableDataEntry) => (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {combos.map((comboChain, index) => (
            <span
              key={index}
              style={{
                border: "1px solid gray",
                borderRadius: 4,
                borderColor: "var(--ant-color-border)",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              {<span style={{ padding: "0px 12px" }}>{formatKeyComboChain(comboChain)}</span>}
              <Button
                type="text"
                icon={<EditOutlined />}
                style={{ padding: "0px 20px" }}
                onClick={() => {
                  setRecorderTargetHandlerId(record.handlerId);
                  setRecorderEditingKeyCombo(comboChain);
                  setIsRecorderOpen(true);
                }}
              />
              <Button
                type="text"
                icon={<CloseOutlined />}
                style={{ padding: "0px 20px" }}
                onClick={() => handleRemoveComboChain(record.handlerId, comboChain)}
              />
            </span>
          ))}{" "}
          <Button
            style={{ padding: "0px 20px" }}
            icon={<PlusOutlined />}
            onClick={() => {
              setRecorderTargetHandlerId(record.handlerId);
              setRecorderEditingKeyCombo(null);
              setIsRecorderOpen(true);
            }}
          />
        </span>
      ),
    },
    {
      title: "Action",
      dataIndex: "handlerId",
      width: 400,
      key: "handlerId",
      render: (handlerId: string) => {
        const metaInfo =
          ALL_KEYBOARD_SHORTCUT_META_INFOS[
            handlerId as keyof typeof ALL_KEYBOARD_SHORTCUT_META_INFOS
          ];
        return metaInfo?.description ?? handlerId;
      },
    },
    /*{
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
    },*/
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
    setLocalConfig(getAllDefaultKeyboardShortcuts());
  };

  return (
    <Modal
      open={isOpen}
      onCancel={onClose}
      onOk={handleSave}
      width={1000}
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
          {Object.values(KeyboardShortcutDomain).map((domainName) => (
            <div key={domainName}>
              <Title level={5}>{domainName} Shortcuts</Title>
              <Table
                dataSource={tableData.filter((r) => r.domain === domainName)}
                columns={columns}
                pagination={false}
                size="small"
                style={{ marginBottom: 24 }}
              />
            </div>
          ))}
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
        initialKeyComboChain={recorderEditingKeyCombo ?? undefined}
        onCancel={() => {
          setIsRecorderOpen(false);
          setRecorderTargetHandlerId(null);
        }}
        onSave={(newComboChain) => {
          if (!recorderTargetHandlerId) return;

          // Build updated map: remove any existing key(s) that pointed to this handlerId
          const updated: Record<string, KeyboardComboChain[]> = {};
          const updatedKeyComboChains = recorderEditingKeyCombo
            ? localConfig[recorderTargetHandlerId].map((keyComboChain) =>
                _.isEqual(keyComboChain, recorderEditingKeyCombo) ? newComboChain : keyComboChain,
              )
            : [...localConfig[recorderTargetHandlerId], newComboChain];
          for (const [handlerId, keyComboChains] of Object.entries(localConfig)) {
            if (handlerId !== recorderTargetHandlerId) {
              updated[handlerId] = keyComboChains;
            }
          }
          // assign the new combo
          updated[recorderTargetHandlerId] = updatedKeyComboChains;

          setLocalConfig(updated);
          setJsonString(JSON.stringify(updated, null, 2));

          setIsRecorderOpen(false);
          setRecorderTargetHandlerId(null);
        }}
      />
    </Modal>
  );
}

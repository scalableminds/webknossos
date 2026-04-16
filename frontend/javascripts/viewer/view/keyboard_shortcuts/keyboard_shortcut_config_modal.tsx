import { CloseOutlined, EditOutlined, PlusOutlined, RollbackOutlined } from "@ant-design/icons";
import { updateKeyboardShortcutsConfig } from "admin/rest_api";
import {
  Button,
  Flex,
  Input,
  Modal,
  Space,
  Switch,
  Table,
  Tabs,
  type TabsProps,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import Toast from "libs/toast";
import { isEqual } from "lodash-es";
import { useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setKeyboardShortcutsConfigAction } from "viewer/model/actions/settings_actions";
import type { WebknossosState } from "viewer/store";
import {
  ALL_KEYBOARD_HANDLER_IDS,
  ALL_KEYBOARD_SHORTCUT_META_INFOS,
  getAllDefaultKeyboardShortcuts,
} from "viewer/view/keyboard_shortcuts/keyboard_shortcut_constants";
import { validateShortcutMapText } from "./keyboard_shortcut_persistence";
import { type KeyboardComboChain, KeyboardShortcutDomain } from "./keyboard_shortcut_types";
import { checkCollisionsInShortcutMap, keyComboChainToUiElements } from "./keyboard_shortcut_utils";
import { CollisionWarningAlert, ShortcutRecorderModal } from "./shortcut_recorder_modal";

const { Text, Title } = Typography;

export type ShortcutConfigModalProps = {
  isOpen: boolean;
  onClose: () => void;
};
type TableDataEntry = {
  key: string;
  combos: KeyboardComboChain[];
  handlerId: string;
  domain: string;
  description: string;
};
type ShortcutDomainTableProps = {
  domainName: KeyboardShortcutDomain;
  tableData: TableDataEntry[];
  columns: ColumnsType<TableDataEntry>;
};

const ShortcutDomainTable: React.FC<ShortcutDomainTableProps> = ({
  domainName,
  tableData,
  columns,
}) => {
  return (
    <div key={domainName}>
      <Title level={5}>{domainName} Shortcuts</Title>
      <Table
        dataSource={tableData}
        columns={columns}
        pagination={false}
        size="small"
        style={{ marginBottom: 24 }}
      />
    </div>
  );
};

export default function KeyboardShortcutConfigModal({ isOpen, onClose }: ShortcutConfigModalProps) {
  const dispatch = useDispatch();
  const keyboardShortcutsConfigFromStore = useSelector(
    (state: WebknossosState) => state.keyboardShortcutsConfig,
  );
  const [isJsonView, setIsJsonView] = useState(false);
  const [isRecorderOpen, setIsRecorderOpen] = useState(false);
  const [recorderTargetHandlerId, setRecorderTargetHandlerId] = useState<string | null>(null);
  const [recorderEditingKeyCombo, setRecorderEditingKeyCombo] = useState<KeyboardComboChain | null>(
    null,
  );
  const [localShortcutConfig, setLocalShortcutConfig] = useState(keyboardShortcutsConfigFromStore);
  const shortcutCollisions = useMemo(
    () => checkCollisionsInShortcutMap(localShortcutConfig),
    [localShortcutConfig],
  );

  const [jsonString, setJsonString] = useState(() => JSON.stringify(localShortcutConfig, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const handleRemoveComboChain = (handlerId: string, comboChain: string[][]) => {
    setLocalShortcutConfig((prevConfig) => {
      const updatedCombos = prevConfig[handlerId].filter((c) => c !== comboChain);

      if (updatedCombos.length > 0) {
        return { ...prevConfig, [handlerId]: updatedCombos };
      }
      // @ts-expect-error TODOM fix
      const defaultCombo = getAllDefaultKeyboardShortcuts()[handlerId] as KeyboardComboChain[];
      Toast.info("Restored the default shortcut to keep the shortcut reachable.");
      return { ...prevConfig, [handlerId]: defaultCombo };
    });
  };

  // Convert config into grouped table rows
  const tableDataMap = useMemo(() => {
    const domainToEntries: Record<KeyboardShortcutDomain, TableDataEntry[]> = {
      [KeyboardShortcutDomain.GENERAL]: [],
      [KeyboardShortcutDomain.GENERAL_EDITING]: [],
      [KeyboardShortcutDomain.GENERAL_LAYOUT]: [],
      [KeyboardShortcutDomain.GENERAL_COMMENT_TAB]: [],
      [KeyboardShortcutDomain.ARBITRARY_NAVIGATION]: [],
      [KeyboardShortcutDomain.ARBITRARY_EDITING]: [],
      [KeyboardShortcutDomain.PLANE_NAVIGATION]: [],
      [KeyboardShortcutDomain.PLANE_CONFIGURATIONS]: [],
      [KeyboardShortcutDomain.PLANE_TOOL_SWITCHING]: [],
      [KeyboardShortcutDomain.PLANE_SKELETON_TOOL]: [],
      [KeyboardShortcutDomain.PLANE_VOLUME_TOOL]: [],
      [KeyboardShortcutDomain.PLANE_BOUNDING_BOX_TOOL]: [],
      [KeyboardShortcutDomain.PLANE_PROOFREADING_TOOL]: [],
    };
    // Iterate over ALL_KEYBOARD_HANDLER_IDS (stable array) rather than
    // Object.entries(localShortcutConfig) so the table order is always
    // deterministic and never changes when a shortcut is edited.
    ALL_KEYBOARD_HANDLER_IDS.forEach((handlerId) => {
      const keyCombos = localShortcutConfig[handlerId];
      if (keyCombos == null) return;
      const metaInfo =
        ALL_KEYBOARD_SHORTCUT_META_INFOS[
          handlerId as keyof typeof ALL_KEYBOARD_SHORTCUT_META_INFOS
        ];
      if (metaInfo == null) return;
      domainToEntries[metaInfo.domain].push({
        key: handlerId,
        combos: keyCombos,
        handlerId,
        domain: metaInfo.domain,
        description: metaInfo.description,
      });
    });
    return domainToEntries;
  }, [localShortcutConfig]);

  const columns = [
    {
      title: "Shortcuts",
      dataIndex: "combos",
      key: "combos",
      render: (combos: KeyboardComboChain[], record: TableDataEntry) => (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center", // flex-start
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
              flex: 1,
              minWidth: 0,
            }}
          >
            {combos.map((comboChain, index) => (
              <div
                key={index}
                style={{
                  display: "inline-flex",
                  gap: 4,
                  alignItems: "center",
                  padding: 2,
                  whiteSpace: "nowrap",
                  border: "1px solid gray",
                  borderRadius: 4,
                  borderColor: "var(--ant-color-border)",
                }}
              >
                <span style={{ padding: "0px 4px" }}>
                  {keyComboChainToUiElements(comboChain, false)}
                </span>
                <Button
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setRecorderTargetHandlerId(record.handlerId);
                    setRecorderEditingKeyCombo(comboChain);
                    setIsRecorderOpen(true);
                  }}
                />
                <Button
                  type="text"
                  icon={<CloseOutlined />}
                  onClick={() => handleRemoveComboChain(record.handlerId, comboChain)}
                />
              </div>
            ))}
          </div>

          <div
            style={{
              order: 1,
              display: "flex",
              justifyContent: "flex-end",
              marginLeft: "auto",
              minWidth: 0,
            }}
          >
            <Button
              icon={<PlusOutlined />}
              onClick={() => {
                setRecorderTargetHandlerId(record.handlerId);
                setRecorderEditingKeyCombo(null);
                setIsRecorderOpen(true);
              }}
            />
          </div>
        </div>
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
  ];

  // Handle JSON editor changes
  const onChangeJson = (value: string) => {
    setJsonString(value);
    const { valid, errors, parsed } = validateShortcutMapText(value);
    if (valid && parsed) {
      setLocalShortcutConfig(parsed);
    }
    if (valid) {
      setJsonError(null);
    } else {
      setJsonError(errors.join("\n"));
    }
  };

  const handleSave = async () => {
    if (isJsonView && jsonError) {
      return;
    }
    try {
      await updateKeyboardShortcutsConfig(localShortcutConfig);
    } catch (e) {
      console.error("Failed to save keyboard shortcuts to backend.", e);
      return;
    }
    dispatch(setKeyboardShortcutsConfigAction(localShortcutConfig));
    onClose();
  };
  const onReset = () => {
    setLocalShortcutConfig(getAllDefaultKeyboardShortcuts());
  };

  const shortcutsTabItems: TabsProps["items"] = [
    {
      key: "general",
      label: "General",
      children: (
        <>
          <ShortcutDomainTable
            domainName={KeyboardShortcutDomain.GENERAL}
            tableData={tableDataMap[KeyboardShortcutDomain.GENERAL]}
            columns={columns}
          />
          <ShortcutDomainTable
            domainName={KeyboardShortcutDomain.GENERAL_EDITING}
            tableData={tableDataMap[KeyboardShortcutDomain.GENERAL_EDITING]}
            columns={columns}
          />
          <ShortcutDomainTable
            domainName={KeyboardShortcutDomain.GENERAL_LAYOUT}
            tableData={tableDataMap[KeyboardShortcutDomain.GENERAL_LAYOUT]}
            columns={columns}
          />
          <ShortcutDomainTable
            domainName={KeyboardShortcutDomain.GENERAL_COMMENT_TAB}
            tableData={tableDataMap[KeyboardShortcutDomain.GENERAL_COMMENT_TAB]}
            columns={columns}
          />
        </>
      ),
    },
    {
      key: "arbitrary",
      label: "Arbitrary Mode",
      children: (
        <>
          <ShortcutDomainTable
            domainName={KeyboardShortcutDomain.ARBITRARY_NAVIGATION}
            tableData={tableDataMap[KeyboardShortcutDomain.ARBITRARY_NAVIGATION]}
            columns={columns}
          />
          <ShortcutDomainTable
            domainName={KeyboardShortcutDomain.ARBITRARY_EDITING}
            tableData={tableDataMap[KeyboardShortcutDomain.ARBITRARY_EDITING]}
            columns={columns}
          />
        </>
      ),
    },
    {
      key: "plane",
      label: "Plane Mode",
      children: (
        <>
          <ShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_NAVIGATION}
            tableData={tableDataMap[KeyboardShortcutDomain.PLANE_NAVIGATION]}
            columns={columns}
          />
          <ShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_CONFIGURATIONS}
            tableData={tableDataMap[KeyboardShortcutDomain.PLANE_CONFIGURATIONS]}
            columns={columns}
          />
        </>
      ),
    },
    {
      key: "plane_tools",
      label: "Plane Mode - Tool Activation",
      children: (
        <>
          <ShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_TOOL_SWITCHING}
            tableData={tableDataMap[KeyboardShortcutDomain.PLANE_TOOL_SWITCHING]}
            columns={columns}
          />
        </>
      ),
    },
    {
      key: "tools",
      label: "Plane Mode Tools",
      children: (
        <>
          <ShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_SKELETON_TOOL}
            tableData={tableDataMap[KeyboardShortcutDomain.PLANE_SKELETON_TOOL]}
            columns={columns}
          />
          <ShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_VOLUME_TOOL}
            tableData={tableDataMap[KeyboardShortcutDomain.PLANE_VOLUME_TOOL]}
            columns={columns}
          />
          <ShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_BOUNDING_BOX_TOOL}
            tableData={tableDataMap[KeyboardShortcutDomain.PLANE_BOUNDING_BOX_TOOL]}
            columns={columns}
          />
          <ShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_PROOFREADING_TOOL}
            tableData={tableDataMap[KeyboardShortcutDomain.PLANE_PROOFREADING_TOOL]}
            columns={columns}
          />
        </>
      ),
    },
  ];

  return (
    <Modal
      open={isOpen}
      onCancel={onClose}
      onOk={handleSave}
      width={1000}
      style={{ padding: 20 }}
      title="Keyboard Shortcut Configuration"
      styles={{
        body: {
          maxHeight: "70vh",
          overflowY: "auto",
          paddingRight: 8, // prevents scrollbar overlap
        },
      }}
    >
      <CollisionWarningAlert shortcutCollisions={shortcutCollisions} />

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
      {!isJsonView && <Tabs items={shortcutsTabItems} />}

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
        keyboardShortcutConfig={localShortcutConfig}
        handlerId={recorderTargetHandlerId}
        isOpen={isRecorderOpen}
        initialKeyComboChain={recorderEditingKeyCombo ?? undefined}
        onCancel={() => {
          setIsRecorderOpen(false);
          setRecorderTargetHandlerId(null);
        }}
        onSave={(newComboChain) => {
          if (!recorderTargetHandlerId) return;

          const updatedKeyComboChains = recorderEditingKeyCombo
            ? localShortcutConfig[recorderTargetHandlerId].map((keyComboChain) =>
                isEqual(keyComboChain, recorderEditingKeyCombo) ? newComboChain : keyComboChain,
              )
            : [...localShortcutConfig[recorderTargetHandlerId], newComboChain];
          // Use spread to preserve the existing key insertion order — building a
          // fresh object with a loop would move the edited key to the end.
          const updated = { ...localShortcutConfig, [recorderTargetHandlerId]: updatedKeyComboChains };

          setLocalShortcutConfig(updated);
          setJsonString(JSON.stringify(updated, null, 2));

          setIsRecorderOpen(false);
          setRecorderTargetHandlerId(null);
        }}
      />
    </Modal>
  );
}

import { CloseOutlined, EditOutlined, PlusOutlined, RollbackOutlined } from "@ant-design/icons";
import { updateKeyboardShortcutsConfig } from "admin/rest_api";
import {
  Alert,
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
import type React from "react";
import { useMemo, useState } from "react";
import { useWkSelector } from "libs/react_hooks";
import { useDispatch } from "react-redux";
import { setKeyboardShortcutsConfigAction } from "viewer/model/actions/settings_actions";
import {
  ALL_KEYBOARD_HANDLER_IDS,
  ALL_KEYBOARD_SHORTCUT_META_INFOS,
  getAllDefaultKeyboardShortcuts,
} from "viewer/view/keyboard_shortcuts/keyboard_shortcut_constants";
import { validateShortcutMapText } from "./keyboard_shortcut_persistence";
import {
  ArbitraryNavigationMouseShortcutsTable,
  PlaneGeneralEditingMouseShortcutsTable,
  PlaneNavigationMouseShortcutsTable,
  PlaneTdViewportMouseShortcutsTable,
  ProofreadingToolMouseShortcutsTable,
  ProofreadingToolOrthoMouseShortcutsTable,
  ProofreadingToolTDMouseShortcutsTable,
  SkeletonToolClassicControlsMouseShortcutsTable,
  SkeletonToolMouseShortcutsTable,
  VolumeToolClassicControlsMouseShortcutsTable,
  VolumeToolMouseShortcutsTable,
} from "./keyboard_shortcut_mouse_tables";
import { type KeyboardComboChain, KeyboardShortcutDomain } from "./keyboard_shortcut_types";
import { checkCollisionsInShortcutMap, keyComboChainToUiElements } from "./keyboard_shortcut_utils";
import { CollisionWarningAlert, ShortcutRecorderModal } from "./shortcut_recorder_modal";

const { Text, Title } = Typography;

export type ShortcutConfigModalProps = {
  isOpen: boolean;
  onClose: () => void;
};
type KeyboardShortcutTableDataEntry = {
  key: string;
  combos: KeyboardComboChain[];
  handlerId: string;
  domain: string;
  description: string;
};

type KeyboardShortcutDomainTableProps = {
  domainName: KeyboardShortcutDomain;
  tableData: KeyboardShortcutTableDataEntry[];
  columns: ColumnsType<KeyboardShortcutTableDataEntry>;
};

const KeyboardShortcutDomainTable: React.FC<KeyboardShortcutDomainTableProps> = ({
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
        className="shortcut-table-modal"
      />
    </div>
  );
};

export default function KeyboardShortcutConfigModal({ isOpen, onClose }: ShortcutConfigModalProps) {
  const dispatch = useDispatch();
  const activeUser = useWkSelector((state) => state.activeUser);
  const isEditable = activeUser != null;
  const keyboardShortcutsConfigFromStore = useWkSelector((state) => state.keyboardShortcutsConfig);
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
  const keyboardShortcutsTableDataMap = useMemo(() => {
    const domainToEntries: Record<KeyboardShortcutDomain, KeyboardShortcutTableDataEntry[]> = {
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

  const keyboardShortcutsColumns = [
    {
      title: "Shortcuts",
      dataIndex: "combos",
      key: "combos",
      render: (combos: KeyboardComboChain[], record: KeyboardShortcutTableDataEntry) => (
        <>
          <div className="shortcuts-container">
            {combos.map((comboChain, index) => (
              <div key={index} className="single-shortcut-container">
                <span style={{ padding: "0px 4px" }}>
                  {keyComboChainToUiElements(comboChain, false)}
                </span>
                <Button
                  type="text"
                  icon={<EditOutlined />}
                  disabled={!isEditable}
                  onClick={() => {
                    setRecorderTargetHandlerId(record.handlerId);
                    setRecorderEditingKeyCombo(comboChain);
                    setIsRecorderOpen(true);
                  }}
                />
                <Button
                  type="text"
                  disabled={!isEditable}
                  icon={<CloseOutlined />}
                  onClick={() => handleRemoveComboChain(record.handlerId, comboChain)}
                />
              </div>
            ))}
          </div>

          <div className="add-button-container">
            <Button
              disabled={!isEditable}
              icon={<PlusOutlined />}
              onClick={() => {
                setRecorderTargetHandlerId(record.handlerId);
                setRecorderEditingKeyCombo(null);
                setIsRecorderOpen(true);
              }}
            />
          </div>
        </>
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
      dispatch(setKeyboardShortcutsConfigAction(localShortcutConfig));
      Toast.success("Updated keyboard shortcuts.");
      onClose();
    } catch (e) {
      console.error("Failed to save keyboard shortcuts to backend.", e);
      return;
    }
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
          <KeyboardShortcutDomainTable
            domainName={KeyboardShortcutDomain.GENERAL}
            tableData={keyboardShortcutsTableDataMap[KeyboardShortcutDomain.GENERAL]}
            columns={keyboardShortcutsColumns}
          />
          <KeyboardShortcutDomainTable
            domainName={KeyboardShortcutDomain.GENERAL_EDITING}
            tableData={keyboardShortcutsTableDataMap[KeyboardShortcutDomain.GENERAL_EDITING]}
            columns={keyboardShortcutsColumns}
          />
          <KeyboardShortcutDomainTable
            domainName={KeyboardShortcutDomain.GENERAL_LAYOUT}
            tableData={keyboardShortcutsTableDataMap[KeyboardShortcutDomain.GENERAL_LAYOUT]}
            columns={keyboardShortcutsColumns}
          />
          <KeyboardShortcutDomainTable
            domainName={KeyboardShortcutDomain.GENERAL_COMMENT_TAB}
            tableData={keyboardShortcutsTableDataMap[KeyboardShortcutDomain.GENERAL_COMMENT_TAB]}
            columns={keyboardShortcutsColumns}
          />
        </>
      ),
    },
    {
      key: "arbitrary",
      label: "Arbitrary Mode",
      children: (
        <>
          <KeyboardShortcutDomainTable
            domainName={KeyboardShortcutDomain.ARBITRARY_NAVIGATION}
            tableData={keyboardShortcutsTableDataMap[KeyboardShortcutDomain.ARBITRARY_NAVIGATION]}
            columns={keyboardShortcutsColumns}
          />
          <ArbitraryNavigationMouseShortcutsTable />
          <KeyboardShortcutDomainTable
            domainName={KeyboardShortcutDomain.ARBITRARY_EDITING}
            tableData={keyboardShortcutsTableDataMap[KeyboardShortcutDomain.ARBITRARY_EDITING]}
            columns={keyboardShortcutsColumns}
          />
        </>
      ),
    },
    {
      key: "plane",
      label: "Plane Mode",
      children: (
        <>
          <KeyboardShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_NAVIGATION}
            tableData={keyboardShortcutsTableDataMap[KeyboardShortcutDomain.PLANE_NAVIGATION]}
            columns={keyboardShortcutsColumns}
          />
          <PlaneNavigationMouseShortcutsTable />
          <PlaneGeneralEditingMouseShortcutsTable />
          <PlaneTdViewportMouseShortcutsTable />
          <KeyboardShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_CONFIGURATIONS}
            tableData={keyboardShortcutsTableDataMap[KeyboardShortcutDomain.PLANE_CONFIGURATIONS]}
            columns={keyboardShortcutsColumns}
          />
        </>
      ),
    },
    {
      key: "plane_tools",
      label: "Plane Mode - Tool Activation",
      children: (
        <>
          <KeyboardShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_TOOL_SWITCHING}
            tableData={keyboardShortcutsTableDataMap[KeyboardShortcutDomain.PLANE_TOOL_SWITCHING]}
            columns={keyboardShortcutsColumns}
          />
        </>
      ),
    },
    {
      key: "tools",
      label: "Plane Mode Tools",
      children: (
        <>
          <KeyboardShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_SKELETON_TOOL}
            tableData={keyboardShortcutsTableDataMap[KeyboardShortcutDomain.PLANE_SKELETON_TOOL]}
            columns={keyboardShortcutsColumns}
          />
          <SkeletonToolMouseShortcutsTable />
          <SkeletonToolClassicControlsMouseShortcutsTable />
          <KeyboardShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_VOLUME_TOOL}
            tableData={keyboardShortcutsTableDataMap[KeyboardShortcutDomain.PLANE_VOLUME_TOOL]}
            columns={keyboardShortcutsColumns}
          />
          <VolumeToolMouseShortcutsTable />
          <VolumeToolClassicControlsMouseShortcutsTable />

          <KeyboardShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_BOUNDING_BOX_TOOL}
            tableData={
              keyboardShortcutsTableDataMap[KeyboardShortcutDomain.PLANE_BOUNDING_BOX_TOOL]
            }
            columns={keyboardShortcutsColumns}
          />
          <KeyboardShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_PROOFREADING_TOOL}
            tableData={
              keyboardShortcutsTableDataMap[KeyboardShortcutDomain.PLANE_PROOFREADING_TOOL]
            }
            columns={keyboardShortcutsColumns}
          />
          <ProofreadingToolMouseShortcutsTable />
          <ProofreadingToolOrthoMouseShortcutsTable />
          <ProofreadingToolTDMouseShortcutsTable />
        </>
      ),
    },
  ];

  return (
    <Modal
      open={isOpen}
      onCancel={onClose}
      okButtonProps={{ disabled: activeUser == null }}
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
      {activeUser == null ? (
        <Alert
          type="info"
          style={{ marginTop: 16, marginBottom: 16 }}
          title="You are not logged in"
          description="Only logged in users can modify and persist shortcuts."
        />
      ) : null}

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
          const updated = {
            ...localShortcutConfig,
            [recorderTargetHandlerId]: updatedKeyComboChains,
          };

          setLocalShortcutConfig(updated);
          setJsonString(JSON.stringify(updated, null, 2));

          setIsRecorderOpen(false);
          setRecorderTargetHandlerId(null);
        }}
      />
    </Modal>
  );
}

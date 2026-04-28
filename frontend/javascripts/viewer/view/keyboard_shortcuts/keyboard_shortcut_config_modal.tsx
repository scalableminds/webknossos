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
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { isEqual } from "lodash-es";
import type React from "react";
import { useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { setKeyboardShortcutsConfigAction } from "viewer/model/actions/settings_actions";
import {
  ALL_KEYBOARD_SHORTCUT_IDS,
  ALL_KEYBOARD_SHORTCUT_META_INFOS,
  getAllDefaultKeyboardShortcuts,
  type KeyboardShortcutId,
} from "viewer/view/keyboard_shortcuts/keyboard_shortcut_constants";
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
import { validateShortcutMapText } from "./keyboard_shortcut_persistence";
import type { KeyboardShortcutDomain, KeySequence } from "./keyboard_shortcut_types";
import { checkCollisionsInShortcutMap, keySequenceToUiElements } from "./keyboard_shortcut_utils";
import {
  CollisionWarningAlert,
  DomainNameToUiName,
  ShortcutRecorderModal,
} from "./shortcut_recorder_modal";

const { Text, Title } = Typography;

export type ShortcutConfigModalProps = {
  isOpen: boolean;
  onClose: () => void;
};
type KeyboardShortcutTableDataEntry = {
  key: string;
  combos: KeySequence[];
  shortcutId: KeyboardShortcutId;
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
      <Title level={5}>{DomainNameToUiName[domainName]} Shortcuts</Title>
      <Table
        dataSource={tableData}
        columns={columns}
        pagination={false}
        size="small"
        className="keyboard-shortcut-table-modal"
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
  const [recorderTargetShortcutId, setRecorderTargetShortcutId] =
    useState<KeyboardShortcutId | null>(null);
  const [recorderEditingKeySequence, setRecorderEditingKeySequence] = useState<KeySequence | null>(
    null,
  );
  const [localShortcutConfig, setLocalShortcutConfig] = useState(keyboardShortcutsConfigFromStore);
  const shortcutCollisions = useMemo(
    () => checkCollisionsInShortcutMap(localShortcutConfig),
    [localShortcutConfig],
  );

  const [jsonString, setJsonString] = useState(() => JSON.stringify(localShortcutConfig, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const updateLocalShortcutConfig = (nextConfig: typeof localShortcutConfig) => {
    setLocalShortcutConfig(nextConfig);
    setJsonString(JSON.stringify(nextConfig, null, 2));
    setJsonError(null);
  };

  const handleRemoveComboChain = (shortcutId: KeyboardShortcutId, comboChain: string[][]) => {
    setLocalShortcutConfig((prevConfig) => {
      const updatedCombos = prevConfig[shortcutId].filter((c) => c !== comboChain);
      const updatedConfig = { ...prevConfig, [shortcutId]: updatedCombos };
      updateLocalShortcutConfig(updatedConfig);
      return updatedConfig;
    });
  };

  const handleRestoreDefaultForShortcut = (shortcutId: KeyboardShortcutId) => {
    const defaultCombos = getAllDefaultKeyboardShortcuts()[shortcutId];
    setLocalShortcutConfig((prevConfig) => {
      const updatedConfig = { ...prevConfig, [shortcutId]: defaultCombos };
      updateLocalShortcutConfig(updatedConfig);
      return updatedConfig;
    });
  };

  // Convert config into grouped table rows
  const keyboardShortcutsTableDataMap = useMemo(() => {
    const domainToEntries: Record<KeyboardShortcutDomain, KeyboardShortcutTableDataEntry[]> = {
      GENERAL: [],
      GENERAL_EDITING: [],
      GENERAL_LAYOUT: [],
      GENERAL_COMMENT_TAB: [],
      ARBITRARY_NAVIGATION: [],
      ARBITRARY_EDITING: [],
      PLANE_NAVIGATION: [],
      PLANE_TOOL_SWITCHING: [],
      PLANE_SKELETON_TOOL: [],
      PLANE_VOLUME_TOOL: [],
      PLANE_BOUNDING_BOX_TOOL: [],
      PLANE_PROOFREADING_TOOL: [],
    };
    // Iterate over ALL_KEYBOARD_HANDLER_IDS (stable array) rather than
    // Object.entries(localShortcutConfig) so the table order is always
    // deterministic and never changes when a shortcut is edited.
    ALL_KEYBOARD_SHORTCUT_IDS.forEach((shortcutId) => {
      const keyCombos = localShortcutConfig[shortcutId];
      if (keyCombos == null) return;
      const metaInfo = ALL_KEYBOARD_SHORTCUT_META_INFOS[shortcutId];
      if (metaInfo == null) return;
      domainToEntries[metaInfo.domain].push({
        key: shortcutId,
        combos: keyCombos,
        shortcutId,
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
      render: (combos: KeySequence[], record: KeyboardShortcutTableDataEntry) => (
        <>
          <div className="keyboard-shortcuts-container">
            {combos.length === 0 ? (
              <Button
                type="text"
                icon={<RollbackOutlined />}
                disabled={!isEditable}
                onClick={() => handleRestoreDefaultForShortcut(record.shortcutId)}
              >
                Restore default
              </Button>
            ) : (
              combos.map((comboChain, index) => (
                <div key={index} className="single-keyboard-shortcut-container">
                  <span style={{ padding: "0px 4px" }}>
                    {keySequenceToUiElements(comboChain, false)}
                  </span>
                  <Button
                    type="text"
                    icon={<EditOutlined />}
                    disabled={!isEditable}
                    onClick={() => {
                      setRecorderTargetShortcutId(record.shortcutId);
                      setRecorderEditingKeySequence(comboChain);
                      setIsRecorderOpen(true);
                    }}
                  />
                  <Button
                    type="text"
                    disabled={!isEditable}
                    icon={<CloseOutlined />}
                    onClick={() => handleRemoveComboChain(record.shortcutId, comboChain)}
                  />
                </div>
              ))
            )}
          </div>

          <div className="add-button-container">
            <Button
              disabled={!isEditable}
              icon={<PlusOutlined />}
              onClick={() => {
                setRecorderTargetShortcutId(record.shortcutId);
                setRecorderEditingKeySequence(null);
                setIsRecorderOpen(true);
              }}
            />
          </div>
        </>
      ),
    },
    {
      title: "Action",
      dataIndex: "shortcutId",
      width: 400,
      key: "shortcutId",
      render: (shortcutId: string) => {
        const metaInfo =
          ALL_KEYBOARD_SHORTCUT_META_INFOS[
            shortcutId as keyof typeof ALL_KEYBOARD_SHORTCUT_META_INFOS
          ];
        return metaInfo?.description ?? shortcutId;
      },
    },
  ];

  // Handle JSON editor changes
  const onChangeJson = (value: string) => {
    setJsonString(value);
    const { valid, errors, parsed } = validateShortcutMapText(value);
    if (valid && parsed) {
      updateLocalShortcutConfig(parsed);
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
  const handleCancel = () => {
    setLocalShortcutConfig(keyboardShortcutsConfigFromStore);
    setJsonString(JSON.stringify(keyboardShortcutsConfigFromStore, null, 2));
    setJsonError(null);
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
          <KeyboardShortcutDomainTable
            domainName="GENERAL"
            tableData={keyboardShortcutsTableDataMap["GENERAL"]}
            columns={keyboardShortcutsColumns}
          />
          <KeyboardShortcutDomainTable
            domainName="GENERAL_EDITING"
            tableData={keyboardShortcutsTableDataMap["GENERAL_EDITING"]}
            columns={keyboardShortcutsColumns}
          />
          <KeyboardShortcutDomainTable
            domainName={"GENERAL_LAYOUT"}
            tableData={keyboardShortcutsTableDataMap["GENERAL_LAYOUT"]}
            columns={keyboardShortcutsColumns}
          />
          <KeyboardShortcutDomainTable
            domainName={"GENERAL_COMMENT_TAB"}
            tableData={keyboardShortcutsTableDataMap["GENERAL_COMMENT_TAB"]}
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
            domainName={"ARBITRARY_NAVIGATION"}
            tableData={keyboardShortcutsTableDataMap["ARBITRARY_NAVIGATION"]}
            columns={keyboardShortcutsColumns}
          />
          <ArbitraryNavigationMouseShortcutsTable />
          <KeyboardShortcutDomainTable
            domainName={"ARBITRARY_EDITING"}
            tableData={keyboardShortcutsTableDataMap["ARBITRARY_EDITING"]}
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
            domainName={"PLANE_NAVIGATION"}
            tableData={keyboardShortcutsTableDataMap["PLANE_NAVIGATION"]}
            columns={keyboardShortcutsColumns}
          />
          <PlaneNavigationMouseShortcutsTable />
          <PlaneGeneralEditingMouseShortcutsTable />
          <PlaneTdViewportMouseShortcutsTable />
        </>
      ),
    },
    {
      key: "plane_tools",
      label: "Plane Mode - Tool Activation",
      children: (
        <>
          <KeyboardShortcutDomainTable
            domainName={"PLANE_TOOL_SWITCHING"}
            tableData={keyboardShortcutsTableDataMap["PLANE_TOOL_SWITCHING"]}
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
            domainName={"PLANE_SKELETON_TOOL"}
            tableData={keyboardShortcutsTableDataMap["PLANE_SKELETON_TOOL"]}
            columns={keyboardShortcutsColumns}
          />
          <SkeletonToolMouseShortcutsTable />
          <SkeletonToolClassicControlsMouseShortcutsTable />
          <KeyboardShortcutDomainTable
            domainName={"PLANE_VOLUME_TOOL"}
            tableData={keyboardShortcutsTableDataMap["PLANE_VOLUME_TOOL"]}
            columns={keyboardShortcutsColumns}
          />
          <VolumeToolMouseShortcutsTable />
          <VolumeToolClassicControlsMouseShortcutsTable />

          <KeyboardShortcutDomainTable
            domainName={"PLANE_BOUNDING_BOX_TOOL"}
            tableData={keyboardShortcutsTableDataMap["PLANE_BOUNDING_BOX_TOOL"]}
            columns={keyboardShortcutsColumns}
          />
          <KeyboardShortcutDomainTable
            domainName={"PLANE_PROOFREADING_TOOL"}
            tableData={keyboardShortcutsTableDataMap["PLANE_PROOFREADING_TOOL"]}
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
      onCancel={handleCancel}
      okButtonProps={{ disabled: activeUser == null || (isJsonView && jsonError != null) }}
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
        keyboardShortcutId={recorderTargetShortcutId}
        isOpen={isRecorderOpen}
        initialKeySequence={recorderEditingKeySequence ?? undefined}
        onCancel={() => {
          setIsRecorderOpen(false);
          setRecorderTargetShortcutId(null);
        }}
        onSave={(newKeySeq) => {
          if (!recorderTargetShortcutId) return;

          // First remove all equal sequences to deduplicate them.
          const shortcutKeqSeqsWithoutNewSeq = localShortcutConfig[recorderTargetShortcutId].filter(
            (keySeq) => !isEqual(keySeq, newKeySeq),
          );

          const updatedKeySeqAlternatives = recorderEditingKeySequence
            ? shortcutKeqSeqsWithoutNewSeq.map((keySeq) =>
                isEqual(keySeq, recorderEditingKeySequence) ? newKeySeq : keySeq,
              )
            : [...shortcutKeqSeqsWithoutNewSeq, newKeySeq];
          // Use spread to preserve the existing key insertion order — building a
          // fresh object with a loop would move the edited key to the end.
          const updated = {
            ...localShortcutConfig,
            [recorderTargetShortcutId]: updatedKeySeqAlternatives,
          };

          setLocalShortcutConfig(updated);
          setJsonString(JSON.stringify(updated, null, 2));

          setIsRecorderOpen(false);
          setRecorderTargetShortcutId(null);
        }}
      />
    </Modal>
  );
}

import Icon, {
  CloseOutlined,
  EditOutlined,
  PlusOutlined,
  RollbackOutlined,
} from "@ant-design/icons";
import IconStatusbarMouseLeft from "@images/icons/icon-statusbar-mouse-left.svg?react";
import IconStatusbarMouseLeftDrag from "@images/icons/icon-statusbar-mouse-left-drag.svg?react";
import IconStatusbarMouseMove from "@images/icons/icon-statusbar-mouse-move.svg?react";
import IconStatusbarMouseRight from "@images/icons/icon-statusbar-mouse-right.svg?react";
import IconStatusbarMouseRightDrag from "@images/icons/icon-statusbar-mouse-right-drag.svg?react";
import IconStatusbarMouseWheel from "@images/icons/icon-statusbar-mouse-wheel.svg?react";
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
import React, { useMemo, useState } from "react";
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
type KeyboardShortcutTableDataEntry = {
  key: string;
  combos: KeyboardComboChain[];
  handlerId: string;
  domain: string;
  description: string;
};
type MouseShortcutTableDataEntry = {
  shortcuts: React.ReactNode;
  action: string;
};
type ShortcutDomainTableProps<
  T extends KeyboardShortcutTableDataEntry | MouseShortcutTableDataEntry,
> = {
  domainName: KeyboardShortcutDomain;
  tableData: T[];
  columns: ColumnsType<T>;
};

const KeyboardShortcutDomainTable: React.FC<
  ShortcutDomainTableProps<KeyboardShortcutTableDataEntry>
> = ({ domainName, tableData, columns }) => {
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

const MouseShortcutDomainTable: React.FC<ShortcutDomainTableProps<MouseShortcutTableDataEntry>> = ({
  domainName,
  tableData,
  columns,
}) => {
  return (
    <div key={domainName}>
      <Title level={5}>{domainName} Mouse Shortcuts</Title>
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

  const mouseShortcutColumns = [
    {
      title: "Shortcuts",
      dataIndex: "shortcuts",
      key: "shortcuts",
      render: (shortcuts: React.ReactNode[]) => (
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
            {shortcuts.map((shortcut, index) => (
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
                {shortcut}
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      title: "Action",
      dataIndex: "action",
      key: "action",
    },
  ];

  const arbitraryNavigationMouseShortcuts = [
    {
      shortcuts: [
        <Icon key="1" component={IconStatusbarMouseLeft} aria-label="Left Mouse Click" />,
      ],
      action: "Select And Move To Node",
    },
    {
      shortcuts: [
        <Icon key="1" component={IconStatusbarMouseLeftDrag} aria-label="Left Mouse Drag" />,
      ],
      action: "Rotate around current position",
    },
    {
      shortcuts: [
        <React.Fragment key="1">
          {keyComboChainToUiElements([["Shift"]], false)} +{" "}
          {keyComboChainToUiElements([["Alt"]], false)} +{" "}
          <Icon key="1" component={IconStatusbarMouseLeft} aria-label="Left Mouse Click" />
        </React.Fragment>,
      ],
      action: "Merge with Active Node and Combine Trees",
    },
    {
      shortcuts: [
        <React.Fragment key="1">
          {keyComboChainToUiElements([["Shift"]], false)} +{" "}
          {keyComboChainToUiElements([["Ctrl"]], false)}/
          {keyComboChainToUiElements([["Meta"]], false)} +{" "}
          <Icon key="1" component={IconStatusbarMouseLeft} aria-label="Left Mouse Click" />
        </React.Fragment>,
      ],
      action: "Delete Edge to this Node and Split Trees",
    },
  ];

  const planeNavigationMouseShortcuts = [
    {
      shortcuts: [
        <Icon key="1" component={IconStatusbarMouseLeftDrag} aria-label="Left Mouse Drag" />,
      ],
      action: "Move In-Plane",
    },
    {
      shortcuts: [<Icon key="1" component={IconStatusbarMouseWheel} aria-label="Mouse Wheel" />],
      action: "Move One Slice Forward or Backward ",
    },
    {
      shortcuts: [
        <Icon key="1" component={IconStatusbarMouseLeftDrag} aria-label="Left Mouse Drag" />,
      ],
      action: "Move 3D viewport ",
    },
    {
      shortcuts: [
        <Icon key="1" component={IconStatusbarMouseRightDrag} aria-label="Right Mouse Drag" />,
      ],
      action: "Rotate 3D viewport ",
    },
  ];

  const skeletonToolMouseShortcuts = [
    {
      shortcuts: [
        <React.Fragment key="1">
          {keyComboChainToUiElements([["Shift"]], false)} +{" "}
          <Icon component={IconStatusbarMouseWheel} aria-label="Mouse Wheel" />
        </React.Fragment>,
      ],
      action: "Change Node Radius",
    },
    {
      shortcuts: [
        <Icon key="1" component={IconStatusbarMouseLeft} aria-label="Left Mouse Click" />,
      ],
      action: "Create New Node / Select Hovered Node",
    },
    {
      shortcuts: [
        <Icon key="1" component={IconStatusbarMouseLeftDrag} aria-label="Left Mouse Drag" />,
      ],
      action: "Move Node Under Cursor",
    },
    {
      shortcuts: [
        <Icon key="1" component={IconStatusbarMouseRight} aria-label="Right Mouse Click" />,
      ],
      action: "Open Context Menu with Hovered Node Related Options",
    },
    {
      shortcuts: [
        <React.Fragment key="1">
          {keyComboChainToUiElements([["Shift"]], false)} +{" "}
          {keyComboChainToUiElements([["Alt"]], false)} +{" "}
          <Icon key="1" component={IconStatusbarMouseLeft} aria-label="Left Mouse Click" />
        </React.Fragment>,
      ],
      action: "Merge with Active Node and Combine Trees",
    },
    {
      shortcuts: [
        <React.Fragment key="1">
          {keyComboChainToUiElements([["Shift"]], false)} +{" "}
          {keyComboChainToUiElements([["Ctrl"]], false)}/
          {keyComboChainToUiElements([["Meta"]], false)} +{" "}
          <Icon key="1" component={IconStatusbarMouseLeft} aria-label="Left Mouse Click" />
        </React.Fragment>,
      ],
      action: "Delete Edge to this Node and Split Trees",
    },
  ];

  const skeletonToolMouseShortcutsClassicControls = [
    // TODOM: highlight this as special
    {
      shortcuts: [
        <Icon key="1" component={IconStatusbarMouseRight} aria-label="Right Mouse Click" />,
      ],
      action: "Create New Node",
    },
    {
      shortcuts: [
        <React.Fragment key="1">
          {keyComboChainToUiElements([["Shift"]], false)} +{" "}
          <Icon key="1" component={IconStatusbarMouseLeft} aria-label="Left Mouse Click" />
        </React.Fragment>,
      ],
      action: "Select Hovered Node",
    },
  ];

  const planeGeneralEditingMouseShortcuts = [
    {
      shortcuts: [
        <Icon key="1" component={IconStatusbarMouseRight} aria-label="Right Mouse Click" />,
      ],
      action: "Open Context Menu",
    },
  ];

  const volumeToolMouseShortcuts = [
    {
      shortcuts: [
        <Icon key="1" component={IconStatusbarMouseLeftDrag} aria-label="Left Mouse Drag" />,
      ],
      action: "Add to Current Segment (Draw)",
    },
    {
      shortcuts: [
        <React.Fragment key="1">
          {keyComboChainToUiElements([["Ctrl"]], false)}/
          {keyComboChainToUiElements([["Meta"]], false)} +{" "}
          <Icon key="1" component={IconStatusbarMouseLeftDrag} aria-label="Left Mouse Drag" />
        </React.Fragment>,
      ],
      action: "Add to Current Segment (Draw) with Inverted Overwrite Mode",
    },
    {
      shortcuts: [
        <React.Fragment key="1">{keyComboChainToUiElements([["Shift"]], false)}</React.Fragment>,
      ],
      action: "Quick Switch to Segment Picker Tool",
    },
    {
      shortcuts: [
        <React.Fragment key="1">
          {keyComboChainToUiElements([["Ctrl"]], false)}/
          {keyComboChainToUiElements([["Meta"]], false)} +{" "}
          {keyComboChainToUiElements([["Shift"]], false)}
        </React.Fragment>,
      ],
      action: "Quick Switch to Eraser Tool",
    },
    {
      shortcuts: [
        // TODOM: should be moved to general navigation I think.
        <React.Fragment key="1">
          {keyComboChainToUiElements([["Alt"]], false)} +{" "}
          <Icon component={IconStatusbarMouseMove} aria-label="Mouse Move" />
        </React.Fragment>,
      ],
      action: "Move In-Plane",
    },
    {
      shortcuts: [
        <React.Fragment key="1">
          {keyComboChainToUiElements([["Shift"]], false)} +{" "}
          <Icon component={IconStatusbarMouseWheel} aria-label="Mouse Wheel" />
        </React.Fragment>,
      ],
      action: "Change Brush Size",
    },
  ];

  const volumeToolMouseShortcutsClassicControls = [
    // TODO mark as classic controls only
    {
      shortcuts: [
        <Icon key="1" component={IconStatusbarMouseRightDrag} aria-label="Right Mouse Drag" />,
      ],
      action: "Remove Voxels (Erase)",
    },
    {
      shortcuts: [
        <React.Fragment key="1">
          {keyComboChainToUiElements([["Ctrl"]], false)}/
          {keyComboChainToUiElements([["Meta"]], false)} +{" "}
          <Icon component={IconStatusbarMouseRightDrag} aria-label="Right Mouse Drag" />
        </React.Fragment>,
      ],
      action: "Remove Voxels (Erase) with Inverted Overwrite Mode",
    },
  ];

  const proofreadingToolMouseShortcuts = [
    {
      shortcuts: [
        <React.Fragment key="1">
          {keyComboChainToUiElements([["Ctrl"]], false)}/
          {keyComboChainToUiElements([["Meta"]], false)} +{" "}
          <Icon component={IconStatusbarMouseLeft} aria-label="Left Mouse Click" />
        </React.Fragment>,
      ],
      action: "Add Segment to Partition One for Multi Cut",
    },
    {
      shortcuts: [
        <React.Fragment key="1">
          {keyComboChainToUiElements([["Ctrl"]], false)}/
          {keyComboChainToUiElements([["Meta"]], false)} +{" "}
          {keyComboChainToUiElements([["Shift"]], false)} +{" "}
          <Icon component={IconStatusbarMouseLeft} aria-label="Left Mouse Click" />
        </React.Fragment>,
      ],
      action: "Add Segment to Partition Two for Multi Cut",
    },
  ];

  const proofreadingToolMouseShortcutsOrthoViewportsOnly = [
    // TODO mark as ortho viewports only
    {
      shortcuts: [
        <Icon key="1" component={IconStatusbarMouseLeft} aria-label="Left Mouse Click" />,
      ],
      action: "Activate Segment of Agglomerate for Proofreading Actions",
    },
    {
      shortcuts: [
        <React.Fragment key="1">
          {keyComboChainToUiElements([["Shift"]], false)} +{" "}
          <Icon component={IconStatusbarMouseWheel} aria-label="Mouse Wheel Click" />
        </React.Fragment>,
      ],
      action: "Import Agglomerate Skeleton of Hovered Agglomerate",
    },
    {
      shortcuts: [
        <React.Fragment key="1">
          {keyComboChainToUiElements([["Shift"]], false)} +{" "}
          <Icon component={IconStatusbarMouseLeft} aria-label="Left Mouse Click" />
        </React.Fragment>,
      ],
      action: "Merge with Active Segment",
    },
    {
      shortcuts: [
        <React.Fragment key="1">
          {keyComboChainToUiElements([["Ctrl"]], false)}/
          {keyComboChainToUiElements([["Meta"]], false)} +{" "}
          <Icon component={IconStatusbarMouseLeft} aria-label="Left Mouse Click" />
        </React.Fragment>,
      ],
      action: "Split from Active Segment",
    },
  ];
  const proofreadingToolMouseShortcutsTDViewportsOnly = [
    // TODO mark as 3d viewport only
    {
      shortcuts: [
        <React.Fragment key="1">
          {keyComboChainToUiElements([["Ctrl"]], false)}/
          {keyComboChainToUiElements([["Meta"]], false)} +{" "}
          <Icon component={IconStatusbarMouseWheel} aria-label="Mouse Wheel Click" />
        </React.Fragment>,
      ],
      action: "Activate Segment of Agglomerate",
    },
  ];

  const keyboardShortcutsColumns = [
    {
      title: "Shortcuts",
      dataIndex: "combos",
      key: "combos",
      render: (combos: KeyboardComboChain[], record: KeyboardShortcutTableDataEntry) => (
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
          <MouseShortcutDomainTable
            domainName={KeyboardShortcutDomain.ARBITRARY_NAVIGATION}
            tableData={arbitraryNavigationMouseShortcuts}
            columns={mouseShortcutColumns}
          />
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
          <MouseShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_NAVIGATION}
            tableData={planeNavigationMouseShortcuts}
            columns={mouseShortcutColumns}
          />
          <MouseShortcutDomainTable
            domainName={KeyboardShortcutDomain.GENERAL_EDITING} // TODO improve domain
            tableData={planeGeneralEditingMouseShortcuts}
            columns={mouseShortcutColumns}
          />
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
          <MouseShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_SKELETON_TOOL}
            tableData={skeletonToolMouseShortcuts}
            columns={mouseShortcutColumns}
          />
          <MouseShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_SKELETON_TOOL}
            tableData={skeletonToolMouseShortcutsClassicControls}
            columns={mouseShortcutColumns}
          />
          <KeyboardShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_VOLUME_TOOL}
            tableData={keyboardShortcutsTableDataMap[KeyboardShortcutDomain.PLANE_VOLUME_TOOL]}
            columns={keyboardShortcutsColumns}
          />
          <MouseShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_VOLUME_TOOL}
            tableData={volumeToolMouseShortcuts}
            columns={mouseShortcutColumns}
          />
          <MouseShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_VOLUME_TOOL}
            tableData={volumeToolMouseShortcutsClassicControls}
            columns={mouseShortcutColumns}
          />

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
          <MouseShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_PROOFREADING_TOOL}
            tableData={proofreadingToolMouseShortcuts}
            columns={mouseShortcutColumns}
          />
          <MouseShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_PROOFREADING_TOOL}
            tableData={proofreadingToolMouseShortcutsOrthoViewportsOnly}
            columns={mouseShortcutColumns}
          />
          <MouseShortcutDomainTable
            domainName={KeyboardShortcutDomain.PLANE_PROOFREADING_TOOL}
            tableData={proofreadingToolMouseShortcutsTDViewportsOnly}
            columns={mouseShortcutColumns}
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

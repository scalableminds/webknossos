import Icon, { CaretDownOutlined, InfoCircleOutlined } from "@ant-design/icons";
import NewBoundingBoxIcon from "@images/icons/icon-bounding-box-new.svg?react";
import { Dropdown, Radio, type RadioChangeEvent, Space, Tag } from "antd";
import FastTooltip from "components/fast_tooltip";
import features from "features";
import { useKeyPress, useWindowWidth, useWkSelector } from "libs/react_hooks";
import { useCallback, useMemo } from "react";
import { useDispatch } from "react-redux";
import Constants from "viewer/constants";
import { getDisabledInfoForTools } from "viewer/model/accessors/disabled_tool_accessor";
import {
  AnnotationTool,
  type AnnotationToolId,
  adaptActiveToolToShortcuts,
  Toolkit,
  Toolkits,
  VolumeTools,
} from "viewer/model/accessors/tool_accessor";
import { addUserBoundingBoxAction } from "viewer/model/actions/annotation_actions";
import { setToolAction } from "viewer/model/actions/ui_actions";
import ButtonComponent from "viewer/view/components/button_component";
import { ChangeBrushSizePopover } from "./brush_presets";
import { SkeletonSpecificButtons } from "./skeleton_specific_ui";
import { ToolIdToComponent } from "./tool_buttons";
import { ACTIONBAR_MARGIN_LEFT, NARROW_BUTTON_STYLE, ToolRadioButton } from "./tool_helpers";
import {
  CreateSegmentButton,
  FloodFillSettings,
  OverwriteModeSwitch,
  ProofreadingComponents,
  QuickSelectSettingsPopover,
  VolumeInterpolationButton,
} from "./volume_specific_ui";

function CreateNewBoundingBoxButton() {
  const dispatch = useDispatch();

  const handleAddNewUserBoundingBox = useCallback(() => {
    dispatch(addUserBoundingBoxAction());
  }, [dispatch]);

  return (
    <ButtonComponent
      onClick={handleAddNewUserBoundingBox}
      style={NARROW_BUTTON_STYLE}
      title="Create a new bounding box centered around the current position."
      icon={<Icon component={NewBoundingBoxIcon} aria-label="New Bounding Box Icon" />}
    />
  );
}

export default function ToolbarView() {
  const dispatch = useDispatch();
  const hasVolume = useWkSelector((state) => state.annotation?.volumes.length > 0);
  const hasSkeleton = useWkSelector((state) => state.annotation?.skeleton != null);
  const toolkit = useWkSelector((state) => state.userConfiguration.activeToolkit);
  const activeTool = useWkSelector((state) => state.uiInformation.activeTool);
  const isSplitToolkit = toolkit === Toolkit.SPLIT_SEGMENTS;
  const windowWidth = useWindowWidth();
  const disabledInfoForTools = useWkSelector(getDisabledInfoForTools);
  const isNarrowScreen = useMemo(() => windowWidth < Constants.NARROW_SCREEN_WIDTH, [windowWidth]);
  const lastRecentlyUsedToolsFromUserConfig = useWkSelector(
    (state) => state.userConfiguration.lastUsedToolQueue,
  );

  const isShiftPressed = useKeyPress("Shift");
  const isControlOrMetaPressed = useKeyPress("ControlOrMeta");
  const isAltPressed = useKeyPress("Alt");
  const adaptedActiveTool = adaptActiveToolToShortcuts(
    activeTool,
    isShiftPressed,
    isControlOrMetaPressed,
    isAltPressed,
  );

  const handleSetTool = useCallback(
    (event: RadioChangeEvent) => {
      const value = event.target.value as AnnotationToolId | null; // null if dropdown for more tools is clicked
      if (value != null) dispatch(setToolAction(AnnotationTool[value]));
    },
    [dispatch],
  );

  const onlyShowLastRecentlyUsedTools = isNarrowScreen && toolkit !== Toolkit.READ_ONLY_TOOLS;

  const toolsForButtons = useMemo(() => {
    const allToolsInToolkit = Toolkits[toolkit];
    const allToolIdsInToolkit = allToolsInToolkit.map((tool) => tool.id);
    if (onlyShowLastRecentlyUsedTools) {
      const lruToolsInToolkit = lastRecentlyUsedToolsFromUserConfig.filter((toolId) =>
        allToolIdsInToolkit.includes(toolId),
      );
      for (const tool of allToolsInToolkit) {
        if (lruToolsInToolkit.length >= 3) break;
        if (!lruToolsInToolkit.includes(tool.id)) {
          let adaptedToolId = tool.id;
          // fix tools with tool menues
          if (tool.id === AnnotationTool.TRACE.id) adaptedToolId = AnnotationTool.BRUSH.id;
          else if (tool.id === AnnotationTool.ERASE_TRACE.id)
            adaptedToolId = AnnotationTool.ERASE_BRUSH.id;
          else if (tool.id === AnnotationTool.AREA_MEASUREMENT.id)
            adaptedToolId = AnnotationTool.LINE_MEASUREMENT.id;
          lruToolsInToolkit.push(adaptedToolId);
        }
      }
      return lruToolsInToolkit
        .map((toolId) => allToolsInToolkit.find((tool) => tool.id === toolId))
        .filter((tool): tool is AnnotationTool => tool != null);
    }
    return Toolkits[toolkit];
  }, [onlyShowLastRecentlyUsedTools, toolkit, lastRecentlyUsedToolsFromUserConfig]);

  const getToolDropdown = useMemo(() => {
    if (!onlyShowLastRecentlyUsedTools) return null;
    return (
      <ToolRadioButton name="More tools" value={null} style={NARROW_BUTTON_STYLE}>
        <Dropdown
          menu={{
            items: Toolkits[toolkit].map((tool) => {
              const isDisabled = disabledInfoForTools[tool.id].isDisabled;
              return {
                key: tool.id,
                disabled: isDisabled,
                title: isDisabled ? disabledInfoForTools[tool.id].explanation : undefined,
                label: (
                  <span
                    onClick={() => {
                      dispatch(setToolAction(tool));
                    }}
                  >
                    <Space size="small">
                      {tool.icon}
                      {tool.readableName}
                    </Space>
                  </span>
                ),
              };
            }),
          }}
        >
          <CaretDownOutlined />
        </Dropdown>
      </ToolRadioButton>
    );
  }, [onlyShowLastRecentlyUsedTools, toolkit, dispatch, disabledInfoForTools]);

  return (
    <>
      <Radio.Group onChange={handleSetTool} value={adaptedActiveTool.id}>
        {toolsForButtons.map((tool) => {
          const ToolButton = ToolIdToComponent[tool.id];
          return <ToolButton key={tool.id} adaptedActiveTool={adaptedActiveTool} />;
        })}
        {getToolDropdown}
      </Radio.Group>

      <ToolSpecificSettings
        hasSkeleton={hasSkeleton}
        adaptedActiveTool={adaptedActiveTool}
        hasVolume={hasVolume}
        isControlOrMetaPressed={isControlOrMetaPressed}
        isShiftPressed={isShiftPressed}
      />

      {isSplitToolkit ? (
        <FastTooltip
          title={`Some tools behave differently because the "Split Segments" toolkit is active. Read more in the documentation.`}
        >
          <Tag
            icon={<InfoCircleOutlined />}
            style={{ marginLeft: ACTIONBAR_MARGIN_LEFT }}
            color="orange"
          >
            Split Workflow
          </Tag>
        </FastTooltip>
      ) : null}
    </>
  );
}

function ToolSpecificSettings({
  hasSkeleton,
  adaptedActiveTool,
  hasVolume,
  isControlOrMetaPressed,
  isShiftPressed,
}: {
  hasSkeleton: boolean;
  adaptedActiveTool: AnnotationTool;
  hasVolume: boolean;
  isControlOrMetaPressed: boolean;
  isShiftPressed: boolean;
}) {
  const showSkeletonButtons = hasSkeleton && adaptedActiveTool === AnnotationTool.SKELETON;
  const showNewBoundingBoxButton = adaptedActiveTool === AnnotationTool.BOUNDING_BOX;
  const showCreateCellButton = hasVolume && VolumeTools.includes(adaptedActiveTool);
  const showChangeBrushSizeButton =
    showCreateCellButton &&
    (adaptedActiveTool === AnnotationTool.BRUSH ||
      adaptedActiveTool === AnnotationTool.ERASE_BRUSH);
  const areEditableMappingsEnabled = features().editableMappingsEnabled;

  return (
    <>
      {showSkeletonButtons ? <SkeletonSpecificButtons /> : null}

      {showNewBoundingBoxButton ? (
        <Space.Compact>
          <CreateNewBoundingBoxButton />
        </Space.Compact>
      ) : null}

      {showCreateCellButton || showChangeBrushSizeButton ? (
        <Space.Compact>
          {showCreateCellButton ? <CreateSegmentButton /> : null}
          {showChangeBrushSizeButton ? <ChangeBrushSizePopover /> : null}
        </Space.Compact>
      ) : null}

      <OverwriteModeSwitch
        isControlOrMetaPressed={isControlOrMetaPressed}
        isShiftPressed={isShiftPressed}
        visible={adaptedActiveTool.hasOverwriteCapabilities}
      />

      {adaptedActiveTool === AnnotationTool.QUICK_SELECT && <QuickSelectSettingsPopover />}

      {adaptedActiveTool.hasOverwriteCapabilities ? <VolumeInterpolationButton /> : null}

      {adaptedActiveTool === AnnotationTool.FILL_CELL ? <FloodFillSettings /> : null}

      {adaptedActiveTool === AnnotationTool.PROOFREAD && areEditableMappingsEnabled ? (
        <ProofreadingComponents />
      ) : null}
    </>
  );
}

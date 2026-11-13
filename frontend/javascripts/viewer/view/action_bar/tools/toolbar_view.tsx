import Icon, { InfoCircleOutlined } from "@ant-design/icons";
import NewBoundingBoxIcon from "@images/icons/icon-bounding-box-new.svg?react";
import { Radio, type RadioChangeEvent, Space, Tag } from "antd";
import FastTooltip from "components/fast_tooltip";
import features from "features";
import { handleGenericError } from "libs/error_handling";
import { useKeyPress, useWindowWidth, useWkSelector } from "libs/react_hooks";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import Constants, { ControlModeEnum } from "viewer/constants";
import {
  AnnotationTool,
  type AnnotationToolId,
  adaptActiveToolToShortcuts,
  Toolkit,
  Toolkits,
  VolumeTools,
} from "viewer/model/accessors/tool_accessor";
import { getSomeTracing } from "viewer/model/accessors/tracing_accessor";
import { setToolAction } from "viewer/model/actions/ui_actions";
import { reserveIdAndAddBoundingBox } from "viewer/model/helpers/bounding_box_creation_helpers";
import Store from "viewer/store";
import ButtonComponent from "viewer/view/components/button_component";
import { isLayerRegistrationWorker } from "viewer/view/layer_registration/layer_registration_protocol";
import { ToolDropdown } from "../tool_dropdown";
import { ChangeBrushSizePopover } from "./brush_presets";
import { LayerRegistrationButtons } from "./layer_registration_specific_ui";
import { SkeletonSpecificButtons } from "./skeleton_specific_ui";
import { ToolIdToComponent } from "./tool_buttons";
import {
  ACTIONBAR_MARGIN_LEFT,
  NARROW_BUTTON_STYLE,
  UnderlyingActiveToolContext,
} from "./tool_helpers";
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
  const [isCreating, setIsCreating] = useState(false);

  const handleAddNewUserBoundingBox = useCallback(async () => {
    setIsCreating(true);
    try {
      const tracingId = getSomeTracing(Store.getState().annotation).tracingId;
      await reserveIdAndAddBoundingBox(dispatch, tracingId);
    } catch (error) {
      handleGenericError(error as Error, "Could not create a new bounding box.");
    } finally {
      setIsCreating(false);
    }
  }, [dispatch]);

  return (
    <ButtonComponent
      onClick={handleAddNewUserBoundingBox}
      loading={isCreating}
      style={NARROW_BUTTON_STYLE}
      title="Create a new bounding box centered around the current position."
      icon={<Icon component={NewBoundingBoxIcon} aria-label="New Bounding Box Icon" />}
    />
  );
}

// The active tool and the tool it is shown as while modifier keys are pressed (see
// adaptActiveToolToShortcuts).
function useActiveToolWithShortcuts() {
  const activeTool = useWkSelector((state) => state.uiInformation.activeTool);
  const isShiftPressed = useKeyPress("Shift");
  const isControlOrMetaPressed = useKeyPress("ControlOrMeta");
  const isAltPressed = useKeyPress("Alt");
  const adaptedActiveTool = adaptActiveToolToShortcuts(
    activeTool,
    isShiftPressed,
    isControlOrMetaPressed,
    isAltPressed,
  );
  return { activeTool, adaptedActiveTool, isShiftPressed, isControlOrMetaPressed };
}

// One button per tool. children are rendered after the buttons, inside the same group.
function ToolButtons({
  tools,
  activeTool,
  adaptedActiveTool,
  children,
}: {
  tools: AnnotationTool[];
  activeTool: AnnotationTool;
  adaptedActiveTool: AnnotationTool;
  children?: ReactNode;
}) {
  const dispatch = useDispatch();
  const handleSetTool = useCallback(
    (event: RadioChangeEvent) => {
      const value = event.target.value as AnnotationToolId | null; // null if dropdown for more tools is clicked
      if (value != null) dispatch(setToolAction(AnnotationTool[value]));
    },
    [dispatch],
  );

  return (
    <UnderlyingActiveToolContext.Provider
      value={activeTool !== adaptedActiveTool ? activeTool.id : null}
    >
      <Radio.Group onChange={handleSetTool} value={adaptedActiveTool.id} buttonStyle="solid">
        {tools.map((tool) => {
          const ToolButton = ToolIdToComponent[tool.id];
          return <ToolButton key={tool.id} adaptedActiveTool={adaptedActiveTool} />;
        })}
        {children}
      </Radio.Group>
    </UnderlyingActiveToolContext.Provider>
  );
}

// The workers are always narrow, but they only offer the two tools for placing landmarks, so all
// tools are shown.
function LayerRegistrationToolbar() {
  const { activeTool, adaptedActiveTool } = useActiveToolWithShortcuts();
  return (
    <>
      <ToolButtons
        tools={Toolkits[Toolkit.LANDMARKS]}
        activeTool={activeTool}
        adaptedActiveTool={adaptedActiveTool}
      />
      <LayerRegistrationButtons />
    </>
  );
}

function DefaultToolbar() {
  const hasVolume = useWkSelector((state) => state.annotation?.volumes.length > 0);
  const hasSkeleton = useWkSelector((state) => state.annotation?.skeleton != null);
  const toolkit = useWkSelector((state) => state.userConfiguration.activeToolkit);
  const isSplitToolkit = toolkit === Toolkit.SPLIT_SEGMENTS;
  const windowWidth = useWindowWidth();
  const isWiderScreen = useMemo(() => windowWidth >= Constants.NARROW_SCREEN_WIDTH, [windowWidth]);
  const toolTimestamps = useWkSelector((state) => state.userConfiguration.timestampsForTools);
  const isViewMode = useWkSelector(
    (state) => state.temporaryConfiguration.controlMode === ControlModeEnum.VIEW,
  );
  const showAllTools = isWiderScreen || toolkit === Toolkit.READ_ONLY_TOOLS || isViewMode;
  const { activeTool, adaptedActiveTool, isShiftPressed, isControlOrMetaPressed } =
    useActiveToolWithShortcuts();

  const toolsForButtons = useMemo(() => {
    if (showAllTools) return Toolkits[toolkit];
    const adaptToolId = (toolId: AnnotationToolId): AnnotationToolId => {
      // fix tools with tool menus
      if (toolId === AnnotationTool.TRACE.id) return AnnotationTool.BRUSH.id;
      if (toolId === AnnotationTool.ERASE_TRACE.id) return AnnotationTool.ERASE_BRUSH.id;
      if (toolId === AnnotationTool.AREA_MEASUREMENT.id) return AnnotationTool.LINE_MEASUREMENT.id;
      return toolId;
    };
    const allToolsInToolkit = Toolkits[toolkit];
    const lruTools = Object.entries(toolTimestamps)
      .sort(([, timestampA], [, timestampB]) => timestampB - timestampA)
      .map(([toolId]) => toolId as AnnotationToolId);
    const lastUsedTools = lruTools
      .map((toolId) => adaptToolId(toolId))
      .filter(
        (toolId, index, toolIds) =>
          allToolsInToolkit.some((tool) => tool.id === toolId) && toolIds.indexOf(toolId) === index,
      )
      .slice(0, Constants.NUMBER_OF_TOOLS_IN_TOOLBAR);
    return allToolsInToolkit.filter((tool) => lastUsedTools.includes(tool.id));
  }, [showAllTools, toolkit, toolTimestamps]);

  return (
    <>
      <ToolButtons
        tools={toolsForButtons}
        activeTool={activeTool}
        adaptedActiveTool={adaptedActiveTool}
      >
        <ToolDropdown />
      </ToolButtons>

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
            color="warning"
          >
            Split Workflow
          </Tag>
        </FastTooltip>
      ) : null}
    </>
  );
}

export default function ToolbarView() {
  return isLayerRegistrationWorker() ? <LayerRegistrationToolbar /> : <DefaultToolbar />;
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

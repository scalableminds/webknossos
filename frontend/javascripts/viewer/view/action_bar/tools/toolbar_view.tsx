import Icon, { InfoCircleOutlined } from "@ant-design/icons";
import AreaMeasurementIcon from "@images/icons/icon-area-measurement.svg?react";
import NewBoundingBoxIcon from "@images/icons/icon-bounding-box-new.svg?react";
import LineMeasurementIcon from "@images/icons/icon-line-measurement.svg?react";
import { Radio, type RadioChangeEvent, Space, Tag } from "antd";
import FastTooltip from "components/fast_tooltip";
import features from "features";
import { useKeyPress, useWkSelector } from "libs/react_hooks";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
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
import { ACTIONBAR_MARGIN_LEFT, NARROW_BUTTON_STYLE, RadioButtonWithTooltip } from "./tool_helpers";
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
      const value = event.target.value as AnnotationToolId;
      dispatch(setToolAction(AnnotationTool[value]));
    },
    [dispatch],
  );

  return (
    <>
      <Radio.Group onChange={handleSetTool} value={adaptedActiveTool.id}>
        {Toolkits[toolkit].map((tool) => {
          const ToolButton = ToolIdToComponent[tool.id];
          return <ToolButton key={tool.id} adaptedActiveTool={adaptedActiveTool} />;
        })}
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

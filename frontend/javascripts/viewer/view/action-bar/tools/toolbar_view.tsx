import { InfoCircleOutlined } from "@ant-design/icons";
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
  MeasurementTools,
  Toolkit,
  Toolkits,
  VolumeTools,
} from "viewer/model/accessors/tool_accessor";
import { addUserBoundingBoxAction } from "viewer/model/actions/annotation_actions";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import { setToolAction } from "viewer/model/actions/ui_actions";
import ButtonComponent, { ToggleButton } from "viewer/view/components/button_component";
import { ChangeBrushSizePopover } from "./brush_presets";
import { SkeletonSpecificButtons } from "./skeleton_specific_ui";
import { ToolIdToComponent } from "./tool_buttons";
import {
  ACTIONBAR_MARGIN_LEFT,
  IMG_STYLE_FOR_SPACEY_ICONS,
  NARROW_BUTTON_STYLE,
  RadioButtonWithTooltip,
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

  const handleAddNewUserBoundingBox = useCallback(() => {
    dispatch(addUserBoundingBoxAction());
  }, [dispatch]);

  return (
    <ButtonComponent
      onClick={handleAddNewUserBoundingBox}
      style={{
        paddingLeft: 9,
        paddingRight: 9,
      }}
      title="Create a new bounding box centered around the current position."
    >
      <img
        src="/assets/images/new-bounding-box.svg"
        alt="New Bounding Box Icon"
        style={IMG_STYLE_FOR_SPACEY_ICONS}
      />
    </ButtonComponent>
  );
}

function toolToRadioGroupValue(adaptedActiveTool: AnnotationTool): AnnotationToolId {
  /*
   * The tool radio buttons only contain one button for both measurement tools (area
   * and line). The selection of the "sub tool" can be done when one of them is active
   * with extra buttons next to the radio group.
   * To ensure that the highlighting of the generic measurement tool button works properly,
   * we map both measurement tools to the line tool here.
   */
  if (adaptedActiveTool === AnnotationTool.AREA_MEASUREMENT) {
    return AnnotationTool.LINE_MEASUREMENT.id;
  }
  return adaptedActiveTool.id;
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
      <Radio.Group onChange={handleSetTool} value={toolToRadioGroupValue(adaptedActiveTool)}>
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
  const dispatch = useDispatch();
  const quickSelectConfig = useWkSelector((state) => state.userConfiguration.quickSelect);
  const isAISelectAvailable = features().segmentAnythingEnabled;
  const isQuickSelectHeuristic = quickSelectConfig.useHeuristic || !isAISelectAvailable;
  const quickSelectTooltipText = isAISelectAvailable
    ? isQuickSelectHeuristic
      ? "The quick select tool is now working without AI. Activate AI for better results."
      : "The quick select tool is now working with AI."
    : "The quick select tool with AI is only available on webknossos.org";
  const areEditableMappingsEnabled = features().editableMappingsEnabled;
  const toggleQuickSelectStrategy = () => {
    dispatch(
      updateUserSettingAction("quickSelect", {
        ...quickSelectConfig,
        useHeuristic: !quickSelectConfig.useHeuristic,
      }),
    );
  };

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

      {adaptedActiveTool === AnnotationTool.QUICK_SELECT && (
        <div>
          <ToggleButton
            active={!isQuickSelectHeuristic}
            style={{
              ...NARROW_BUTTON_STYLE,
              opacity: isQuickSelectHeuristic ? 0.5 : 1,
            }}
            onClick={toggleQuickSelectStrategy}
            disabled={!isAISelectAvailable}
            title={quickSelectTooltipText}
          >
            <i className="fa-regular fa-magic icon-margin-right" /> AI
          </ToggleButton>

          <QuickSelectSettingsPopover />
        </div>
      )}

      {adaptedActiveTool.hasOverwriteCapabilities ? <VolumeInterpolationButton /> : null}

      {adaptedActiveTool === AnnotationTool.FILL_CELL ? <FloodFillSettings /> : null}

      {adaptedActiveTool === AnnotationTool.PROOFREAD && areEditableMappingsEnabled ? (
        <ProofreadingComponents />
      ) : null}

      {MeasurementTools.includes(adaptedActiveTool) ? (
        <MeasurementToolSwitch activeTool={adaptedActiveTool} />
      ) : null}
    </>
  );
}

function MeasurementToolSwitch({ activeTool }: { activeTool: AnnotationTool }) {
  const dispatch = useDispatch();
  const disabledInfosForTools = useWkSelector(getDisabledInfoForTools);
  const { isDisabled, explanation } = disabledInfosForTools[AnnotationTool.AREA_MEASUREMENT.id];

  const handleSetMeasurementTool = (evt: RadioChangeEvent) => {
    const value = evt.target.value as AnnotationToolId;
    dispatch(setToolAction(AnnotationTool[value]));
  };
  return (
    <Radio.Group value={activeTool.id} onChange={handleSetMeasurementTool}>
      <RadioButtonWithTooltip
        title="Measure distances with connected lines by using Left Click."
        style={NARROW_BUTTON_STYLE}
        value={AnnotationTool.LINE_MEASUREMENT.id}
      >
        <img src="/assets/images/line-measurement.svg" alt="Measurement Tool Icon" />
      </RadioButtonWithTooltip>
      <RadioButtonWithTooltip
        disabledTitle={explanation}
        title={
          "Measure areas by using Left Drag. Avoid self-crossing polygon structure for accurate results."
        }
        style={NARROW_BUTTON_STYLE}
        value={AnnotationTool.AREA_MEASUREMENT.id}
        disabled={isDisabled}
      >
        <img
          src="/assets/images/area-measurement.svg"
          alt="Measurement Tool Icon"
          style={IMG_STYLE_FOR_SPACEY_ICONS}
        />
      </RadioButtonWithTooltip>
    </Radio.Group>
  );
}

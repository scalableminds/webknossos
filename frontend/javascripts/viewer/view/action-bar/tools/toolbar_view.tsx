import { InfoCircleOutlined } from "@ant-design/icons";
import { Radio, type RadioChangeEvent, Space, Tag } from "antd";
import { useDispatch } from "react-redux";

import { useKeyPress } from "libs/react_hooks";
import { useWkSelector } from "libs/react_hooks";
import {
  AnnotationTool,
  MeasurementTools,
  Toolkit,
  Toolkits,
  VolumeTools,
  adaptActiveToolToShortcuts,
} from "viewer/model/accessors/tool_accessor";
import { addUserBoundingBoxAction } from "viewer/model/actions/annotation_actions";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import { setToolAction } from "viewer/model/actions/ui_actions";
import Store from "viewer/store";
import ButtonComponent, { ToggleButton } from "viewer/view/components/button_component";

import FastTooltip from "components/fast_tooltip";
import features from "features";
import { ChangeBrushSizePopover } from "./brush_presets";
import { SkeletonSpecificButtons } from "./skeleton_specific_ui";
import { ToolIdToComponent } from "./tool_buttons";
import {
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

const handleAddNewUserBoundingBox = () => {
  Store.dispatch(addUserBoundingBoxAction());
};

function CreateNewBoundingBoxButton() {
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

function toolToRadioGroupValue(adaptedActiveTool: AnnotationTool): AnnotationTool {
  /*
   * The tool radio buttons only contain one button for both measurement tools (area
   * and line). The selection of the "sub tool" can be done when one of them is active
   * with extra buttons next to the radio group.
   * To ensure that the highlighting of the generic measurement tool button works properly,
   * we map both measurement tools to the line tool here.
   */
  if (adaptedActiveTool === AnnotationTool.AREA_MEASUREMENT) {
    return AnnotationTool.LINE_MEASUREMENT;
  }
  return adaptedActiveTool;
}

const handleSetTool = (event: RadioChangeEvent) => {
  const value = event.target.value as AnnotationTool;
  Store.dispatch(setToolAction(value));
};

export default function ToolbarView() {
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
          <Tag style={{ marginLeft: 12 }} color="orange">
            <InfoCircleOutlined style={{ marginRight: 4 }} />
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
        <Space.Compact
          style={{
            marginLeft: 10,
          }}
        >
          <CreateNewBoundingBoxButton />
        </Space.Compact>
      ) : null}

      {showCreateCellButton || showChangeBrushSizeButton ? (
        <Space.Compact
          style={{
            marginLeft: 12,
          }}
        >
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
        <>
          <ToggleButton
            active={!isQuickSelectHeuristic}
            style={{
              ...NARROW_BUTTON_STYLE,
              opacity: isQuickSelectHeuristic ? 0.5 : 1,
              marginLeft: 12,
            }}
            onClick={toggleQuickSelectStrategy}
            disabled={!isAISelectAvailable}
            title={quickSelectTooltipText}
          >
            <i className="fas fa-magic icon-margin-right" /> AI
          </ToggleButton>

          <QuickSelectSettingsPopover />
        </>
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

  const handleSetMeasurementTool = (evt: RadioChangeEvent) => {
    dispatch(setToolAction(evt.target.value));
  };
  return (
    <Radio.Group
      value={activeTool}
      onChange={handleSetMeasurementTool}
      style={{
        marginLeft: 10,
      }}
    >
      <RadioButtonWithTooltip
        title="Measure distances with connected lines by using Left Click."
        style={NARROW_BUTTON_STYLE}
        value={AnnotationTool.LINE_MEASUREMENT}
      >
        <img src="/assets/images/line-measurement.svg" alt="Measurement Tool Icon" />
      </RadioButtonWithTooltip>
      <RadioButtonWithTooltip
        title={
          "Measure areas by using Left Drag. Avoid self-crossing polygon structure for accurate results."
        }
        style={NARROW_BUTTON_STYLE}
        value={AnnotationTool.AREA_MEASUREMENT}
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

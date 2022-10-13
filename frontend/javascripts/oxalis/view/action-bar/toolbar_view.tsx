import { Radio, Tooltip, Badge, Space, Popover, RadioChangeEvent, Dropdown, Menu } from "antd";
import { ClearOutlined, DownOutlined, ExportOutlined } from "@ant-design/icons";
import { useSelector, useDispatch } from "react-redux";
import React, { useEffect, useCallback, useState } from "react";

import { showToastWarningForLargestSegmentIdMissing } from "oxalis/view/largest_segment_id_modal";
import { LogSliderSetting } from "oxalis/view/components/setting_input_views";
import { addUserBoundingBoxAction } from "oxalis/model/actions/annotation_actions";
import {
  interpolateSegmentationLayerAction,
  createCellAction,
} from "oxalis/model/actions/volumetracing_actions";
import {
  createTreeAction,
  setMergerModeEnabledAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { document } from "libs/window";
import {
  getActiveSegmentationTracing,
  getMappingInfoForVolumeTracing,
  getMaximumBrushSize,
  getRenderableResolutionForActiveSegmentationTracing,
  getSegmentColorAsHSL,
  hasEditableMapping,
} from "oxalis/model/accessors/volumetracing_accessor";
import { getActiveTree } from "oxalis/model/accessors/skeletontracing_accessor";
import {
  getDisabledInfoForTools,
  adaptActiveToolToShortcuts,
} from "oxalis/model/accessors/tool_accessor";
import { setToolAction } from "oxalis/model/actions/ui_actions";
import { toNullable } from "libs/utils";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { usePrevious, useKeyPress } from "libs/react_hooks";
import { userSettings } from "types/schemas/user_settings.schema";
import ButtonComponent from "oxalis/view/components/button_component";
import { MaterializeVolumeAnnotationModal } from "oxalis/view/right-border-tabs/starting_job_modals";
import {
  ToolsWithOverwriteCapabilities,
  AnnotationToolEnum,
  OverwriteModeEnum,
  FillModeEnum,
  VolumeTools,
  MappingStatusEnum,
  AnnotationTool,
  OverwriteMode,
  ToolsWithInterpolationCapabilities,
  InterpolationModeEnum,
  InterpolationMode,
} from "oxalis/constants";
import Model from "oxalis/model";
import Store, { OxalisState, VolumeTracing } from "oxalis/store";

import features from "features";
import { getInterpolationInfo } from "oxalis/model/sagas/volume/volume_interpolation_saga";
import { hslaToCSS } from "oxalis/shaders/utils.glsl";
import { clearProofreadingByProducts } from "oxalis/model/actions/proofread_actions";
import { hasAgglomerateMapping } from "oxalis/controller/combinations/segmentation_handlers";

const narrowButtonStyle = {
  paddingLeft: 10,
  paddingRight: 8,
};
const imgStyleForSpaceyIcons = {
  width: 19,
  height: 19,
  lineHeight: 10,
  marginTop: -2,
};

function getSkeletonToolHint(
  activeTool: AnnotationTool,
  isShiftPressed: boolean,
  isControlPressed: boolean,
  isAltPressed: boolean,
): string | null | undefined {
  if (activeTool !== AnnotationToolEnum.SKELETON) {
    return null;
  }

  if (!isShiftPressed && !isControlPressed && !isAltPressed) {
    return null;
  }

  if (isShiftPressed && !isControlPressed && !isAltPressed) {
    return "Click to select a node. Right-click to open a contextmenu.";
  }

  if (!isShiftPressed && isControlPressed && !isAltPressed) {
    return "Drag to move the selected node. Right-click to create a new node without selecting it.";
  }

  if (isShiftPressed && !isControlPressed && isAltPressed) {
    return "Click on a node in another tree to merge the two trees.";
  }

  if (isShiftPressed && isControlPressed && !isAltPressed) {
    return "Click on a node to delete the edge to the currently active node.";
  }

  return null;
}

function toggleOverwriteMode(overwriteMode: OverwriteMode) {
  if (overwriteMode === OverwriteModeEnum.OVERWRITE_ALL) {
    return OverwriteModeEnum.OVERWRITE_EMPTY;
  } else {
    return OverwriteModeEnum.OVERWRITE_ALL;
  }
}

const handleUpdateBrushSize = (value: number) => {
  Store.dispatch(updateUserSettingAction("brushSize", value));
};

const handleSetTool = (event: RadioChangeEvent) => {
  const value = event.target.value as AnnotationTool;
  Store.dispatch(setToolAction(value));
};

const handleCreateCell = () => {
  const volumeLayer = getActiveSegmentationTracing(Store.getState());

  if (volumeLayer == null || volumeLayer.tracingId == null) {
    return;
  }

  if (volumeLayer.largestSegmentId != null) {
    Store.dispatch(createCellAction(volumeLayer.largestSegmentId));
  } else {
    showToastWarningForLargestSegmentIdMissing(volumeLayer);
  }
};

const handleAddNewUserBoundingBox = () => {
  Store.dispatch(addUserBoundingBoxAction());
};

const handleSetOverwriteMode = (event: {
  target: {
    value: OverwriteMode;
  };
}) => {
  Store.dispatch(updateUserSettingAction("overwriteMode", event.target.value));
};

function RadioButtonWithTooltip({
  title,
  disabledTitle,
  disabled,
  onClick,
  ...props
}: {
  title: string;
  disabledTitle?: string;
  disabled?: boolean;
  children: React.ReactNode;
  style: React.CSSProperties;
  value: string;
  onClick?: Function;
}) {
  return (
    <Tooltip title={disabled ? disabledTitle : title}>
      <Radio.Button
        disabled={disabled}
        {...props}
        onClick={(evt) => {
          if (document.activeElement) {
            (document.activeElement as HTMLElement).blur();
          }
          if (onClick) {
            onClick(evt);
          }
        }}
      />
    </Tooltip>
  );
}

function OverwriteModeSwitch({
  isControlPressed,
  isShiftPressed,
  visible,
}: {
  isControlPressed: boolean;
  isShiftPressed: boolean;
  visible: boolean;
}) {
  // Only CTRL should modify the overwrite mode. CTRL + Shift can be used to switch to the
  // erase tool, which should not affect the default overwrite mode.
  const overwriteMode = useSelector((state: OxalisState) => state.userConfiguration.overwriteMode);
  const previousIsControlPressed = usePrevious(isControlPressed);
  const previousIsShiftPressed = usePrevious(isShiftPressed);
  useEffect(() => {
    // There are four possible states:
    // (1) no modifier is pressed
    // (2) CTRL is pressed
    // (3) Shift is pressed
    // (4) CTRL + Shift is pressed
    // The overwrite mode needs to be toggled when
    // - switching from state (1) to (2) (or vice versa)
    // - switching from state (2) to (4) (or vice versa)
    // Consequently, the mode is only toggled effectively, when CTRL is pressed.
    // Alternatively, we could store the selected value and the overriden value
    // separately in the store. However, this solution works, too.
    const needsModeToggle =
      (!isShiftPressed &&
        isControlPressed &&
        previousIsControlPressed === previousIsShiftPressed) ||
      (isShiftPressed === isControlPressed && !previousIsShiftPressed && previousIsControlPressed);

    if (needsModeToggle) {
      Store.dispatch(updateUserSettingAction("overwriteMode", toggleOverwriteMode(overwriteMode)));
    }
  }, [isControlPressed, isShiftPressed, previousIsControlPressed, previousIsShiftPressed]);

  if (!visible) {
    // This component's hooks should still be active, even when the component is invisible.
    // Otherwise, the toggling of the overwrite mode via "CTRL" wouldn't work consistently
    // when being combined with other modifiers, which hide the component.
    return null;
  }

  return (
    <Radio.Group
      value={overwriteMode}
      // @ts-expect-error ts-migrate(2322) FIXME: Type '(event: {    target: {        value: Overwri... Remove this comment to see the full error message
      onChange={handleSetOverwriteMode}
      style={{
        marginLeft: 10,
      }}
    >
      <RadioButtonWithTooltip
        title="Overwrite everything. This setting can be toggled by holding CTRL."
        style={narrowButtonStyle}
        value={OverwriteModeEnum.OVERWRITE_ALL}
      >
        <img src="/assets/images/overwrite-all.svg" alt="Overwrite All Icon" />
      </RadioButtonWithTooltip>
      <RadioButtonWithTooltip
        title="Only overwrite empty areas. In case of erasing, only the current segment ID is overwritten. This setting can be toggled by holding CTRL."
        style={narrowButtonStyle}
        value={OverwriteModeEnum.OVERWRITE_EMPTY}
      >
        <img src="/assets/images/overwrite-empty.svg" alt="Overwrite Empty Icon" />
      </RadioButtonWithTooltip>
    </Radio.Group>
  );
}

const INTERPOLATION_ICON = {
  [InterpolationModeEnum.INTERPOLATE]: <i className="fas fa-align-center fa-rotate-90" />,
  [InterpolationModeEnum.EXTRUDE]: <i className="fas fa-align-justify fa-rotate-90" />,
};
function VolumeInterpolationButton() {
  const dispatch = useDispatch();
  const interpolationMode = useSelector(
    (state: OxalisState) => state.userConfiguration.interpolationMode,
  );

  const onInterpolateClick = (e: React.MouseEvent<HTMLButtonElement> | null) => {
    e?.currentTarget.blur();
    dispatch(interpolateSegmentationLayerAction());
  };

  const { tooltipTitle, isDisabled } = useSelector((state: OxalisState) =>
    getInterpolationInfo(state, "Not available since"),
  );

  const menu = (
    <Menu
      onClick={(e) => {
        dispatch(updateUserSettingAction("interpolationMode", e.key as InterpolationMode));
        onInterpolateClick(null);
      }}
      items={[
        {
          label: "Interpolate current segment",
          key: InterpolationModeEnum.INTERPOLATE,
          icon: INTERPOLATION_ICON[InterpolationModeEnum.INTERPOLATE],
        },
        {
          label: "Extrude (copy) current segment",
          key: InterpolationModeEnum.EXTRUDE,
          icon: INTERPOLATION_ICON[InterpolationModeEnum.EXTRUDE],
        },
      ]}
    />
  );

  const buttonsRender = useCallback(
    ([leftButton, rightButton]) => [
      <Tooltip title={tooltipTitle} key="leftButton">
        {React.cloneElement(leftButton as React.ReactElement<any, string>, {
          disabled: isDisabled,
        })}
      </Tooltip>,
      rightButton,
    ],
    [tooltipTitle],
  );

  return (
    <Dropdown.Button
      icon={<DownOutlined />}
      overlay={menu}
      onClick={onInterpolateClick}
      style={{ padding: "0 5px 0 6px" }}
      buttonsRender={buttonsRender}
    >
      {React.cloneElement(INTERPOLATION_ICON[interpolationMode], { style: { margin: -4 } })}
    </Dropdown.Button>
  );
}

function AdditionalSkeletonModesButtons() {
  const dispatch = useDispatch();
  const isMergerModeEnabled = useSelector(
    (state: OxalisState) => state.temporaryConfiguration.isMergerModeEnabled,
  );
  const [showMaterializeVolumeAnnotationModal, setShowMaterializeVolumeAnnotationModal] =
    useState<boolean>(false);
  const isNewNodeNewTreeModeOn = useSelector(
    (state: OxalisState) => state.userConfiguration.newNodeNewTree,
  );

  const segmentationTracingLayer = useSelector((state: OxalisState) =>
    getActiveSegmentationTracing(state),
  );
  const isEditableMappingActive =
    segmentationTracingLayer != null && !!segmentationTracingLayer.mappingIsEditable;
  const mergerModeTooltipText = isEditableMappingActive
    ? "Merger mode cannot be enabled while an editable mapping is active."
    : "Toggle Merger Mode - When enabled, skeletons that connect multiple segments will merge those segments.";

  const toggleNewNodeNewTreeMode = () =>
    dispatch(updateUserSettingAction("newNodeNewTree", !isNewNodeNewTreeModeOn));

  const toggleMergerMode = () => dispatch(setMergerModeEnabledAction(!isMergerModeEnabled));

  // The z-index is needed so that the blue border of an active button does override the border color of the neighboring non active button.
  const activeButtonStyle = { ...narrowButtonStyle, borderColor: "var(--ant-primary)", zIndex: 1 };
  const newNodeNewTreeModeButtonStyle = isNewNodeNewTreeModeOn
    ? activeButtonStyle
    : narrowButtonStyle;
  const mergerModeButtonStyle = isMergerModeEnabled ? activeButtonStyle : narrowButtonStyle;
  return (
    <React.Fragment>
      <ButtonComponent
        style={newNodeNewTreeModeButtonStyle}
        onClick={toggleNewNodeNewTreeMode}
        title="Toggle the Single node Tree (soma clicking) mode - If enabled, each node creation will create a new tree."
      >
        <img
          style={imgStyleForSpaceyIcons}
          src="/assets/images/soma-clicking-icon.svg"
          alt="Single Node Tree Mode"
        />
      </ButtonComponent>
      <ButtonComponent
        style={{
          ...mergerModeButtonStyle,
          opacity: isEditableMappingActive ? 0.5 : 1,
        }}
        onClick={toggleMergerMode}
        disabled={isEditableMappingActive}
        title={mergerModeTooltipText}
      >
        <img
          style={imgStyleForSpaceyIcons}
          src="/assets/images/merger-mode-icon.svg"
          alt="Merger Mode"
        />
      </ButtonComponent>
      {features().jobsEnabled && isMergerModeEnabled && (
        <ButtonComponent
          style={narrowButtonStyle}
          onClick={() => setShowMaterializeVolumeAnnotationModal(true)}
          title="Materialize this merger mode annotation into a new dataset."
        >
          <ExportOutlined />
        </ButtonComponent>
      )}
      {features().jobsEnabled && showMaterializeVolumeAnnotationModal && (
        <MaterializeVolumeAnnotationModal
          handleClose={() => setShowMaterializeVolumeAnnotationModal(false)}
        />
      )}
    </React.Fragment>
  );
}

const mapId = (volumeTracing: VolumeTracing | null | undefined, id: number) => {
  if (!volumeTracing) {
    return null;
  }
  const { cube } = Model.getSegmentationTracingLayer(volumeTracing.tracingId);
  return cube.mapId(id);
};

function CreateCellButton() {
  const volumeTracing = useSelector((state: OxalisState) => getActiveSegmentationTracing(state));
  const unmappedActiveCellId = volumeTracing != null ? volumeTracing.activeCellId : 0;
  const { mappingStatus } = useSelector((state: OxalisState) =>
    getMappingInfoForVolumeTracing(state, volumeTracing != null ? volumeTracing.tracingId : null),
  );
  const isMappingEnabled = mappingStatus === MappingStatusEnum.ENABLED;

  const activeCellId = isMappingEnabled
    ? mapId(volumeTracing, unmappedActiveCellId)
    : unmappedActiveCellId;

  const activeCellColor = useSelector((state: OxalisState) => {
    if (!activeCellId) {
      return null;
    }
    return hslaToCSS(getSegmentColorAsHSL(state, activeCellId));
  });

  const mappedIdInfo = isMappingEnabled ? ` (currently mapped to ${activeCellId})` : "";
  return (
    <Badge
      dot
      style={{
        boxShadow: "none",
        background: activeCellColor || "transparent",
        zIndex: 1000,
      }}
    >
      <ButtonComponent
        onClick={handleCreateCell}
        style={{
          width: 36,
          paddingLeft: 10,
        }}
        title={`Create a new segment id (C) – The active segment id is ${unmappedActiveCellId}${mappedIdInfo}.`}
      >
        <img src="/assets/images/new-cell.svg" alt="New Segment Icon" />
      </ButtonComponent>
    </Badge>
  );
}

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
        style={imgStyleForSpaceyIcons}
      />
    </ButtonComponent>
  );
}

function CreateTreeButton() {
  const dispatch = useDispatch();
  const activeTree = useSelector((state: OxalisState) =>
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'SkeletonTracing | null | undefin... Remove this comment to see the full error message
    toNullable(getActiveTree(state.tracing.skeleton)),
  );
  const rgbColorString =
    activeTree != null
      ? `rgb(${activeTree.color.map((c) => Math.round(c * 255)).join(",")})`
      : "transparent";
  const activeTreeHint =
    activeTree != null
      ? `The active tree id is ${activeTree.treeId}.`
      : "No tree is currently selected";

  const handleCreateTree = () => dispatch(createTreeAction());

  return (
    <Badge
      dot
      style={{
        boxShadow: "none",
        background: rgbColorString,
        zIndex: 1000,
      }}
    >
      <ButtonComponent
        onClick={handleCreateTree}
        style={{ ...narrowButtonStyle, paddingRight: 5 }}
        title={`Create a new Tree (C) – ${activeTreeHint}`}
      >
        <i
          style={{
            opacity: 0.9,
            transform: "scale(0.9) translate(-2px, -1px)",
            marginRight: 3,
          }}
          className="fas fa-project-diagram"
        />
        <i
          className="fas fa-plus"
          style={{
            position: "absolute",
            top: 13,
            left: 21,
            fontSize: 11,
          }}
        />
      </ButtonComponent>
    </Badge>
  );
}

function ChangeBrushSizeButton() {
  const brushSize = useSelector((state: OxalisState) => state.userConfiguration.brushSize);
  const maximumBrushSize = useSelector((state: OxalisState) => getMaximumBrushSize(state));
  return (
    <Tooltip title="Change the brush size">
      <Popover
        content={
          <div
            style={{
              width: 230,
            }}
          >
            <div
              style={{
                marginBottom: 8,
              }}
            >
              Set the brush size:
            </div>
            <LogSliderSetting
              label=""
              roundTo={0}
              min={userSettings.brushSize.minimum}
              max={maximumBrushSize}
              // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
              step={5}
              spans={[0, 14, 10]}
              value={brushSize}
              onChange={handleUpdateBrushSize}
            />
          </div>
        }
        trigger="click"
        placement="bottom"
        style={{
          cursor: "pointer",
        }}
      >
        <ButtonComponent
          style={{
            width: 36,
            padding: 0,
          }}
        >
          <img
            src="/assets/images/brush-size-icon.svg"
            alt="Brush Size"
            style={{
              width: 20,
              height: 20,
            }}
          />
        </ButtonComponent>
      </Popover>
    </Tooltip>
  );
}

export default function ToolbarView() {
  const hasVolume = useSelector((state: OxalisState) => state.tracing.volumes.length > 0);
  const hasSkeleton = useSelector((state: OxalisState) => state.tracing.skeleton != null);
  const isAgglomerateMappingEnabled = useSelector(hasAgglomerateMapping);

  const [lastForcefulDisabledTool, setLastForcefulDisabledTool] = useState<AnnotationTool | null>(
    null,
  );
  const isVolumeModificationAllowed = useSelector(
    (state: OxalisState) => !hasEditableMapping(state),
  );
  const useLegacyBindings = useSelector(
    (state: OxalisState) => state.userConfiguration.useLegacyBindings,
  );
  const activeTool = useSelector((state: OxalisState) => state.uiInformation.activeTool);
  const maybeResolutionWithZoomStep = useSelector(
    getRenderableResolutionForActiveSegmentationTracing,
  );
  const labeledResolution =
    maybeResolutionWithZoomStep != null ? maybeResolutionWithZoomStep.resolution : null;
  const hasResolutionWithHigherDimension = (labeledResolution || []).some((val) => val > 1);
  const multiSliceAnnotationInfoIcon = hasResolutionWithHigherDimension ? (
    <Tooltip title="You are annotating in a low resolution. Depending on the used viewport, you might be annotating multiple slices at once.">
      <i
        className="fas fa-layer-group"
        style={{
          marginLeft: 4,
        }}
      />
    </Tooltip>
  ) : null;
  const disabledInfosForTools = useSelector(getDisabledInfoForTools);
  // Ensure that no volume-tool is selected when being in merger mode.
  // Even though, the volume toolbar is disabled, the user can still cycle through
  // the tools via the w shortcut. In that case, the effect-hook is re-executed
  // and the tool is switched to MOVE.
  const disabledInfoForCurrentTool = disabledInfosForTools[activeTool];
  useEffect(() => {
    if (disabledInfoForCurrentTool.isDisabled) {
      setLastForcefulDisabledTool(activeTool);
      Store.dispatch(setToolAction(AnnotationToolEnum.MOVE));
    } else if (
      lastForcefulDisabledTool != null &&
      !disabledInfosForTools[lastForcefulDisabledTool].isDisabled &&
      activeTool === AnnotationToolEnum.MOVE
    ) {
      // Reenable the tool that was disabled before.
      setLastForcefulDisabledTool(null);
      Store.dispatch(setToolAction(lastForcefulDisabledTool));
    } else if (activeTool !== AnnotationToolEnum.MOVE) {
      // Forget the last disabled tool as another tool besides the move tool was selected.
      setLastForcefulDisabledTool(null);
    }
  }, [activeTool, disabledInfoForCurrentTool, lastForcefulDisabledTool]);
  const isShiftPressed = useKeyPress("Shift");
  const isControlPressed = useKeyPress("Control");
  const isAltPressed = useKeyPress("Alt");
  const adaptedActiveTool = adaptActiveToolToShortcuts(
    activeTool,
    isShiftPressed,
    isControlPressed,
    isAltPressed,
  );
  const skeletonToolHint =
    hasSkeleton && useLegacyBindings
      ? getSkeletonToolHint(activeTool, isShiftPressed, isControlPressed, isAltPressed)
      : null;
  const previousSkeletonToolHint = usePrevious(skeletonToolHint);
  const moveToolDescription =
    "Move – Use left-click to move around and right-click to open a contextmenu.";
  const skeletonToolDescription = useLegacyBindings
    ? "Skeleton – Use left-click to move around and right-click to create new skeleton nodes"
    : "Skeleton – Use left-click to move around or to create/select/move nodes. Right-click opens a context menu with further options.";
  const showEraseTraceTool =
    adaptedActiveTool === AnnotationToolEnum.TRACE ||
    adaptedActiveTool === AnnotationToolEnum.ERASE_TRACE;
  const showEraseBrushTool = !showEraseTraceTool;
  return (
    <>
      <Radio.Group onChange={handleSetTool} value={adaptedActiveTool}>
        <RadioButtonWithTooltip
          title={moveToolDescription}
          disabledTitle=""
          disabled={false}
          style={narrowButtonStyle}
          value={AnnotationToolEnum.MOVE}
        >
          <i
            style={{
              paddingLeft: 4,
            }}
            className="fas fa-arrows-alt"
          />
        </RadioButtonWithTooltip>

        {hasSkeleton ? (
          <RadioButtonWithTooltip
            title={skeletonToolDescription}
            disabledTitle=""
            disabled={disabledInfosForTools[AnnotationToolEnum.SKELETON].isDisabled}
            style={narrowButtonStyle}
            value={AnnotationToolEnum.SKELETON}
          >
            {/*
           When visible changes to false, the tooltip fades out in an animation. However, skeletonToolHint
           will be null, too, which means the tooltip text would immediately change to an empty string.
           To avoid this, we fallback to previousSkeletonToolHint.
          */}
            <Tooltip
              title={skeletonToolHint || previousSkeletonToolHint}
              visible={skeletonToolHint != null}
            >
              <i
                style={{
                  paddingLeft: 4,
                  opacity: disabledInfosForTools[AnnotationToolEnum.SKELETON].isDisabled ? 0.5 : 1,
                }}
                className="fas fa-project-diagram"
              />
            </Tooltip>
          </RadioButtonWithTooltip>
        ) : null}

        {hasVolume && isVolumeModificationAllowed ? (
          <React.Fragment>
            <RadioButtonWithTooltip
              title="Brush – Draw over the voxels you would like to label. Adjust the brush size with Shift + Mousewheel."
              disabledTitle={disabledInfosForTools[AnnotationToolEnum.BRUSH].explanation}
              disabled={disabledInfosForTools[AnnotationToolEnum.BRUSH].isDisabled}
              style={narrowButtonStyle}
              value={AnnotationToolEnum.BRUSH}
            >
              <i
                className="fas fa-paint-brush"
                style={{
                  opacity: disabledInfosForTools[AnnotationToolEnum.BRUSH].isDisabled ? 0.5 : 1,
                }}
              />
              {adaptedActiveTool === AnnotationToolEnum.BRUSH ? multiSliceAnnotationInfoIcon : null}
            </RadioButtonWithTooltip>

            <RadioButtonWithTooltip
              title="Erase (via Brush) – Erase the voxels by brushing over them. Adjust the brush size with Shift + Mousewheel."
              disabledTitle={disabledInfosForTools[AnnotationToolEnum.ERASE_BRUSH].explanation}
              disabled={disabledInfosForTools[AnnotationToolEnum.ERASE_BRUSH].isDisabled}
              style={{
                ...narrowButtonStyle,
                marginLeft: showEraseBrushTool ? 0 : -38,
                zIndex: showEraseBrushTool ? "initial" : -10,
                transition: "margin 0.3s",
              }}
              value={AnnotationToolEnum.ERASE_BRUSH}
            >
              <i
                className="fas fa-eraser"
                style={{
                  opacity: disabledInfosForTools[AnnotationToolEnum.ERASE_BRUSH].isDisabled
                    ? 0.5
                    : 1,
                }}
              />
              {adaptedActiveTool === AnnotationToolEnum.ERASE_BRUSH
                ? multiSliceAnnotationInfoIcon
                : null}
            </RadioButtonWithTooltip>

            <RadioButtonWithTooltip
              title="Trace – Draw outlines around the voxels you would like to label."
              disabledTitle={disabledInfosForTools[AnnotationToolEnum.TRACE].explanation}
              disabled={disabledInfosForTools[AnnotationToolEnum.TRACE].isDisabled}
              style={narrowButtonStyle}
              value={AnnotationToolEnum.TRACE}
            >
              <img
                src="/assets/images/lasso.svg"
                alt="Trace Tool Icon"
                style={{
                  opacity: disabledInfosForTools[AnnotationToolEnum.TRACE].isDisabled ? 0.5 : 1,
                }}
              />
              {adaptedActiveTool === AnnotationToolEnum.TRACE ? multiSliceAnnotationInfoIcon : null}
            </RadioButtonWithTooltip>

            <RadioButtonWithTooltip
              title="Erase – Draw outlines around the voxel you would like to erase."
              disabledTitle={disabledInfosForTools[AnnotationToolEnum.ERASE_TRACE].explanation}
              disabled={disabledInfosForTools[AnnotationToolEnum.ERASE_TRACE].isDisabled}
              style={{
                ...narrowButtonStyle,
                marginLeft: showEraseTraceTool ? 0 : -38,
                zIndex: showEraseTraceTool ? "initial" : -10,
                transition: "margin 0.3s",
              }}
              value={AnnotationToolEnum.ERASE_TRACE}
            >
              <i
                className="fas fa-eraser"
                style={{
                  opacity: disabledInfosForTools[AnnotationToolEnum.ERASE_TRACE].isDisabled
                    ? 0.5
                    : 1,
                }}
              />
              {adaptedActiveTool === AnnotationToolEnum.ERASE_TRACE
                ? multiSliceAnnotationInfoIcon
                : null}
            </RadioButtonWithTooltip>

            <RadioButtonWithTooltip
              title="Fill Tool – Flood-fill the clicked region."
              disabledTitle={disabledInfosForTools[AnnotationToolEnum.FILL_CELL].explanation}
              disabled={disabledInfosForTools[AnnotationToolEnum.FILL_CELL].isDisabled}
              style={narrowButtonStyle}
              value={AnnotationToolEnum.FILL_CELL}
            >
              <i
                className="fas fa-fill-drip"
                style={{
                  opacity: disabledInfosForTools[AnnotationToolEnum.FILL_CELL].isDisabled ? 0.5 : 1,
                  transform: "scaleX(-1)",
                }}
              />
              {adaptedActiveTool === AnnotationToolEnum.FILL_CELL
                ? multiSliceAnnotationInfoIcon
                : null}
            </RadioButtonWithTooltip>
            <RadioButtonWithTooltip
              title="Segment Picker – Click on a voxel to make its segment id the active segment id."
              disabledTitle={disabledInfosForTools[AnnotationToolEnum.PICK_CELL].explanation}
              disabled={disabledInfosForTools[AnnotationToolEnum.PICK_CELL].isDisabled}
              style={narrowButtonStyle}
              value={AnnotationToolEnum.PICK_CELL}
            >
              <i
                className="fas fa-eye-dropper"
                style={{
                  opacity: disabledInfosForTools[AnnotationToolEnum.PICK_CELL].isDisabled ? 0.5 : 1,
                }}
              />
            </RadioButtonWithTooltip>
          </React.Fragment>
        ) : null}
        <RadioButtonWithTooltip
          title="Bounding Box Tool - Create, resize and modify bounding boxes."
          disabledTitle={disabledInfosForTools[AnnotationToolEnum.BOUNDING_BOX].explanation}
          disabled={disabledInfosForTools[AnnotationToolEnum.BOUNDING_BOX].isDisabled}
          style={narrowButtonStyle}
          value={AnnotationToolEnum.BOUNDING_BOX}
        >
          <img
            src="/assets/images/bounding-box.svg"
            alt="Bounding Box Icon"
            style={{
              opacity: disabledInfosForTools[AnnotationToolEnum.BOUNDING_BOX].isDisabled ? 0.5 : 1,
              ...imgStyleForSpaceyIcons,
            }}
          />
        </RadioButtonWithTooltip>

        {hasSkeleton && hasVolume && isAgglomerateMappingEnabled.value ? (
          <RadioButtonWithTooltip
            title="Proofreading Tool - Modify an agglomerated segmentation. Other segmentation modifications, like brushing, are not allowed if this tool is used."
            disabledTitle={disabledInfosForTools[AnnotationToolEnum.PROOFREAD].explanation}
            disabled={disabledInfosForTools[AnnotationToolEnum.PROOFREAD].isDisabled}
            style={narrowButtonStyle}
            value={AnnotationToolEnum.PROOFREAD}
          >
            <i
              className="fas fa-clipboard-check"
              style={{
                opacity: disabledInfosForTools[AnnotationToolEnum.PROOFREAD].isDisabled ? 0.5 : 1,
              }}
            />
          </RadioButtonWithTooltip>
        ) : null}
      </Radio.Group>

      <ToolSpecificSettings
        hasSkeleton={hasSkeleton}
        adaptedActiveTool={adaptedActiveTool}
        hasVolume={hasVolume}
        isControlPressed={isControlPressed}
        isShiftPressed={isShiftPressed}
      />
    </>
  );
}

function ToolSpecificSettings({
  hasSkeleton,
  adaptedActiveTool,
  hasVolume,
  isControlPressed,
  isShiftPressed,
}: {
  hasSkeleton: boolean;
  adaptedActiveTool: AnnotationTool;
  hasVolume: boolean;
  isControlPressed: boolean;
  isShiftPressed: boolean;
}) {
  const showCreateTreeButton = hasSkeleton && adaptedActiveTool === AnnotationToolEnum.SKELETON;
  const showNewBoundingBoxButton = adaptedActiveTool === AnnotationToolEnum.BOUNDING_BOX;
  const showCreateCellButton = hasVolume && VolumeTools.includes(adaptedActiveTool);
  const showChangeBrushSizeButton =
    showCreateCellButton &&
    (adaptedActiveTool === AnnotationToolEnum.BRUSH ||
      adaptedActiveTool === AnnotationToolEnum.ERASE_BRUSH);
  const dispatch = useDispatch();
  const handleClearProofreading = () => dispatch(clearProofreadingByProducts());

  return (
    <>
      {showCreateTreeButton ? (
        <Space
          size={0}
          className="antd-legacy-group"
          style={{
            marginLeft: 10,
          }}
        >
          <CreateTreeButton />
          <AdditionalSkeletonModesButtons />
        </Space>
      ) : null}

      {showNewBoundingBoxButton ? (
        <Space
          size={0}
          className="antd-legacy-group"
          style={{
            marginLeft: 10,
          }}
        >
          <CreateNewBoundingBoxButton />
        </Space>
      ) : null}

      {showCreateCellButton || showChangeBrushSizeButton ? (
        <Space
          size={0}
          style={{
            marginLeft: 12,
          }}
          className="antd-legacy-group"
        >
          {showCreateCellButton ? <CreateCellButton /> : null}
          {showChangeBrushSizeButton ? <ChangeBrushSizeButton /> : null}
        </Space>
      ) : null}

      <OverwriteModeSwitch
        isControlPressed={isControlPressed}
        isShiftPressed={isShiftPressed}
        visible={ToolsWithOverwriteCapabilities.includes(adaptedActiveTool)}
      />

      {ToolsWithInterpolationCapabilities.includes(adaptedActiveTool) ? (
        <VolumeInterpolationButton />
      ) : null}

      {adaptedActiveTool === AnnotationToolEnum.FILL_CELL ? <FillModeSwitch /> : null}

      {adaptedActiveTool === AnnotationToolEnum.PROOFREAD ? (
        <ButtonComponent
          title="Clear auxiliary skeletons and meshes that were loaded while proofreading segments. Use this if you are done with correcting mergers or splits in a segment pair."
          onClick={handleClearProofreading}
          className="narrow"
          style={{ marginLeft: 12 }}
        >
          <ClearOutlined />
        </ButtonComponent>
      ) : null}
    </>
  );
}

const handleSetFillMode = (event: RadioChangeEvent) => {
  Store.dispatch(updateUserSettingAction("fillMode", event.target.value));
};

function FillModeSwitch() {
  const fillMode = useSelector((state: OxalisState) => state.userConfiguration.fillMode);
  return (
    <Radio.Group
      value={fillMode}
      onChange={handleSetFillMode}
      style={{
        marginLeft: 10,
      }}
    >
      <RadioButtonWithTooltip
        title="Only perform the Fill operation in the current plane."
        style={narrowButtonStyle}
        value={FillModeEnum._2D}
      >
        2D
      </RadioButtonWithTooltip>
      <RadioButtonWithTooltip
        title="Perform the Fill operation in 3D."
        style={narrowButtonStyle}
        value={FillModeEnum._3D}
      >
        3D
      </RadioButtonWithTooltip>
    </Radio.Group>
  );
}

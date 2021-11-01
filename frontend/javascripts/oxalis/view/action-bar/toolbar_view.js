// @flow
import { Radio, Tooltip, Badge, Space, Popover } from "antd";
import { useSelector, useDispatch } from "react-redux";
import React, { useEffect } from "react";

import Constants, {
  ToolsWithOverwriteCapabilities,
  type AnnotationTool,
  AnnotationToolEnum,
  type OverwriteMode,
  OverwriteModeEnum,
  FillModeEnum,
  VolumeTools,
} from "oxalis/constants";
import { convertCellIdToCSS } from "oxalis/view/left-border-tabs/mapping_settings_view";
import { document } from "libs/window";
import { enforceVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import {
  getMappingInfoForTracingLayer,
  getRenderableResolutionForSegmentationTracing,
} from "oxalis/model/accessors/dataset_accessor";
import { createCellAction } from "oxalis/model/actions/volumetracing_actions";
import { setToolAction } from "oxalis/model/actions/ui_actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { usePrevious, useKeyPress } from "libs/react_hooks";
import ButtonComponent from "oxalis/view/components/button_component";
import Model from "oxalis/model";
import Store from "oxalis/store";
import {
  getDisabledInfoForTools,
  adaptActiveToolToShortcuts,
} from "oxalis/model/accessors/tool_accessor";
import {
  createTreeAction,
  setMergerModeEnabledAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { addUserBoundingBoxAction } from "oxalis/model/actions/annotation_actions";
import { getActiveTree } from "oxalis/model/accessors/skeletontracing_accessor";
import { LogSliderSetting } from "oxalis/view/components/setting_input_views";
import { userSettings } from "types/schemas/user_settings.schema";
import { toNullable } from "libs/utils";

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

function getSkeletonToolHint(activeTool, isShiftPressed, isControlPressed, isAltPressed): ?string {
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

function toggleOverwriteMode(overwriteMode) {
  if (overwriteMode === OverwriteModeEnum.OVERWRITE_ALL) {
    return OverwriteModeEnum.OVERWRITE_EMPTY;
  } else {
    return OverwriteModeEnum.OVERWRITE_ALL;
  }
}

const handleUpdateBrushSize = (value: number) => {
  Store.dispatch(updateUserSettingAction("brushSize", value));
};

const handleSetTool = (event: { target: { value: AnnotationTool } }) => {
  Store.dispatch(setToolAction(event.target.value));
};

const handleCreateCell = () => {
  Store.dispatch(createCellAction());
};

const handleAddNewUserBoundingBox = () => {
  Store.dispatch(addUserBoundingBoxAction());
};

const handleSetOverwriteMode = (event: { target: { value: OverwriteMode } }) => {
  Store.dispatch(updateUserSettingAction("overwriteMode", event.target.value));
};

const RadioButtonWithTooltip = ({
  title,
  disabledTitle,
  disabled,
  ...props
}: {
  title: string,
  disabledTitle?: string,
  disabled?: boolean,
}) => (
  <Tooltip title={disabled ? disabledTitle : title}>
    {/* $FlowIgnore[cannot-spread-inexact] */}
    <Radio.Button disabled={disabled} {...props} />
  </Tooltip>
);

function OverwriteModeSwitch({ isControlPressed, isShiftPressed, visible }) {
  // Only CTRL should modify the overwrite mode. CTRL + Shift can be used to switch to the
  // erase tool, which should not affect the default overwrite mode.
  const overwriteMode = useSelector(state => state.userConfiguration.overwriteMode);
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
    <Radio.Group value={overwriteMode} onChange={handleSetOverwriteMode} style={{ marginLeft: 10 }}>
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

function AdditionalSkeletonModesButtons() {
  const dispatch = useDispatch();
  const isMergerModeEnabled = useSelector(
    state => state.temporaryConfiguration.isMergerModeEnabled,
  );
  const isNewNodeNewTreeModeOn = useSelector(state => state.userConfiguration.newNodeNewTree);
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
      <Tooltip title="Toggle the Single node Tree (soma clicking) mode - If enabled, each node creation will create a new tree.">
        <ButtonComponent
          style={newNodeNewTreeModeButtonStyle}
          value="active"
          onClick={toggleNewNodeNewTreeMode}
        >
          <img
            style={imgStyleForSpaceyIcons}
            src="/assets/images/soma-clicking-icon.svg"
            alt="Single Node Tree Mode"
          />
        </ButtonComponent>
      </Tooltip>
      <Tooltip title="Toggle Merger Mode - When enabled, skeletons that connect multiple segments will merge those segments.">
        <ButtonComponent style={mergerModeButtonStyle} value="active" onClick={toggleMergerMode}>
          <img
            style={imgStyleForSpaceyIcons}
            src="/assets/images/merger-mode-icon.svg"
            alt="Merger Mode"
          />
        </ButtonComponent>
      </Tooltip>
    </React.Fragment>
  );
}

const mapId = id => {
  const { cube } = Model.getEnforcedSegmentationTracingLayer();
  return cube.mapId(id);
};

function CreateCellButton() {
  const unmappedActiveCellId = useSelector(
    state => enforceVolumeTracing(state.tracing).activeCellId,
  );

  const mappingColors = useSelector(state => getMappingInfoForTracingLayer(state).mappingColors);
  const isMappingEnabled = useSelector(
    state => getMappingInfoForTracingLayer(state).isMappingEnabled,
  );
  const customColors = isMappingEnabled ? mappingColors : null;
  const activeCellId = isMappingEnabled ? mapId(unmappedActiveCellId) : unmappedActiveCellId;
  const activeCellColor = convertCellIdToCSS(activeCellId, customColors);
  const mappedIdInfo = isMappingEnabled ? ` (currently mapped to ${activeCellId})` : "";

  return (
    <Badge dot style={{ boxShadow: "none", background: activeCellColor }}>
      <Tooltip
        title={`Create a new Segment ID (C) – The active segment id is ${unmappedActiveCellId}${mappedIdInfo}.`}
      >
        <ButtonComponent onClick={handleCreateCell} style={{ width: 36, paddingLeft: 10 }}>
          <img src="/assets/images/new-cell.svg" alt="New Segment Icon" />
        </ButtonComponent>
      </Tooltip>
    </Badge>
  );
}

function CreateNewBoundingBoxButton() {
  return (
    <Tooltip title="Create a new bounding box centered around the current position.">
      <ButtonComponent
        onClick={handleAddNewUserBoundingBox}
        style={{ paddingLeft: 9, paddingRight: 9 }}
      >
        <img
          src="/assets/images/new-bounding-box.svg"
          alt="New Bounding Box Icon"
          style={imgStyleForSpaceyIcons}
        />
      </ButtonComponent>
    </Tooltip>
  );
}

function CreateTreeButton() {
  const dispatch = useDispatch();
  const activeTree = useSelector(state => toNullable(getActiveTree(state.tracing.skeleton)));
  const rgbColorString =
    activeTree != null
      ? `rgb(${activeTree.color.map(c => Math.round(c * 255)).join(",")})`
      : "transparent";

  const activeTreeHint =
    activeTree != null
      ? `The active tree id is ${activeTree.treeId}.`
      : "No tree is currently selected";

  const handleCreateTree = () => dispatch(createTreeAction());
  return (
    <Badge dot style={{ boxShadow: "none", background: rgbColorString, zIndex: 1000 }}>
      <Tooltip title={`Create a new Tree (C) – ${activeTreeHint}`}>
        <ButtonComponent
          onClick={handleCreateTree}
          style={{ ...narrowButtonStyle, paddingRight: 5 }}
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
      </Tooltip>
    </Badge>
  );
}

function ChangeBrushSizeButton() {
  const brushSize = useSelector(state => state.userConfiguration.brushSize);

  return (
    <Tooltip title="Change the brush size">
      <Popover
        content={
          <div style={{ width: 230 }}>
            <div style={{ marginBottom: 8 }}>Set the brush size:</div>
            <LogSliderSetting
              label=""
              roundTo={0}
              min={userSettings.brushSize.minimum}
              max={userSettings.brushSize.maximum}
              step={5}
              spans={[0, 14, 10]}
              value={brushSize}
              onChange={handleUpdateBrushSize}
            />
          </div>
        }
        trigger="click"
        placement="bottom"
        style={{ cursor: "pointer" }}
      >
        <ButtonComponent style={{ width: 36, padding: 0 }} value="active">
          <img
            src="/assets/images/brush-size-icon.svg"
            alt="Merger Mode"
            style={{ width: 20, height: 20 }}
          />
        </ButtonComponent>
      </Popover>
    </Tooltip>
  );
}

export default function ToolbarView() {
  const hasVolume = useSelector(state => state.tracing.volume != null);
  const hasSkeleton = useSelector(state => state.tracing.skeleton != null);
  const viewMode = useSelector(state => state.temporaryConfiguration.viewMode);
  const isVolumeSupported = hasVolume && !Constants.MODES_ARBITRARY.includes(viewMode);
  const useLegacyBindings = useSelector(state => state.userConfiguration.useLegacyBindings);

  const activeTool = useSelector(state => state.uiInformation.activeTool);

  const maybeResolutionWithZoomStep = useSelector(getRenderableResolutionForSegmentationTracing);
  const labeledResolution =
    maybeResolutionWithZoomStep != null ? maybeResolutionWithZoomStep.resolution : null;

  const hasResolutionWithHigherDimension = (labeledResolution || []).some(val => val > 1);

  const multiSliceAnnotationInfoIcon = hasResolutionWithHigherDimension ? (
    <Tooltip title="You are annotating in a low resolution. Depending on the used viewport, you might be annotating multiple slices at once.">
      <i className="fas fa-layer-group" style={{ marginLeft: 4 }} />
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
      Store.dispatch(setToolAction(AnnotationToolEnum.MOVE));
    }
  }, [activeTool, disabledInfoForCurrentTool]);

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
    <div
      onClick={() => {
        if (document.activeElement) document.activeElement.blur();
      }}
    >
      <Radio.Group onChange={handleSetTool} value={adaptedActiveTool}>
        <RadioButtonWithTooltip
          title={moveToolDescription}
          disabledTitle=""
          disabled={false}
          style={narrowButtonStyle}
          value={AnnotationToolEnum.MOVE}
        >
          <i style={{ paddingLeft: 4 }} className="fas fa-arrows-alt" />
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

        {isVolumeSupported ? (
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
            <RadioButtonWithTooltip
              title="Bounding Box Tool."
              disabled={false}
              style={narrowButtonStyle}
              value={AnnotationToolEnum.BOUNDING_BOX}
            >
              <img
                src="/assets/images/bounding-box.svg"
                alt="Bounding Box Icon"
                style={{
                  opacity: disabledInfosForTools[AnnotationToolEnum.BOUNDING_BOX].isDisabled
                    ? 0.5
                    : 1,
                  ...imgStyleForSpaceyIcons,
                }}
              />
            </RadioButtonWithTooltip>
          </React.Fragment>
        ) : null}
      </Radio.Group>

      <ToolSpecificSettings
        hasSkeleton={hasSkeleton}
        adaptedActiveTool={adaptedActiveTool}
        isVolumeSupported={isVolumeSupported}
        isControlPressed={isControlPressed}
        isShiftPressed={isShiftPressed}
      />
    </div>
  );
}

function ToolSpecificSettings({
  hasSkeleton,
  adaptedActiveTool,
  isVolumeSupported,
  isControlPressed,
  isShiftPressed,
}) {
  const showCreateTreeButton = hasSkeleton && adaptedActiveTool === AnnotationToolEnum.SKELETON;
  const showNewBoundingBoxButton = adaptedActiveTool === AnnotationToolEnum.BOUNDING_BOX;
  const showCreateCellButton = isVolumeSupported && VolumeTools.includes(adaptedActiveTool);
  const showChangeBrushSizeButton =
    showCreateCellButton &&
    (adaptedActiveTool === AnnotationToolEnum.BRUSH ||
      adaptedActiveTool === AnnotationToolEnum.ERASE_BRUSH);

  return (
    <>
      {showCreateTreeButton ? (
        <Space size={0} className="antd-legacy-group" style={{ marginLeft: 10 }}>
          <CreateTreeButton />
          <AdditionalSkeletonModesButtons />
        </Space>
      ) : null}

      {showNewBoundingBoxButton ? (
        <Space size={0} className="antd-legacy-group" style={{ marginLeft: 10 }}>
          <CreateNewBoundingBoxButton />
        </Space>
      ) : null}

      {showCreateCellButton || showChangeBrushSizeButton ? (
        <Space size={0} style={{ marginLeft: 12 }} className="antd-legacy-group">
          {showCreateCellButton ? <CreateCellButton /> : null}
          {showChangeBrushSizeButton ? <ChangeBrushSizeButton /> : null}
        </Space>
      ) : null}

      <OverwriteModeSwitch
        isControlPressed={isControlPressed}
        isShiftPressed={isShiftPressed}
        visible={ToolsWithOverwriteCapabilities.includes(adaptedActiveTool)}
      />

      {adaptedActiveTool === AnnotationToolEnum.FILL_CELL ? <FillModeSwitch /> : null}
    </>
  );
}

const handleSetFillMode = (event: { target: { value: OverwriteMode } }) => {
  Store.dispatch(updateUserSettingAction("fillMode", event.target.value));
};

function FillModeSwitch() {
  const fillMode = useSelector(state => state.userConfiguration.fillMode);

  return (
    <Radio.Group value={fillMode} onChange={handleSetFillMode} style={{ marginLeft: 10 }}>
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

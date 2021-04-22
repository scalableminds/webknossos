// @flow
import { Radio, Tooltip, Badge, Space } from "antd";
import { useSelector } from "react-redux";
import React, { useEffect } from "react";

import Constants, {
  ToolsWithOverwriteCapabilities,
  type AnnotationTool,
  AnnotationToolEnum,
  type OverwriteMode,
  OverwriteModeEnum,
} from "oxalis/constants";
import { convertCellIdToCSS } from "oxalis/view/right-menu/mapping_info_view";
import { document } from "libs/window";
import { enforceVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { getRenderableResolutionForSegmentation } from "oxalis/model/accessors/dataset_accessor";
import { createCellAction } from "oxalis/model/actions/volumetracing_actions";
import { setToolAction } from "oxalis/model/actions/ui_actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { usePrevious, useKeyPress } from "libs/react_hooks";
import ButtonComponent from "oxalis/view/components/button_component";
import Model from "oxalis/model";
import Store from "oxalis/store";
import { getDisabledInfoForTools } from "oxalis/model/accessors/tool_accessor";

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

function adaptActiveToolToShortcuts(
  activeTool,
  isShiftPressed,
  isControlPressed,
  isAltPressed,
): AnnotationTool {
  if (!isShiftPressed && !isControlPressed && !isAltPressed) {
    // No modifier is pressed
    return activeTool;
  }

  if (activeTool === AnnotationToolEnum.MOVE) {
    // The move tool does not have any modifier-related behavior currently.
    return activeTool;
  }

  if (activeTool === AnnotationToolEnum.SKELETON) {
    // The "skeleton" tool is not changed right now (since actions such as moving a node
    // don't have a dedicated tool). The only exception is "Alt" which switches to the move tool.
    if (isAltPressed) {
      return AnnotationToolEnum.MOVE;
    }
    return activeTool;
  }

  if (isShiftPressed && !isControlPressed && !isAltPressed) {
    // Only shift is pressed. Switch to the picker
    return AnnotationToolEnum.PICK_CELL;
  }

  if (isControlPressed && isShiftPressed && !isAltPressed) {
    // Control and shift invoke the fill cell tool
    return AnnotationToolEnum.FILL_CELL;
  }

  if (isAltPressed) {
    // Alt switches to the move tool
    return AnnotationToolEnum.MOVE;
  }

  return activeTool;
}

function toggleOverwriteMode(overwriteMode) {
  if (overwriteMode === OverwriteModeEnum.OVERWRITE_ALL) {
    return OverwriteModeEnum.OVERWRITE_EMPTY;
  } else {
    return OverwriteModeEnum.OVERWRITE_ALL;
  }
}

const narrowButtonStyle = {
  paddingLeft: 10,
  paddingRight: 8,
};

const handleSetTool = (event: { target: { value: AnnotationTool } }) => {
  Store.dispatch(setToolAction(event.target.value));
};

const handleCreateCell = () => {
  Store.dispatch(createCellAction());
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

function OverwriteModeSwitch({ isControlPressed }) {
  const overwriteMode = useSelector(state => state.userConfiguration.overwriteMode);
  const previousIsControlPressed = usePrevious(isControlPressed);
  const didControlChange =
    previousIsControlPressed != null && isControlPressed !== previousIsControlPressed;
  useEffect(() => {
    if (didControlChange) {
      Store.dispatch(updateUserSettingAction("overwriteMode", toggleOverwriteMode(overwriteMode)));
    }
  }, [didControlChange]);

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
        title="Only overwrite empty areas. In case of deleting (via right-click), only the current cell ID is overwritten. This setting can be toggled by holding CTRL."
        style={narrowButtonStyle}
        value={OverwriteModeEnum.OVERWRITE_EMPTY}
      >
        <img src="/assets/images/overwrite-empty.svg" alt="Overwrite Empty Icon" />
      </RadioButtonWithTooltip>
    </Radio.Group>
  );
}

const mapId = id => {
  const { cube } = Model.getSegmentationLayer();
  return cube.mapId(id);
};

function CreateCellButton() {
  const unmappedActiveCellId = useSelector(
    state => enforceVolumeTracing(state.tracing).activeCellId,
  );

  const mappingColors = useSelector(
    state => state.temporaryConfiguration.activeMapping.mappingColors,
  );
  const isMappingEnabled = useSelector(
    state => state.temporaryConfiguration.activeMapping.isMappingEnabled,
  );
  const customColors = isMappingEnabled ? mappingColors : null;
  const activeCellId = isMappingEnabled ? mapId(unmappedActiveCellId) : unmappedActiveCellId;
  const activeCellColor = convertCellIdToCSS(activeCellId, customColors);
  const mappedIdInfo = isMappingEnabled ? ` (currently mapped to ${activeCellId})` : "";

  return (
    <Badge dot style={{ boxShadow: "none", background: activeCellColor }}>
      <Tooltip
        title={`Create a new Cell ID – The active cell id is ${unmappedActiveCellId}${mappedIdInfo}.`}
      >
        <ButtonComponent onClick={handleCreateCell} style={{ width: 36, paddingLeft: 10 }}>
          <img src="/assets/images/new-cell.svg" alt="New Cell Icon" />
        </ButtonComponent>
      </Tooltip>
    </Badge>
  );
}

export default function ToolbarView() {
  const hasVolume = useSelector(state => state.tracing.volume != null);
  const hasSkeleton = useSelector(state => state.tracing.skeleton != null);
  const viewMode = useSelector(state => state.temporaryConfiguration.viewMode);
  const isVolumeSupported = hasVolume && !Constants.MODES_ARBITRARY.includes(viewMode);

  const activeTool = useSelector(state => state.uiInformation.activeTool);

  const maybeResolutionWithZoomStep = useSelector(getRenderableResolutionForSegmentation);
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

  const skeletonToolHint = hasSkeleton
    ? getSkeletonToolHint(activeTool, isShiftPressed, isControlPressed, isAltPressed)
    : null;
  const previousSkeletonToolHint = usePrevious(skeletonToolHint);

  const moveToolDescription =
    "Move – Use left-click to move around and right-click to open a contextmenu.";
  const skeletonToolDescription =
    "Skeleton – Use left-click to move around and right-click to create new skeleton nodes";

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
              {adaptedActiveTool === "BRUSH" ? multiSliceAnnotationInfoIcon : null}
            </RadioButtonWithTooltip>
            <RadioButtonWithTooltip
              title="Trace – Draw outlines around the voxel you would like to label."
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
              {adaptedActiveTool === "TRACE" ? multiSliceAnnotationInfoIcon : null}
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
              {adaptedActiveTool === "FILL_CELL" ? multiSliceAnnotationInfoIcon : null}
            </RadioButtonWithTooltip>
            <RadioButtonWithTooltip
              title="Cell Picker – Click on a voxel to make its cell id the active cell id."
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
      </Radio.Group>

      {ToolsWithOverwriteCapabilities.includes(adaptedActiveTool) ? (
        <OverwriteModeSwitch isControlPressed={isControlPressed} />
      ) : null}

      <Space size={0} style={{ marginLeft: 12 }}>
        {isVolumeSupported ? <CreateCellButton /> : null}
      </Space>
    </div>
  );
}

// @flow
import { Button, Radio, Tooltip, Badge } from "antd";
import { useSelector } from "react-redux";
import React, { useState, useEffect, useRef } from "react";
import memoizeOne from "memoize-one";

import {
  ToolsWithOverwriteCapabilities,
  type VolumeTool,
  VolumeToolEnum,
  type OverwriteMode,
  OverwriteModeEnum,
} from "oxalis/constants";
import { document } from "libs/window";
import { enforceVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import {
  setToolAction,
  createCellAction,
  setOverwriteModeAction,
} from "oxalis/model/actions/volumetracing_actions";
import ButtonComponent from "oxalis/view/components/button_component";
import Store from "oxalis/store";
import { convertCellIdToCSS } from "oxalis/view/right-menu/mapping_info_view";

// Source: https://gist.github.com/gragland/b61b8f46114edbcf2a9e4bd5eb9f47f5
export function useKeyPress(targetKey: string) {
  // State for keeping track of whether key is pressed
  const [keyPressed, setKeyPressed] = useState(false);

  // If pressed key is our target key then set to true
  function downHandler({ key }) {
    if (key === targetKey) {
      setKeyPressed(true);
    }
  }

  // If released key is our target key then set to false
  const upHandler = ({ key }) => {
    if (key === targetKey) {
      setKeyPressed(false);
    }
  };

  // Add event listeners
  useEffect(() => {
    window.addEventListener("keydown", downHandler);
    window.addEventListener("keyup", upHandler);
    // Remove event listeners on cleanup
    return () => {
      window.removeEventListener("keydown", downHandler);
      window.removeEventListener("keyup", upHandler);
    };
  }, []); // Empty array ensures that effect is only run on mount and unmount

  return keyPressed;
}

function adaptActiveToolToShortcuts(
  activeTool,
  isShiftPressed,
  isControlPressed,
  isAltPressed,
): VolumeTool {
  if (!isShiftPressed && !isControlPressed && !isAltPressed) {
    // No modifier is pressed
    return activeTool;
  }

  if (activeTool === VolumeToolEnum.MOVE) {
    // The "skeleton" tool is not changed right now (since actions such as moving a node
    // don't have a dedicated tool)
    return activeTool;
  }

  if (isShiftPressed && !isControlPressed && !isAltPressed) {
    // Only shift is pressed. Switch to the picker
    return VolumeToolEnum.PICK_CELL;
  }

  if (isControlPressed && isShiftPressed && !isAltPressed) {
    // Control and shift invoke the fill cell tool
    return VolumeToolEnum.FILL_CELL;
  }

  if (isAltPressed) {
    // Alt switches to the move tool
    return VolumeToolEnum.MOVE;
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

// Workaround until github.com/facebook/flow/issues/1113 is fixed
const RadioGroup = Radio.Group;
const RadioButton = Radio.Button;
const ButtonGroup = Button.Group;

const narrowButtonStyle = {
  paddingLeft: 10,
  width: 38,
};

const handleSetTool = (event: { target: { value: VolumeTool } }) => {
  Store.dispatch(setToolAction(event.target.value));
};

const handleCreateCell = () => {
  Store.dispatch(createCellAction());
};

const handleSetOverwriteMode = (event: { target: { value: OverwriteMode } }) => {
  Store.dispatch(setOverwriteModeAction(event.target.value));
};

function usePrevious(value) {
  // The ref object is a generic container whose current property is mutable ...
  // ... and can hold any value, similar to an instance property on a class
  const ref = useRef();

  // Store current value in ref
  useEffect(() => {
    ref.current = value;
  }, [value]); // Only re-run if value changes

  // Return previous value (happens before update in useEffect above)
  return ref.current;
}

const RadioButtonWithTooltip = ({
  title,
  disabledTitle,
  disabled,
  ...props
}: {
  title: string,
  disabledTitle?: string,
  disabled?: boolean,
}) => {
  return (
    <Tooltip title={disabled ? disabledTitle : title}>
      {/* $FlowIgnore[cannot-spread-inexact]*/}
      <RadioButton disabled={disabled} {...props} />
    </Tooltip>
  );
};

function OverwriteModeSwitch({ isControlPressed }) {
  const overwriteMode = useSelector(state => enforceVolumeTracing(state.tracing).overwriteMode);
  const previousIsControlPressed = usePrevious(isControlPressed);
  const didControlChange =
    previousIsControlPressed != null && isControlPressed !== previousIsControlPressed;
  useEffect(() => {
    if (didControlChange) {
      Store.dispatch(setOverwriteModeAction(toggleOverwriteMode(overwriteMode)));
    }
  }, [didControlChange]);

  return (
    <RadioGroup value={overwriteMode} onChange={handleSetOverwriteMode} style={{ marginLeft: 10 }}>
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
    </RadioGroup>
  );
}

export default function VolumeActionsView() {
  const hasSkeleton = useSelector(state => state.tracing.skeleton != null);
  const activeTool = useSelector(state => enforceVolumeTracing(state.tracing).activeTool);
  const activeCellId = useSelector(state => enforceVolumeTracing(state.tracing).activeCellId);
  const isMappingEnabled = useSelector(
    state => state.temporaryConfiguration.activeMapping.isMappingEnabled,
  );
  const isInMergerMode = useSelector(state => state.temporaryConfiguration.isMergerModeEnabled);
  const mappingColors = useSelector(
    state => state.temporaryConfiguration.activeMapping.mappingColors,
  );

  useEffect(() => {
    if (isInMergerMode) {
      Store.dispatch(setToolAction(VolumeToolEnum.MOVE));
    }
  }, [isInMergerMode, activeTool]);

  const isShiftPressed = useKeyPress("Shift");
  const isControlPressed = useKeyPress("Control");
  const isAltPressed = useKeyPress("Alt");

  const customColors = isMappingEnabled ? mappingColors : null;
  const activeCellColor = convertCellIdToCSS(activeCellId, customColors);

  const adaptedActiveTool = adaptActiveToolToShortcuts(
    activeTool,
    isShiftPressed,
    isControlPressed,
    isAltPressed,
  );

  const disabledVolumeExplanation =
    "Volume annotation is disabled while the merger mode is active.";

  const moveToolDescription = `Pointer – Use left-click to move around${
    hasSkeleton ? " and right-click to create new skeleton nodes" : ""
  }.`;

  return (
    <div
      onClick={() => {
        if (document.activeElement) document.activeElement.blur();
      }}
    >
      <RadioGroup onChange={handleSetTool} value={adaptedActiveTool}>
        <RadioButtonWithTooltip
          title={moveToolDescription}
          disabledTitle=""
          disabled={false}
          style={narrowButtonStyle}
          value={VolumeToolEnum.MOVE}
        >
          <i style={{ paddingLeft: 4 }} className="fas fa-mouse-pointer" />
        </RadioButtonWithTooltip>
        <RadioButtonWithTooltip
          title={"Trace – Draw outlines around the voxel you would like to label."}
          disabledTitle={disabledVolumeExplanation}
          disabled={isInMergerMode}
          style={narrowButtonStyle}
          value={VolumeToolEnum.TRACE}
        >
          <img
            src="/assets/images/lasso.svg"
            alt="Trace Tool Icon"
            style={{ opacity: isInMergerMode ? 0.5 : 1 }}
          />
        </RadioButtonWithTooltip>

        <RadioButtonWithTooltip
          title={
            "Brush – Draw over the voxels you would like to label. Adjust the brush size with Shift + Mousewheel."
          }
          disabledTitle={disabledVolumeExplanation}
          disabled={isInMergerMode}
          style={narrowButtonStyle}
          value={VolumeToolEnum.BRUSH}
        >
          <i className="fas fa-paint-brush" />
        </RadioButtonWithTooltip>
        <RadioButtonWithTooltip
          title="Fill Tool – Flood-fill the clicked region."
          disabledTitle={disabledVolumeExplanation}
          disabled={isInMergerMode}
          style={narrowButtonStyle}
          value={VolumeToolEnum.FILL_CELL}
        >
          <i className="fas fa-fill-drip" />
        </RadioButtonWithTooltip>
        <RadioButtonWithTooltip
          title="Cell Picker – Click on a voxel to make its cell id the active cell id."
          disabledTitle={disabledVolumeExplanation}
          disabled={isInMergerMode}
          style={narrowButtonStyle}
          value={VolumeToolEnum.PICK_CELL}
        >
          <i className="fas fa-eye-dropper" />
        </RadioButtonWithTooltip>
      </RadioGroup>

      {ToolsWithOverwriteCapabilities.includes(adaptedActiveTool) ? (
        <OverwriteModeSwitch isControlPressed={isControlPressed} />
      ) : null}

      <ButtonGroup style={{ marginLeft: 12 }}>
        <Badge dot style={{ boxShadow: "none", background: activeCellColor }}>
          <RadioButtonWithTooltip
            title="Create a new Cell ID"
            onClick={handleCreateCell}
            style={{ width: 36, paddingLeft: 10 }}
          >
            <img src="/assets/images/new-cell.svg" alt="New Cell Icon" />
          </RadioButtonWithTooltip>
        </Badge>
      </ButtonGroup>
    </div>
  );
}

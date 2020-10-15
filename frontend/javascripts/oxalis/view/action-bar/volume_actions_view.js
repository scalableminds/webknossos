// @flow
import { Button, Radio, Tooltip, Badge } from "antd";
import { useSelector } from "react-redux";
import React, { useState, useEffect } from "react";

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

function adaptActiveToolToShortcuts(activeTool, isShiftPressed, isControlPressed): VolumeTool {
  if (!isShiftPressed && !isControlPressed) {
    // No modifier is pressed
    return activeTool;
  }

  if (activeTool === VolumeToolEnum.MOVE) {
    // The "skeleton" tool is not changed right now (since actions such as moving a node
    // don't have a dedicated tool)
    return activeTool;
  }

  if (!isControlPressed) {
    // Only shift is pressed. Switch to the picker
    return VolumeToolEnum.PICK_CELL;
  }

  if (isControlPressed && isShiftPressed) {
    return VolumeToolEnum.FILL_CELL;
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

function OverwriteModeSwitch({ isControlPressed }) {
  const overwriteMode = useSelector(state => enforceVolumeTracing(state.tracing).overwriteMode);
  useEffect(() => {
    Store.dispatch(setOverwriteModeAction(toggleOverwriteMode(overwriteMode)));
  }, [isControlPressed]);

  return (
    <RadioGroup value={overwriteMode} onChange={handleSetOverwriteMode}>
      <RadioButton style={narrowButtonStyle} value={OverwriteModeEnum.OVERWRITE_ALL}>
        <img
          src="/assets/images/overwrite-all.svg"
          alt="Overwrite All Icon"
          title="Overwrite everything. This setting can be toggled by holding CTRL."
        />
      </RadioButton>
      <RadioButton style={narrowButtonStyle} value={OverwriteModeEnum.OVERWRITE_EMPTY}>
        <img
          src="/assets/images/overwrite-empty.svg"
          alt="Overwrite Empty Icon"
          title="Only overwrite empty areas. In case of deleting (via right-click), only the current cell ID is overwritten. This setting can be toggled by holding CTRL."
        />
      </RadioButton>
    </RadioGroup>
  );
}

export default function VolumeActionsView() {
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

  const customColors = isMappingEnabled ? mappingColors : null;
  const activeCellColor = convertCellIdToCSS(activeCellId, customColors);

  const adaptedActiveTool = adaptActiveToolToShortcuts(
    activeTool,
    isShiftPressed,
    isControlPressed,
  );

  return (
    <div
      onClick={() => {
        if (document.activeElement) document.activeElement.blur();
      }}
    >
      <RadioGroup onChange={handleSetTool} value={adaptedActiveTool} style={{ marginRight: 10 }}>
        <RadioButton style={narrowButtonStyle} value={VolumeToolEnum.MOVE}>
          <i style={{ paddingLeft: 4 }} className="fas fa-mouse-pointer" />
        </RadioButton>
        <Tooltip
          title={
            isInMergerMode ? "Volume annotation is disabled while the merger mode is active." : ""
          }
        >
          <RadioButton
            style={narrowButtonStyle}
            value={VolumeToolEnum.TRACE}
            disabled={isInMergerMode}
          >
            <img
              src="/assets/images/lasso.svg"
              alt="Trace Tool Icon"
              style={{ opacity: isInMergerMode ? 0.5 : 1 }}
            />
          </RadioButton>
          <RadioButton
            style={narrowButtonStyle}
            value={VolumeToolEnum.BRUSH}
            disabled={isInMergerMode}
          >
            <i className="fas fa-paint-brush" />
          </RadioButton>
          <RadioButton
            style={narrowButtonStyle}
            value={VolumeToolEnum.FILL_CELL}
            disabled={isInMergerMode}
          >
            <i className="fas fa-fill-drip" />
          </RadioButton>
          <RadioButton
            style={narrowButtonStyle}
            value={VolumeToolEnum.PICK_CELL}
            disabled={isInMergerMode}
          >
            <i className="fas fa-eye-dropper" />
          </RadioButton>
        </Tooltip>
      </RadioGroup>

      {ToolsWithOverwriteCapabilities.includes(adaptedActiveTool) ? (
        <OverwriteModeSwitch isControlPressed={isControlPressed} />
      ) : null}

      <ButtonGroup style={{ marginLeft: 12 }}>
        <Badge dot style={{ boxShadow: "none", background: activeCellColor }}>
          <ButtonComponent
            onClick={handleCreateCell}
            style={{ width: 36, paddingLeft: 10 }}
            title="Create a new Cell ID"
          >
            <img src="/assets/images/new-cell.svg" alt="New Cell Icon" />
          </ButtonComponent>
        </Badge>
      </ButtonGroup>
    </div>
  );
}

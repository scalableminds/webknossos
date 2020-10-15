// @flow
import { Button, Radio, Tooltip, Badge } from "antd";
import { useSelector } from "react-redux";
import React from "react";

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
import Store, { type OxalisState, type Mapping } from "oxalis/store";
import { convertCellIdToCSS } from "oxalis/view/right-menu/mapping_info_view";

import { useState, useEffect } from "react";

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

function adaptOverwriteModeToShortcut(overwriteMode, isControlPressed) {
  if (!isControlPressed) {
    return overwriteMode;
  }

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

type Props = {|
  activeTool: VolumeTool,
  isInMergerMode: boolean,
  activeCellId: number,
  isMappingEnabled: boolean,
  mapping: ?Mapping,
  mappingColors: ?Array<number>,
|};

const narrowButtonStyle = {
  paddingLeft: 10,
  width: 38,
};

// todo:
// const componentDidUpdate = (prevProps: Props) => {
//   if (!prevProps.isInMergerMode && isInMergerMode) {
//     Store.dispatch(setToolAction(VolumeToolEnum.MOVE));
//   }
// };

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
  const adaptedOverwriteMode = adaptOverwriteModeToShortcut(overwriteMode, isControlPressed);

  return (
    <RadioGroup value={adaptedOverwriteMode} onChange={handleSetOverwriteMode}>
      <RadioButton style={narrowButtonStyle} value={OverwriteModeEnum.OVERWRITE_ALL}>
        <svg
          style={{ verticalAlign: "middle" }}
          width="19"
          height="15"
          viewBox="0 0 24 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="7.75" cy="7.75" r="7.5" stroke="#C7C7C7" stroke-width="0.75" />
          <circle cx="16.25" cy="7.75" r="7.25" fill="#f1f1f1" stroke="#f1f1f1" />
        </svg>
      </RadioButton>
      <RadioButton style={narrowButtonStyle} value={OverwriteModeEnum.OVERWRITE_EMPTY}>
        <svg
          style={{ verticalAlign: "middle" }}
          width="19"
          height="15"
          viewBox="0 0 23 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="15.25" cy="7.75" r="7.25" fill="#f1f1f1" stroke="#f1f1f1" />
          <circle cx="7.75" cy="7.75" r="7.5" fill="#3A3D48" stroke="#C7C7C7" stroke-width="0.75" />
        </svg>
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
  const mapping = useSelector(state => state.temporaryConfiguration.activeMapping.mapping);
  const isInMergerMode = useSelector(state => state.temporaryConfiguration.isMergerModeEnabled);
  const mappingColors = useSelector(
    state => state.temporaryConfiguration.activeMapping.mappingColors,
  );

  const isShiftPressed = useKeyPress("Shift");
  const isControlPressed = useKeyPress("Control");

  const hasMapping = mapping != null;
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
            <svg
              style={{ verticalAlign: "middle" }}
              width="19"
              height="15"
              viewBox="0 0 21 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M20.25 6.68182C20.25 8.18159 19.2933 9.6466 17.522 10.7738C15.7595 11.8954 13.2789 12.6136 10.5 12.6136C7.72111 12.6136 5.2405 11.8954 3.47804 10.7738C1.70668 9.6466 0.75 8.18159 0.75 6.68182C0.75 5.18205 1.70668 3.71703 3.47804 2.58981C5.2405 1.46824 7.72111 0.75 10.5 0.75C13.2789 0.75 15.7595 1.46824 17.522 2.58981C19.2933 3.71703 20.25 5.18205 20.25 6.68182Z"
                stroke="#f1f1f1"
                stroke-width="2"
              />
              <circle cx="3.81821" cy="11.4545" r="1.15909" stroke="#f1f1f1" stroke-width="2" />
              <path
                d="M2.86362 10.5C3.40937 10.8536 8.46717 14.0983 7.48519 19.0909"
                stroke="#f1f1f1"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
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
          <ButtonComponent onClick={handleCreateCell} style={{ width: 36, paddingLeft: 10 }}>
            <svg
              style={{ verticalAlign: "middle" }}
              width="16"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M14.5402 10.5083C12.1152 14.9889 8.06642 16.4429 6.16263 15.8874C4.25884 15.3319 2.37908 13.2516 3.19622 11.143C4.01337 9.03438 7.94247 9.03438 8.50271 6.74256C9.06295 4.45074 10.3156 -0.669029 13.282 0.0727835C16.2484 0.814596 16.9651 6.02769 14.5402 10.5083Z"
                fill="#f1f1f1"
              />
              <path d="M0 4H6" stroke="#f1f1f1" stroke-width="1.5" />
              <path d="M3 7L2.95804 0.999991" stroke="#f1f1f1" stroke-width="1.5" />
            </svg>
          </ButtonComponent>
        </Badge>
      </ButtonGroup>
    </div>
  );
}

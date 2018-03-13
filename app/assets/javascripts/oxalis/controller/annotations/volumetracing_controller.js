/**
 * volumetracing_controller.js
 * @flow
 */

import { InputKeyboardNoLoop } from "libs/input";
import Store from "oxalis/store";
import {
  cycleToolAction,
  copySegmentationLayerAction,
  setActiveCellAction,
} from "oxalis/model/actions/volumetracing_actions";
import { getActiveCellId } from "oxalis/model/accessors/volumetracing_accessor";

class VolumeTracingController {
  // See comment in Controller class on general controller architecture.
  //
  // Volume Tracing Controller:
  // Add Volume Tracing controls that are not specific to the view mode.
  // Also, this would be the place to define general Volume Tracing
  // functions that can be called by the specific view mode controller.

  inDeleteMode: boolean;
  prevActiveCellId: number;
  keyboardNoLoop: InputKeyboardNoLoop;

  constructor() {
    this.inDeleteMode = false;

    // Keyboard shortcuts
    this.keyboardNoLoop = new InputKeyboardNoLoop({
      w: () => {
        Store.dispatch(cycleToolAction());
      },
      "1": () => {
        Store.dispatch(cycleToolAction());
      },
      v: () => {
        Store.dispatch(copySegmentationLayerAction());
      },
      "shift + v": () => {
        Store.dispatch(copySegmentationLayerAction(true));
      },
    });
  }

  handleCellSelection(cellId: number) {
    if (cellId > 0) {
      Store.dispatch(setActiveCellAction(cellId));
    }
  }

  enterDeleteMode() {
    if (this.inDeleteMode) {
      return;
    }

    this.inDeleteMode = true;

    getActiveCellId(Store.getState().tracing).map(activeCellId => {
      this.prevActiveCellId = activeCellId;
    });
    Store.dispatch(setActiveCellAction(0));
  }

  restoreAfterDeleteMode() {
    if (this.inDeleteMode) {
      Store.dispatch(setActiveCellAction(this.prevActiveCellId));
    }
    this.inDeleteMode = false;
  }
}

export default VolumeTracingController;

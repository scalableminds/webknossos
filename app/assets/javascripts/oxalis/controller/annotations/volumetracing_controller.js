/**
 * volumetracing_controller.js
 * @flow
 */

import _ from "lodash";
import BackboneEvents from "backbone-events-standalone";
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
  mergeMode: 0;
  prevActiveCellId: number;
  keyboardNoLoop: InputKeyboardNoLoop;

  MERGE_MODE_NORMAL = 0;

  constructor() {
    this.inDeleteMode = false;

    _.extend(this, BackboneEvents);

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

    this.mergeMode = this.MERGE_MODE_NORMAL;
  }

  handleCellSelection(cellId: number) {
    if (cellId > 0) {
      if (this.mergeMode === this.MERGE_MODE_NORMAL) {
        Store.dispatch(setActiveCellAction(cellId));
      }
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

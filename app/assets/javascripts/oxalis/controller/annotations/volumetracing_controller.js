/**
 * volumetracing_controller.js
 * @flow weak
 */

import _ from "lodash";
import $ from "jquery";
import Backbone from "backbone";
import { InputKeyboardNoLoop } from "libs/input";
import Model from "oxalis/model";
import Store from "oxalis/store";
import { toggleModeAction, setActiveCellAction } from "oxalis/model/actions/volumetracing_actions";
import { getActiveCellId } from "oxalis/model/accessors/volumetracing_accessor";
import VolumeTracingView from "oxalis/view/volumetracing_view";
import SceneController from "oxalis/controller/scene_controller";

class VolumeTracingController {
  // See comment in Controller class on general controller architecture.
  //
  // Volume Tracing Controller:
  // Add Volume Tracing controls that are not specific to the view mode.
  // Also, this would be the place to define general Volume Tracing
  // functions that can be called by the specific view mode controller.

  model: Model;
  volumeTracingView: VolumeTracingView;
  sceneController: SceneController;
  inDeleteMode: boolean;
  mergeMode: 0 | 1 | 2;
  prevActiveCell: ?number;
  keyboardNoLoop: InputKeyboardNoLoop;

  MERGE_MODE_NORMAL = 0;
  MERGE_MODE_CELL1 = 1;
  MERGE_MODE_CELL2 = 2;

  constructor(model, volumeTracingView, sceneController) {
    this.model = model;
    this.volumeTracingView = volumeTracingView;
    this.sceneController = sceneController;
    this.inDeleteMode = false;

    _.extend(this, Backbone.Events);

    // Keyboard shortcuts
    this.keyboardNoLoop = new InputKeyboardNoLoop({
      w: () => Store.dispatch(toggleModeAction()),
      "1": () => Store.dispatch(toggleModeAction()),
    });

    // no merging for now
    $("#btn-merge").hide();

    this.mergeMode = this.MERGE_MODE_NORMAL;
    const isMergeVisible = () => $("#merge").css("visibility") === "visible";

    $("#btn-merge").on("click", () => {
      $("#merge").css({
        visibility: isMergeVisible() ? "hidden" : "visible" });
      if (isMergeVisible()) {
        $("#merge-cell1").focus();
      }
    });

    const inputModeMapping = {
      "#merge-cell1": this.MERGE_MODE_CELL1,
      "#merge-cell2": this.MERGE_MODE_CELL2,
    };

    for (const input of Object.keys(inputModeMapping)) {
      ((inputId) => {
        $(inputId).on("focus", () => {
          this.mergeMode = inputModeMapping[inputId];
          console.log(this.mergeMode);
        });
        $(inputId).keypress((event) => {
          if (event.which === 13) {
            this.merge();
          }
        });
      })(input);
    }
  }


  merge() {
    const inputs = [$("#merge-cell1"), $("#merge-cell2")];
    $("#merge").css({ visibility: "hidden" });
    console.log("Merge:", $("#merge-cell1").val(), $("#merge-cell2").val());

    for (const input of inputs) {
      input.blur();
      input.val("");
    }
  }


  handleCellSelection(cellId) {
    if (cellId > 0) {
      if (this.mergeMode === this.MERGE_MODE_NORMAL) {
        Store.dispatch(setActiveCellAction(cellId));
      } else if (this.mergeMode === this.MERGE_MODE_CELL1) {
        $("#merge-cell1").val(cellId);
        $("#merge-cell2").focus();
      } else if (this.mergeMode === this.MERGE_MODE_CELL2) {
        $("#merge-cell2").val(cellId);
        this.merge();
      }
    }
  }


  enterDeleteMode() {
    if (this.inDeleteMode) { return; }

    this.inDeleteMode = true;

    this.prevActiveCell = getActiveCellId(Store.getState().tracing).getOrElse(null);
    Store.dispatch(setActiveCellAction(0));
  }


  restoreAfterDeleteMode() {
    if (this.inDeleteMode) {
      Store.dispatch(setActiveCellAction(this.prevActiveCell));
    }
    this.inDeleteMode = false;
  }


  drawVolume(pos) {
    this.model.volumeTracing.addToLayer(pos);
  }
}

export default VolumeTracingController;

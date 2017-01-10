import _ from "lodash";
import $ from "jquery";
import Backbone from "backbone";
import Input from "libs/input";

class VolumeTracingController {
  static initClass() {
    // See comment in Controller class on general controller architecture.
    //
    // Volume Tracing Controller:
    // Add Volume Tracing controls that are not specific to the view mode.
    // Also, this would be the place to define general Volume Tracing
    // functions that can be called by the specific view mode controller.


    this.prototype.MERGE_MODE_NORMAL = 0;
    this.prototype.MERGE_MODE_CELL1 = 1;
    this.prototype.MERGE_MODE_CELL2 = 2;
  }

  constructor(model, volumeTracingView, sceneController) {
    this.model = model;
    this.volumeTracingView = volumeTracingView;
    this.sceneController = sceneController;
    this.inDeleteMode = false;

    _.extend(this, Backbone.Events);

    $("#create-cell-button").on("click", () => this.model.volumeTracing.createCell(),
    );

    // Keyboard shortcuts
    this.keyboardNoLoop = new Input.KeyboardNoLoop({
      w: () => this.model.volumeTracing.toggleMode(),
      1: () => this.model.volumeTracing.toggleMode(),
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

    for (const input in inputModeMapping) {
      ((input) => {
        $(input).on("focus", () => {
          this.mergeMode = inputModeMapping[input];
          console.log(this.mergeMode);
        },
        );
        return $(input).keypress((event) => {
          if (event.which === 13) {
            return this.merge();
          }
        },
        );
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
        return this.model.volumeTracing.setActiveCell(cellId);
      } else if (this.mergeMode === this.MERGE_MODE_CELL1) {
        $("#merge-cell1").val(cellId);
        return $("#merge-cell2").focus();
      } else if (this.mergeMode === this.MERGE_MODE_CELL2) {
        $("#merge-cell2").val(cellId);
        return this.merge();
      }
    }
  }


  enterDeleteMode() {
    if (this.inDeleteMode) { return; }

    this.inDeleteMode = true;

    this.prevActiveCell = this.model.volumeTracing.getActiveCellId();
    this.model.volumeTracing.setActiveCell(0);
  }


  restoreAfterDeleteMode() {
    if (this.inDeleteMode) {
      this.model.volumeTracing.setActiveCell(this.prevActiveCell);
    }
    this.inDeleteMode = false;
  }


  drawVolume(pos) {
    return this.model.volumeTracing.addToLayer(pos);
  }
}
VolumeTracingController.initClass();

export default VolumeTracingController;

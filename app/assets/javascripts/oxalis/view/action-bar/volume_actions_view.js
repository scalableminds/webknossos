import _ from "lodash";
import Marionette from "backbone.marionette";
import Constants from "oxalis/constants";

class VolumeActionsView extends Marionette.View {
  static initClass() {
  
    this.prototype.template  = _.template(`\
<div class="btn-group">
  <button
    type="button"
    class="btn btn-default <% if (isMoveMode) { %> btn-primary <% } %>"
    id="mode-move">
      Move
  </button>
  <button
    type="button"
    class="btn btn-default <% if (!isMoveMode) { %> btn-primary <% } %>"
    id="mode-trace">
      Trace
  </button>
</div>
<div class="btn-group">
  <button type="button" class="btn btn-default" id="create-cell">Create new cell (C)</button>
</div>\
`);
  
    this.prototype.modeMapping  = {
      "mode-trace" : Constants.VOLUME_MODE_TRACE,
      "mode-move" : Constants.VOLUME_MODE_MOVE
    };
  
    this.prototype.events  = {
      "click [id^=mode]" : "changeMode",
      "click #create-cell" : "createCell"
    };
  }


  initialize(options) {

    return this.listenTo(this.model.volumeTracing, "change:mode", this.render);
  }


  createCell() {

    return this.model.volumeTracing.createCell();
  }


  changeMode(evt) {

    const mode = this.modeMapping[evt.target.id];
    return this.model.volumeTracing.setMode(mode);
  }


  serializeData() {

    return {
      isMoveMode : this.model.volumeTracing.mode === Constants.VOLUME_MODE_MOVE
    };
  }
}
VolumeActionsView.initClass();


export default VolumeActionsView;

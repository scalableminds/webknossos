import Marionette from "backbone.marionette";
import app from "app";
import constants from "oxalis/constants";

class ViewModesView extends Marionette.View {
  static initClass() {
  
    this.prototype.template  = _.template(`\
<div class="btn-group btn-group">
  <div class="btn-group">
    <button type="button" class="btn btn-default" id="mode-3planes">Orthogonal</button>
  </div>
  <div class="btn-group">
    <button type="button" class="btn btn-default" id="mode-sphere">Flight</button>
  </div>
  <div class="btn-group">
    <button type="button" class="btn btn-default" id="mode-arbitraryplane">Oblique</button>
  </div>
</div>\
`);
  
    this.prototype.modeMapping  = {
      "mode-3planes" : constants.MODE_PLANE_TRACING,
      "mode-sphere" : constants.MODE_ARBITRARY,
      "mode-arbitraryplane" : constants.MODE_ARBITRARY_PLANE
    };
  
    this.prototype.events  =
      {"click button" : "changeMode"};
  }


  initialize(options) {

    this.listenTo(this.model, "change:mode", this.updateForMode);
    return this.listenTo(this, "attach", this.afterAttach);
  }


  afterAttach() {
    for (let mode in this.modeMapping) {
      const modeValue = this.modeMapping[mode];
      $(`#${mode}`).attr("disabled", !this.model.get("allowedModes").includes(modeValue));
    }

    this.updateForMode(this.model.get("mode"));
  }


  changeMode(evt) {

    evt.target.blur();
    const mode = this.modeMapping[evt.target.id];
    return this.model.setMode(mode);
  }


  updateForMode(mode) {

    this.$("button").removeClass("btn-primary");

    const buttonId = _.invert(this.modeMapping)[mode];
    return this.$(`#${buttonId}`).addClass("btn-primary");
  }
}
ViewModesView.initClass();

export default ViewModesView;

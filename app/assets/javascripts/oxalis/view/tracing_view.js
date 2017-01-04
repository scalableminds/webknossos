import _ from "lodash";
import Marionette from "backbone.marionette";
import Constants from "../constants";

class TracingView extends Marionette.View {
  static initClass() {
    this.prototype.id = "render";
    this.prototype.template = _.template(`\
<div id="modal" class="modal fade" tabindex="-1" role="dialog"></div>
<div id="inputcatchers">
  <div id="planexy" class="inputcatcher"></div>
  <div id="planeyz" class="inputcatcher"></div>
  <div id="planexz" class="inputcatcher"></div>
  <div id="TDView" class="inputcatcher">
    <div id="TDViewControls" class="btn-group">
      <button type="button" class="btn btn-default btn-sm">3D</button>
      <button type="button" class="btn btn-default btn-sm">
        <span></span>XY
      </button>
      <button type="button" class="btn btn-default btn-sm">
        <span></span>YZ
      </button>
      <button type="button" class="btn btn-default btn-sm">
        <span></span>XZ
      </button>
    </div>
  </div>
</div>\
`);

    this.prototype.events =
      { contextmenu: "disableContextMenu" };

    this.prototype.ui =
      { inputcatchers: ".inputcatcher" };
  }

  initialize() {
    return this.listenTo(this.model.flycam, "zoomStepChanged", function () {
      return this.$el.toggleClass("zoomstep-warning",
        (this.model.volumeTracing != null) && !this.model.canDisplaySegmentationData());
    });
  }


  disableContextMenu(event) {
    // hide contextmenu, while rightclicking a canvas
    event.preventDefault();
  }


  onRender() {
    // Hide the input catchers arbitrary model
    if (Constants.MODES_ARBITRARY.includes(this.model.get("mode"))) {
      return this.ui.inputcatchers.hide();
    }
  }
}
TracingView.initClass();

export default TracingView;

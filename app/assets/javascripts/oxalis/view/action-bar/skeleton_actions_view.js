import _ from "lodash";
import Marionette from "backbone.marionette";
import Constants from "oxalis/constants";
import Store from "oxalis/store";

class SkeletonActionsView extends Marionette.View {
  static initClass() {
    this.prototype.template = _.template(`\
      <% if(isTracingMode()) { %>
        <div class="btn-group">
<button type="button" class="btn btn-default" id="add-node">Add Node (Right-Click) </button>
        </div>
      <% } %>\
`);

    this.prototype.templateContext = {
      isTracingMode() {
        return this.mode === Constants.MODE_PLANE_TRACING;
      },
    };

    this.prototype.events =
      { "click #add-node": "addNode" };
  }

  initialize() {
    this.listenTo(this.model, "change:mode", this.render);
  }


  addNode() {
    const datasetConfig = Store.getState().datasetConfiguration;

    // add node
    return this.model.skeletonTracing.addNode(
      this.model.flycam.getPosition(),
      this.model.flycam.getRotation(Constants.PLANE_XY),
      Constants.PLANE_XY, // xy viewport
      this.model.flycam.getIntegerZoomStep(),
      datasetConfig.fourBit ? 4 : 8,
      datasetConfig.interpolation,
    );
  }
}
SkeletonActionsView.initClass();

export default SkeletonActionsView;

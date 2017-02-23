import _ from "lodash";
import Marionette from "backbone.marionette";
import Constants from "oxalis/constants";
import Store from "oxalis/store";
import { createNodeAction } from "oxalis/model/actions/skeletontracing_actions";

class SkeletonActionsView extends Marionette.View {
  template = _.template(`\
    <% if(isTracingMode()) { %>
      <div class="btn-group">
<button type="button" class="btn btn-default" id="add-node">Add Node (Right-Click) </button>
      </div>
    <% } %>\
`);

  templateContext = {
    isTracingMode() {
      return this.mode === Constants.MODE_PLANE_TRACING;
    },
  };

  events = {
    "click #add-node": "addNode",
  };

  initialize() {
    this.listenTo(this.model, "change:mode", this.render);
  }


  addNode() {
    // add node
    Store.dispatch(createNodeAction(
      this.model.flycam.getPosition(),
      this.model.flycam.getRotation(Constants.PLANE_XY),
      Constants.PLANE_XY, // xy viewport
      this.model.flycam.getIntegerZoomStep(),
    ));
  }
}

export default SkeletonActionsView;

// @flow weak
import _ from "lodash";
import Marionette from "backbone.marionette";
import Constants, { OrthoViews } from "oxalis/constants";
import Store from "oxalis/store";
import { createNodeAction } from "oxalis/model/actions/skeletontracing_actions";
import { getPosition, getRotationOrtho, getIntegerZoomStep } from "oxalis/model/accessors/flycam_accessor";

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

    this.prototype.events = {
      "click #add-node": "addNode",
    };
  }

  initialize() {
    this.listenTo(this.model, "change:mode", this.render);
  }


  addNode() {
    // add node
    Store.dispatch(createNodeAction(
      getPosition(Store.getState().flycam),
      getRotationOrtho(OrthoViews.PLANE_XY),
      0, // legacy for OrthoViews.PLANE_XY
      getIntegerZoomStep(Store.getState()),
    ));
  }
}
SkeletonActionsView.initClass();

export default SkeletonActionsView;

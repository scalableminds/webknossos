import _ from "lodash";
import Marionette from "backbone.marionette";
import DatasetActionsView from "./action-bar/dataset_actions_view";
import DatasetPositionView from "./action-bar/dataset_position_view";
import ViewModesView from "./action-bar/view_modes_view";
import VolumeActionsView from "./action-bar/volume_actions_view";
import SkeletonActionsView from "./action-bar/skeleton_actions_view";
import Constants from "../constants";

class ActionBarView extends Marionette.View {
  static initClass() {
  
    this.prototype.className  = "container-fluid";
  
    this.prototype.template  = _.template(`\
  
<% if (isTraceMode && hasAdvancedOptions) { %>
  <a href="#" id="menu-toggle-button" class="btn btn-default"
    data-toggle="offcanvas"
    data-target="#settings-menu-wrapper"
    data-canvas="#sliding-canvas"
    data-placement="left"
    data-autohide="false"
    data-disable-scrolling="false"><i class="fa fa-bars"></i>Menu</a>
<% } %>
  
<% if (isTraceMode) { %>
  <div id="dataset-actions"></div>
<% } %>
  
<% if (hasAdvancedOptions) { %>
  <div id="dataset-position"></div>
<% } %>
  
<% if (isVolumeMode && hasAdvancedOptions) { %>
  <div id="volume-actions"></div>
<% } %>
  
<% if (isTraceMode && hasAdvancedOptions) { %>
  <div id="view-modes"></div>
  <div id="skeleton-actions"></div>
<% } %>\
`);
  
  
    this.prototype.regions  = {
      "datasetActionButtons" : "#dataset-actions",
      "datasetPosition" : "#dataset-position",
      "viewModes" : "#view-modes",
      "volumeActions" : "#volume-actions",
      "skeletonActions" : "#skeleton-actions"
    };
  }

  templateContext() {

    return {
      isTraceMode : this.isTraceMode(),
      isVolumeMode : this.isVolumeMode(),
      hasAdvancedOptions : this.hasAdvancedOptions()
    };
  }


  initialize(options) {

    this.datasetPositionView = new DatasetPositionView(options);

    if (this.isTraceMode()) {
      this.datasetActionsView = new DatasetActionsView(options);

      if (this.isVolumeMode()) {
        this.volumeActionsView = new VolumeActionsView(options);
      } else {
        this.viewModesView = new ViewModesView(options);
        this.skeletonActionsView = new SkeletonActionsView(options);
      }
    }


    return this.listenTo(this, "render", this.afterRender);
  }


  afterRender() {

    if (this.hasAdvancedOptions()) {
      this.showChildView("datasetPosition", this.datasetPositionView);
    }

    if (this.isTraceMode()) {
      this.showChildView("datasetActionButtons", this.datasetActionsView);

      if (this.hasAdvancedOptions()) {
        if (this.isVolumeMode()) {
          return this.showChildView("volumeActions", this.volumeActionsView);
        } else {
          this.showChildView("viewModes", this.viewModesView);
          return this.showChildView("skeletonActions", this.skeletonActionsView);
        }
      }
    }
  }


  isTraceMode() {

    return this.model.get("controlMode") === Constants.CONTROL_MODE_TRACE;
  }


  isVolumeMode() {

    return this.model.get("mode") === Constants.MODE_VOLUME;
  }


  hasAdvancedOptions() {

    return this.model.settings.advancedOptionsAllowed;
  }
}
ActionBarView.initClass();


export default ActionBarView;

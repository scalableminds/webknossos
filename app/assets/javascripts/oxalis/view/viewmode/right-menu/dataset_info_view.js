/**
 * dataset_info_view.js
 * @flow weak
 */

import _ from "lodash";
import Marionette from "backbone.marionette";
import Store from "oxalis/store";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import constants from "oxalis/constants";
import ArbitraryController from "oxalis/controller/viewmodes/arbitrary_controller";
import { getPlaneScalingFactor } from "oxalis/model/accessors/flycam_accessor";

class DatasetInfoView extends Marionette.View {
  static initClass() {
    this.prototype.className = "col-sm-12 flex-column";
    this.prototype.id = "dataset";
    this.prototype.template = _.template(`\
<div class="well">
  <p><%- annotationType %></p>
  <p>DataSet: <%- dataSetName %></p>
  <p>Viewport width: <%- chooseUnit(zoomLevel) %></p>
  <% if(treeCount != null) { %>
    <p>Total number of trees: <%- treeCount %></p>
  <% } %>
  <% if (isPublicViewMode) { %>
    <table class="table table-condensed table-nohead table-bordered">
      <tbody>
        <tr><th colspan="2">Controls</th></tr>
        <tr><td>I,O or Alt + Mousewheel</td><td>Zoom in/out</td></tr>
        <tr><td>Mousewheel or D and F</td><td>Move along 3rd axis</td></tr>
        <tr><td>Left Mouse drag or Arrow keys</td><td>Move</td></tr>
        <tr><td>Right click drag in 3D View</td><td>Rotate 3D View</td></tr>
        <tr><td>K,L</td><td>Scale up/down viewports</td></tr>
      </tbody>
    </table>
    <div>
      <img class="img-50" src="/assets/images/Max-Planck-Gesellschaft.svg" alt="Max Plank Geselleschaft Logo" />
      <img class="img-50" src="/assets/images/MPI-brain-research.svg" alt="Max Plank Institute of Brain Research Logo" />
    </div>
  <% } %>

</div>\
`);

    this.prototype.templateContext = {
      chooseUnit() {
        if (this.zoomLevel < 1000) {
          return `${this.zoomLevel.toFixed(0)} nm`;
        } else if (this.zoomLevel < 1000000) {
          return `${(this.zoomLevel / 1000).toFixed(1)} μm`;
        } else {
          return `${(this.zoomLevel / 1000000).toFixed(1)} mm`;
        }
      },
    };
  }

  _unsubscribe = _.noop;

  initialize() {
    if (Store.getState().skeletonTracing) {
      this._unsubscribe = Store.subscribe(() => this.render());
    }
  }

  render = _.throttle(this.render, 100);


  // Rendering performance optimization
  attachElContent(html) {
    this.el.innerHTML = html;
    return html;
  }


  serializeData() {
    let annotationType = this.model.get("tracingType");
    const tracing = this.model.get("tracing");
    const { task } = tracing;
    const { name } = tracing;

    // In case we have a task display its id as well
    if (task) { annotationType += `: ${task.id}`; }
    // Or display an explorative tracings name if there is one
    if (name) { annotationType += `: ${name}`; }

    const dataset = Store.getState().dataset;

    return {
      annotationType,
      zoomLevel: this.calculateZoomLevel(),
      dataSetName: dataset != null ? dataset.name : "",
      treeCount: _.size(Store.getState().skeletonTracing.trees),
      isPublicViewMode: this.model.get("controlMode") === constants.CONTROL_MODE_VIEW,
    };
  }


  calculateZoomLevel() {
    let width;
    let zoom;
    const state = Store.getState();
    if (constants.MODES_PLANE.includes(this.model.mode)) {
      zoom = getPlaneScalingFactor(Store.getState().flycam);
      width = constants.PLANE_WIDTH;
    } else if (constants.MODES_ARBITRARY.includes(this.model.mode)) {
      zoom = state.flycam.zoomStep;
      width = ArbitraryController.prototype.WIDTH;
    } else {
      throw Error("Model mode not recognized:", this.model.mode);
    }

    // unit is nm
    const baseVoxel = getBaseVoxel(state.dataset.scale);
    return zoom * width * baseVoxel;
  }


  onDestroy() {
    this._unsubscribe();
  }
}
DatasetInfoView.initClass();

export default DatasetInfoView;

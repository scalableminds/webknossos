/**
 * dataset_info_view.js
 * @flow weak
 */

import _ from "lodash";
import Marionette from "backbone.marionette";
import Store from "oxalis/store";
import scaleInfo from "oxalis/model/scaleinfo";
import constants from "oxalis/constants";
import ArbitraryController from "oxalis/controller/viewmodes/arbitrary_controller";

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


  initialize() {
    this.listenTo(this.model.flycam3d, "changed", this.render);
    this.listenTo(this.model.flycam, "zoomStepChanged", this.render);

    if (Store.getState().skeletonTracing) {
      Store.subscribe(() => this.render());
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
    };
  }


  calculateZoomLevel() {
    let width;
    let zoom;
    if (constants.MODES_PLANE.includes(this.model.mode)) {
      zoom = this.model.flycam.getPlaneScalingFactor();
      width = constants.PLANE_WIDTH;
    } else if (constants.MODES_ARBITRARY.includes(this.model.mode)) {
      zoom = this.model.flycam3d.zoomStep;
      width = ArbitraryController.prototype.WIDTH;
    } else {
      throw Error("Model mode not recognized:", this.model.mode);
    }

    // unit is nm
    return zoom * width * scaleInfo.baseVoxel;
  }


  onDestroy() {
    this.model.flycam3d.off("changed");
    this.model.flycam.off("zoomStepChanged");
  }
}
DatasetInfoView.initClass();

export default DatasetInfoView;

import _ from "lodash";
import Marionette from "backbone.marionette";
import app from "app";
import constants from "oxalis/constants";
import ArbitraryController from "oxalis/controller/viewmodes/arbitrary_controller";

class DatasetInfoView extends Marionette.View {
  static initClass() {

    this.prototype.className  = "col-sm-12 flex-column";
    this.prototype.id  = "dataset";
    this.prototype.template  = _.template(`\
<div class="well">
  <p><%- annotationType %></p>
  <p>DataSet: <%- dataSetName %></p>
  <p>Viewport width: <%- chooseUnit(zoomLevel) %></p>
  <% if(treeCount != null) { %>
    <p>Total number of trees: <%- treeCount %></p>
  <% } %>
</div>\
`);

    this.prototype.templateContext  = {
      chooseUnit() {
        if(this.zoomLevel < 1000) {
          return this.zoomLevel.toFixed(0) + " nm";
        } else if (this.zoomLevel < 1000000) {
          return (this.zoomLevel / 1000).toFixed(1) + " μm";
        } else {
          return (this.zoomLevel / 1000000).toFixed(1) + " mm";
        }
      }
    };
  }


  initialize(options) {

    this.render = _.throttle(this.render, 100);
    this.listenTo(this.model.flycam3d, "changed", this.render);
    this.listenTo(this.model.flycam, "zoomStepChanged", this.render);

    if (this.model.skeletonTracing) {
      this.listenTo(this.model.skeletonTracing, "deleteTree", this.render);
      this.listenTo(this.model.skeletonTracing, "mergeTree", this.render);
      return this.listenTo(this.model.skeletonTracing, "newTree", this.render);
    }
  }


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

    return {
      annotationType,
      zoomLevel : this.calculateZoomLevel(),
      dataSetName : this.model.get("dataset").get("name"),
      treeCount : __guard__(this.model.skeletonTracing, x => x.trees.length)
    };
  }


  calculateZoomLevel() {

    let width, zoom;
    if (constants.MODES_PLANE.includes(this.model.mode)) {
      zoom  = this.model.flycam.getPlaneScalingFactor();
      width = constants.PLANE_WIDTH;
    }

    if (constants.MODES_ARBITRARY.includes(this.model.mode)) {
      zoom  = this.model.flycam3d.zoomStep;
      width = ArbitraryController.prototype.WIDTH;
    }

    // unit is nm
    return zoom * width * app.scaleInfo.baseVoxel;
  }


  onDestroy() {

    this.model.flycam3d.off("changed");
    return this.model.flycam.off("zoomStepChanged");
  }
}
DatasetInfoView.initClass();

export default DatasetInfoView;

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}

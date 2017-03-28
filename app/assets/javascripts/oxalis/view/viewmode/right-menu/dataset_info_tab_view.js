/**
 * dataset_info_view.js
 * @flow
 */
import React, { Component } from "react";
import { connect } from "react-redux";
import _ from "lodash";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import constants from "oxalis/constants";
import ArbitraryController from "oxalis/controller/viewmodes/arbitrary_controller";
import { getPlaneScalingFactor } from "oxalis/model/accessors/flycam_accessor";
import type { OxalisState, SkeletonTracingType, DatasetType, FlycamType } from "oxalis/store";
import type Model from "oxalis/model";

type DatasetInfoTabProps = {
  oldModel: Model,
  skeletonTracing: SkeletonTracingType,
  dataset: DatasetType,
  flycam: FlycamType,
};

class DatasetInfoTabView extends Component {
  props: DatasetInfoTabProps;

  calculateZoomLevel(): number {
    let width;
    let zoom;
    if (constants.MODES_PLANE.includes(this.props.oldModel.mode)) {
      zoom = getPlaneScalingFactor(this.props.flycam);
      width = constants.PLANE_WIDTH;
    } else if (constants.MODES_ARBITRARY.includes(this.props.oldModel.mode)) {
      zoom = this.props.flycam.zoomStep;
      width = ArbitraryController.prototype.WIDTH;
    } else {
      throw Error("Model mode not recognized:", this.props.oldModel.mode);
    }
    // unit is nm
    const baseVoxel = getBaseVoxel(this.props.dataset.scale);
    return zoom * width * baseVoxel;
  }

  chooseUnit(zoomLevel: number): string {
    if (zoomLevel < 1000) {
      return `${zoomLevel.toFixed(0)} nm`;
    } else if (zoomLevel < 1000000) {
      return `${(zoomLevel / 1000).toFixed(1)} μm`;
    } else {
      return `${(zoomLevel / 1000000).toFixed(1)} mm`;
    }
  }

  render() {
    let annotationType = this.props.oldModel.get("tracingType");
    const tracing = this.props.oldModel.get("tracing");
    const { task, name } = tracing;

    // In case we have a task display its id as well
    if (task) { annotationType += `: ${task.id}`; }
    // Or display an explorative tracings name if there is one
    if (name) { annotationType += `: ${name}`; }

    const zoomLevel = this.calculateZoomLevel();
    const dataSetName = this.props.dataset.name;
    const treeCount = _.size(this.props.skeletonTracing.trees);
    const isPublicViewMode = this.props.oldModel.get("controlMode") === constants.CONTROL_MODE_VIEW;

    return (
      <div id="dataset" className="col-sm-12 flex-column">
        <div className="well">
          <p>{annotationType}</p>
          <p>DataSet: {dataSetName}</p>
          <p>Viewport width: {this.chooseUnit(zoomLevel)}</p>
          {
            (treeCount != null) ?
              <p>Total number of trees: {treeCount}</p> :
              null
          }
          {
            isPublicViewMode ?
              <div>
                <table className="table table-condensed table-nohead table-bordered">
                  <tbody>
                    <tr><th colSpan="2">Controls</th></tr>
                    <tr><td>I,O or Alt + Mousewheel</td><td>Zoom in/out</td></tr>
                    <tr><td>Mousewheel or D and F</td><td>Move along 3rd axis</td></tr>
                    <tr><td>Left Mouse drag or Arrow keys</td><td>Move</td></tr>
                    <tr><td>Right click drag in 3D View</td><td>Rotate 3D View</td></tr>
                    <tr><td>K,L</td><td>Scale up/down viewports</td></tr>
                  </tbody>
                </table>
                <div>
                  <img className="img-50" src="/assets/images/Max-Planck-Gesellschaft.svg" alt="Max Plank Geselleschaft Logo" />
                  <img className="img-50" src="/assets/images/MPI-brain-research.svg" alt="Max Plank Institute of Brain Research Logo" />
                </div>
              </div> :
              null
          }
        </div>
      </div>
    );
  }
}

function mapStateToProps(state: OxalisState) {
  return {
    skeletonTracing: state.tracing,
    dataset: state.dataset,
    flycam: state.flycam,
  };
}

export default connect(mapStateToProps)(DatasetInfoTabView);

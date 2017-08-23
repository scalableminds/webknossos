/**
 * dataset_info_view.js
 * @flow
 */
import _ from "lodash";
import React, { Component } from "react";
import { connect } from "react-redux";
import Maybe from "data.maybe";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import constants, { ControlModeEnum } from "oxalis/constants";
import { getPlaneScalingFactor } from "oxalis/model/accessors/flycam_accessor";
import { getSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import Store from "oxalis/store";
import TemplateHelpers from "libs/template_helpers";
import { setAnnotationNameAction } from "oxalis/model/actions/annotation_actions";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import type { OxalisState, TracingType, DatasetType, FlycamType, TaskType } from "oxalis/store";

type DatasetInfoTabStateProps = {
  tracing: TracingType,
  dataset: DatasetType,
  flycam: FlycamType,
  task: ?TaskType,
};

type DatasetInfoTabProps = DatasetInfoTabStateProps & { setAnnotationName: string => void };

class DatasetInfoTabView extends Component<DatasetInfoTabProps> {
  calculateZoomLevel(): number {
    let width;
    let zoom;
    const viewMode = Store.getState().temporaryConfiguration.viewMode;
    if (constants.MODES_PLANE.includes(viewMode)) {
      zoom = getPlaneScalingFactor(this.props.flycam);
      width = constants.PLANE_WIDTH;
    } else if (constants.MODES_ARBITRARY.includes(viewMode)) {
      zoom = this.props.flycam.zoomStep;
      width = constants.ARBITRARY_WIDTH;
    } else {
      throw Error(`Model mode not recognized: ${viewMode}`);
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

  setAnnotationName = (newName: string) => {
    this.props.setAnnotationName(newName);
  };

  render() {
    const { tracingType, name } = this.props.tracing;
    const tracingName = name || "<untitled>";
    const treesMaybe = getSkeletonTracing(this.props.tracing).chain(tracing =>
      Maybe.fromNullable(tracing.trees),
    );
    const treeCount = treesMaybe.map(trees => _.size(trees)).getOrElse(null);
    const nodeCount = treesMaybe
      // eslint-disable-next-line no-return-assign
      .map(trees => _.reduce(trees, (sum, tree) => (sum += _.size(tree.nodes)), 0))
      .getOrElse(null);
    const branchPointCount = treesMaybe
      // eslint-disable-next-line no-return-assign
      .map(trees => _.reduce(trees, (sum, tree) => (sum += _.size(tree.branchPoints)), 0))
      .getOrElse(null);
    let annotationTypeLabel;

    if (this.props.task != null) {
      // In case we have a task display its id as well
      annotationTypeLabel = (
        <span>
          {tracingType} : {this.props.task.id}
        </span>
      );
    } else {
      // Or display an explorative tracings name
      annotationTypeLabel = (
        <span>
          Explorational Tracing :
          <EditableTextLabel value={tracingName} onChange={this.setAnnotationName} />
        </span>
      );
    }

    const zoomLevel = this.calculateZoomLevel();
    const dataSetName = this.props.dataset.name;
    const isPublicViewMode =
      Store.getState().temporaryConfiguration.controlMode === ControlModeEnum.VIEW;

    return (
      <div className="flex-overflow">
        <p>
          {annotationTypeLabel}
        </p>
        <p>
          Dataset: {dataSetName}
        </p>
        <p>
          Viewport Width: {this.chooseUnit(zoomLevel)}
        </p>
        <p>
          Dataset Resolution: {TemplateHelpers.formatScale(this.props.dataset.scale)}
        </p>
        {this.props.tracing.type === "skeleton"
          ? <div>
              <p>
                Number of Trees: {treeCount}
              </p>
              <p>
                Number of Nodes: {nodeCount}
              </p>
              <p>
                Number of Branch Points: {branchPointCount}
              </p>
            </div>
          : null}
        {isPublicViewMode
          ? <div>
              <table className="table table-condensed table-nohead table-bordered">
                <tbody>
                  <tr>
                    <th colSpan="2">Controls</th>
                  </tr>
                  <tr>
                    <td>I,O or Alt + Mousewheel</td>
                    <td>Zoom in/out</td>
                  </tr>
                  <tr>
                    <td>Mousewheel or D and F</td>
                    <td>Move Along 3rd Axis</td>
                  </tr>
                  <tr>
                    <td>Left Mouse Drag or Arrow Keys</td>
                    <td>Move</td>
                  </tr>
                  <tr>
                    <td>Right Click Drag in 3D View</td>
                    <td>Rotate 3D View</td>
                  </tr>
                  <tr>
                    <td>K,L</td>
                    <td>Scale Up/Down Viewports</td>
                  </tr>
                </tbody>
              </table>
              <div>
                <img
                  className="img-50"
                  src="/assets/images/Max-Planck-Gesellschaft.svg"
                  alt="Max Plank Geselleschaft Logo"
                />
                <img
                  className="img-50"
                  src="/assets/images/MPI-brain-research.svg"
                  alt="Max Plank Institute of Brain Research Logo"
                />
              </div>
            </div>
          : null}
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): DatasetInfoTabStateProps => ({
  tracing: state.tracing,
  dataset: state.dataset,
  flycam: state.flycam,
  task: state.task,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  setAnnotationName(tracingName: string) {
    dispatch(setAnnotationNameAction(tracingName));
  },
});

export default connect(mapStateToProps, mapDispatchToProps)(DatasetInfoTabView);

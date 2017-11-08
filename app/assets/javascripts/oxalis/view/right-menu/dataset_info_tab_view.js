/**
 * dataset_info_view.js
 * @flow
 */
import React from "react";
import { connect } from "react-redux";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import constants, { ControlModeEnum } from "oxalis/constants";
import { getStats } from "oxalis/model/accessors/skeletontracing_accessor";
import { getPlaneScalingFactor } from "oxalis/model/accessors/flycam_accessor";
import Store from "oxalis/store";
import TemplateHelpers from "libs/template_helpers";
import {
  setAnnotationNameAction,
  setAnnotationDescriptionAction,
} from "oxalis/model/actions/annotation_actions";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import type { OxalisState, TracingType, DatasetType, TaskType, FlycamType } from "oxalis/store";

type DatasetInfoTabStateProps = {
  tracing: TracingType,
  dataset: DatasetType,
  flycam: FlycamType,
  task: ?TaskType,
};

type DatasetInfoTabProps = DatasetInfoTabStateProps & {
  setAnnotationName: string => void,
  setAnnotationDescription: string => void,
};

class DatasetInfoTabView extends React.PureComponent<DatasetInfoTabProps> {
  calculateZoomLevel(): number {
    const zoom = getPlaneScalingFactor(this.props.flycam);
    let width;
    const viewMode = Store.getState().temporaryConfiguration.viewMode;
    if (constants.MODES_PLANE.includes(viewMode)) {
      width = constants.PLANE_WIDTH;
    } else if (constants.MODES_ARBITRARY.includes(viewMode)) {
      width = constants.VIEWPORT_WIDTH;
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

  setAnnotationDescription = (newDescription: string) => {
    this.props.setAnnotationDescription(newDescription);
  };

  render() {
    const { tracingType, name, description } = this.props.tracing;
    const tracingName = name || "<untitled>";
    const tracingDescription = description || "<no comment>";
    const statsMaybe = getStats(this.props.tracing);
    let annotationTypeLabel;

    if (this.props.task != null) {
      // In case we have a task display its id
      annotationTypeLabel = (
        <span>
          {tracingType} : {this.props.task.id}
        </span>
      );
    } else if (!this.props.tracing.restrictions.allowUpdate) {
      // For readonly tracings display the non-editable explorative tracing name
      annotationTypeLabel = <span>Explorational Tracing: {tracingName}</span>;
    } else {
      // Or display display the editable explorative tracing name
      annotationTypeLabel = (
        <span>
          Explorational Tracing:
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
        <p>{annotationTypeLabel}</p>
        <p>Dataset: {dataSetName}</p>
        <p>Viewport Width: {this.chooseUnit(zoomLevel)}</p>
        <p>Dataset Resolution: {TemplateHelpers.formatScale(this.props.dataset.scale)}</p>
        <p>
          <span>
            Description:
            <EditableTextLabel
              value={tracingDescription}
              onChange={this.setAnnotationDescription}
              rows={4}
            />
          </span>
        </p>
        {this.props.tracing.type === "skeleton" ? (
          <div>
            <p>Number of Trees: {statsMaybe.map(stats => stats.treeCount).getOrElse(null)}</p>
            <p>Number of Nodes: {statsMaybe.map(stats => stats.nodeCount).getOrElse(null)}</p>
            <p>Number of Edges: {statsMaybe.map(stats => stats.edgeCount).getOrElse(null)}</p>
            <p>
              Number of Branch Points:{" "}
              {statsMaybe.map(stats => stats.branchPointCount).getOrElse(null)}
            </p>
          </div>
        ) : null}
        {isPublicViewMode ? (
          <div>
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
        ) : null}
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
  setAnnotationDescription(comment: string) {
    dispatch(setAnnotationDescriptionAction(comment));
  },
});

export default connect(mapStateToProps, mapDispatchToProps)(DatasetInfoTabView);

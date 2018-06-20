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
import { Table } from "antd";
import type { APIDatasetType } from "admin/api_flow_types";
import type { OxalisState, TracingType, TaskType, FlycamType } from "oxalis/store";

type DatasetInfoTabStateProps = {
  tracing: TracingType,
  dataset: APIDatasetType,
  flycam: FlycamType,
  task: ?TaskType,
};

type DatasetInfoTabProps = DatasetInfoTabStateProps & {
  setAnnotationName: string => void,
  setAnnotationDescription: string => void,
};

const shortcutColumns = [
  {
    title: "Keyboard Shortcut",
    dataIndex: "keybinding",
    key: "keybinding",
  },
  {
    title: "Action",
    dataIndex: "action",
    key: "action",
  },
];

const shortcuts = [
  {
    key: "1",
    keybinding: "I,O or Alt + Mousewheel",
    action: "Zoom in/out",
  },
  {
    key: "2",
    keybinding: "Mousewheel or D and F",
    action: "Move Along 3rd Axis",
  },
  {
    key: "3",
    keybinding: "Left Mouse Drag or Arrow Keys",
    action: "Move",
  },
  {
    key: "4",
    keybinding: "Right Click Drag in 3D View",
    action: "Rotate 3D View",
  },
  {
    key: "5",
    keybinding: "K,L",
    action: "Scale Up/Down Viewports",
  },
];

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
      throw new Error(`Model mode not recognized: ${viewMode}`);
    }
    // unit is nm
    const baseVoxel = getBaseVoxel(this.props.dataset.dataSource.scale);
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

  getTracingStatistics() {
    const statsMaybe = getStats(this.props.tracing);

    return this.props.tracing.type === "skeleton" ? (
      <div>
        <p>Number of Trees: {statsMaybe.map(stats => stats.treeCount).getOrElse(null)}</p>
        <p>Number of Nodes: {statsMaybe.map(stats => stats.nodeCount).getOrElse(null)}</p>
        <p>Number of Edges: {statsMaybe.map(stats => stats.edgeCount).getOrElse(null)}</p>
        <p>
          Number of Branch Points: {statsMaybe.map(stats => stats.branchPointCount).getOrElse(null)}
        </p>
      </div>
    ) : null;
  }

  getKeyboardShortcuts(isPublicViewMode: boolean) {
    return isPublicViewMode ? (
      <Table
        dataSource={shortcuts}
        columns={shortcutColumns}
        pagination={false}
        style={{ marginRight: 20, marginTop: 25, marginBottom: 25 }}
        size="small"
      />
    ) : null;
  }

  getOrganisationLogo(isPublicViewMode: boolean) {
    if (!this.props.dataset.logoUrl) {
      return null;
    }

    return isPublicViewMode ? (
      <img
        style={{ maxHeight: 250 }}
        src={this.props.dataset.logoUrl}
        alt={`${this.props.dataset.owningOrganization} Logo`}
      />
    ) : null;
  }

  getDatasetName(isPublicViewMode: boolean) {
    const { name: datasetName, displayName, description } = this.props.dataset;

    if (isPublicViewMode) {
      return (
        <div>
          <p>Dataset: {displayName || datasetName}</p>
          {description ? <p>{description}</p> : null}
        </div>
      );
    }

    return <p>Dataset: {datasetName}</p>;
  }

  getTracingName(isPublicViewMode: boolean) {
    if (isPublicViewMode) return null;

    let annotationTypeLabel;

    const { tracingType, name } = this.props.tracing;
    const tracingName = name || "<untitled>";

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
    const tracingDescription = this.props.tracing.description || "<no description>";

    return (
      <div>
        <p>{annotationTypeLabel}</p>
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
      </div>
    );
  }

  render() {
    const isPublicViewMode =
      Store.getState().temporaryConfiguration.controlMode === ControlModeEnum.VIEW;

    const zoomLevel = this.calculateZoomLevel();

    return (
      <div className="flex-overflow">
        {this.getTracingName(isPublicViewMode)}
        {this.getDatasetName(isPublicViewMode)}

        <p>Viewport Width: {this.chooseUnit(zoomLevel)}</p>
        <p>
          Dataset Resolution: {TemplateHelpers.formatScale(this.props.dataset.dataSource.scale)}
        </p>

        {this.getTracingStatistics()}
        {this.getKeyboardShortcuts(isPublicViewMode)}
        {this.getOrganisationLogo(isPublicViewMode)}
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

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
import { formatScale } from "libs/format_utils";
import {
  setAnnotationNameAction,
  setAnnotationDescriptionAction,
} from "oxalis/model/actions/annotation_actions";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import { Table, List } from "antd";
import Markdown from "react-remarkable";
import type { APIDataset } from "admin/api_flow_types";
import type { OxalisState, Tracing, Task, Flycam } from "oxalis/store";

type DatasetInfoTabStateProps = {
  tracing: Tracing,
  dataset: APIDataset,
  flycam: Flycam,
  task: ?Task,
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

export function calculateZoomLevel(flycam: Flycam, dataset: APIDataset): number {
  const zoom = getPlaneScalingFactor(flycam);
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
  const baseVoxel = getBaseVoxel(dataset.dataSource.scale);
  return zoom * width * baseVoxel;
}

export function formatNumberToLength(zoomLevel: number): string {
  if (zoomLevel < 1000) {
    return `${zoomLevel.toFixed(0)} nm`;
  } else if (zoomLevel < 1000000) {
    return `${(zoomLevel / 1000).toFixed(1)} μm`;
  } else {
    return `${(zoomLevel / 1000000).toFixed(1)} mm`;
  }
}

function getDatasetExtentInVoxel(dataset: APIDataset) {
  const datasetBuckets = dataset.dataSource.dataLayers;

  /* TODO
  * iterate over all datalayers => create array of all boundingBoxes (map)
  * write a union function in utils that takes an array of boudingBoxes and
  * evaluates the min and max for each boundingBox 
  * and then takes the min and max out of all Min and Max boundings
  * This is the dataset extent in voxel
  * multiply with resolution to get "real" extent
  */
  const numbOfBuckets = datasetBuckets.length;
  const firstBoundingBox = datasetBuckets[0].boundingBox;
  const extent = {
    width: firstBoundingBox.width * numbOfBuckets,
    height: firstBoundingBox.height,
    depth: firstBoundingBox.depth,
  };
  return extent;
}

function getDatasetExtentInLength(dataset: APIDataset) {
  const extentInVoxel = getDatasetExtentInVoxel(dataset);
  const scale = dataset.dataSource.scale;
  const extent = {
    width: extentInVoxel.width * scale[0],
    height: extentInVoxel.height * scale[1],
    depth: extentInVoxel.depth * scale[2],
  };
  return extent;
}

function formatExtentWithLength(extent: Object) {
  return `${formatNumberToLength(extent.width)} x ${formatNumberToLength(
    extent.height,
  )} x ${formatNumberToLength(extent.depth)}`;
}

class DatasetInfoTabView extends React.PureComponent<DatasetInfoTabProps> {
  setAnnotationName = (newName: string) => {
    this.props.setAnnotationName(newName);
  };

  setAnnotationDescription = (newDescription: string) => {
    this.props.setAnnotationDescription(newDescription);
  };

  getTracingStatistics() {
    const statsMaybe = getStats(this.props.tracing);

    return this.props.tracing.skeleton != null ? (
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
    const { name: datasetName, displayName, description: datasetDescription } = this.props.dataset;

    if (isPublicViewMode) {
      return (
        <div>
          <p>Dataset: {displayName || datasetName}</p>
          {datasetDescription ? (
            <Markdown
              source={datasetDescription}
              options={{ html: false, breaks: true, linkify: true }}
            />
          ) : null}
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
          <EditableTextLabel
            value={tracingName}
            onChange={this.setAnnotationName}
            label="Annotation Name"
          />
        </span>
      );
    }
    const tracingDescription = this.props.tracing.description || "<no description>";

    return (
      <div className="flex-overflow">
        <p>{annotationTypeLabel}</p>
        <p>
          <span style={{ verticalAlign: "top" }}>
            Description:
            <EditableTextLabel
              value={tracingDescription}
              onChange={this.setAnnotationDescription}
              rows={4}
              markdown
              label="Annotation Description"
            />
          </span>
        </p>
      </div>
    );
  }

  render() {
    const isPublicViewMode =
      Store.getState().temporaryConfiguration.controlMode === ControlModeEnum.VIEW;

    const zoomLevel = calculateZoomLevel(this.props.flycam, this.props.dataset);
    const extentInVoxel = getDatasetExtentInVoxel(this.props.dataset);
    const extent = getDatasetExtentInLength(this.props.dataset);
    const datsetExtents = [
      `${extentInVoxel.width} x ${extentInVoxel.height} x ${extentInVoxel.depth}`,
      formatExtentWithLength(extent),
    ];
    return (
      <div className="flex-overflow info-tab-content">
        {this.getTracingName(isPublicViewMode)}
        {this.getDatasetName(isPublicViewMode)}

        <p>Viewport Width: {formatNumberToLength(zoomLevel)}</p>
        <p>Dataset Resolution: {formatScale(this.props.dataset.dataSource.scale)}</p>
        <p>
          Datset Extend:
          <List
            bordered={false}
            split={false}
            dataSource={datsetExtents}
            renderItem={extentInfo => <List.Item>{extentInfo}</List.Item>}
          />
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

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(DatasetInfoTabView);

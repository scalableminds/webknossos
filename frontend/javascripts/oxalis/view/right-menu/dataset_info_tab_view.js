/**
 * dataset_info_view.js
 * @flow
 */
import type { Dispatch } from "redux";
import { Table, Tooltip, Icon } from "antd";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import Markdown from "react-remarkable";
import React from "react";

import { type APIDataset, APIAnnotationTypeEnum } from "admin/api_flow_types";
import { aggregateBoundingBox } from "libs/utils";
import { convertToHybridTracing } from "admin/admin_rest_api";
import { formatScale } from "libs/format_utils";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import { getStats } from "oxalis/model/accessors/skeletontracing_accessor";
import { location } from "libs/window";
import {
  setAnnotationNameAction,
  setAnnotationDescriptionAction,
} from "oxalis/model/actions/annotation_actions";
import ButtonComponent from "oxalis/view/components/button_component";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import Model from "oxalis/model";
import Store, { type Flycam, type OxalisState, type Task, type Tracing } from "oxalis/store";
import { Unicode, ControlModeEnum } from "oxalis/constants";

const { ThinSpace } = Unicode;

type OwnProps = {|
  portalKey: string,
|};
type StateProps = {|
  tracing: Tracing,
  dataset: APIDataset,
  flycam: Flycam,
  task: ?Task,
|};
type DispatchProps = {|
  setAnnotationName: string => void,
  setAnnotationDescription: string => void,
|};

type Props = {| ...OwnProps, ...StateProps, ...DispatchProps |};

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

export function convertPixelsToNm(
  lengthInPixel: number,
  zoomValue: number,
  dataset: APIDataset,
): number {
  return lengthInPixel * zoomValue * getBaseVoxel(dataset.dataSource.scale);
}

export function formatNumberToLength(zoomLevel: number): string {
  if (zoomLevel < 1000) {
    return `${zoomLevel.toFixed(0)}${ThinSpace}nm`;
  } else if (zoomLevel < 1000000) {
    return `${(zoomLevel / 1000).toFixed(1)}${ThinSpace}μm`;
  } else {
    return `${(zoomLevel / 1000000).toFixed(1)}${ThinSpace}mm`;
  }
}

function getDatasetExtentInVoxel(dataset: APIDataset) {
  const datasetLayers = dataset.dataSource.dataLayers;
  const allBoundingBoxes = datasetLayers.map(layer => layer.boundingBox);
  const unifiedBoundingBoxes = aggregateBoundingBox(allBoundingBoxes);
  const { min, max } = unifiedBoundingBoxes;
  const extent = {
    width: max[0] - min[0],
    height: max[1] - min[1],
    depth: max[2] - min[2],
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

function formatExtentWithLength(extent: Object, formattingFunction: number => string) {
  return `${formattingFunction(extent.width)}\u2009×\u2009${formattingFunction(
    extent.height,
  )}\u2009×\u2009${formattingFunction(extent.depth)}`;
}

class DatasetInfoTabView extends React.PureComponent<Props> {
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

  getKeyboardShortcuts(isDatasetViewMode: boolean) {
    return isDatasetViewMode ? (
      <Table
        dataSource={shortcuts}
        columns={shortcutColumns}
        pagination={false}
        style={{ marginRight: 20, marginTop: 25, marginBottom: 25 }}
        size="small"
      />
    ) : null;
  }

  getOrganisationLogo(isDatasetViewMode: boolean) {
    if (!this.props.dataset.logoUrl) {
      return null;
    }

    return isDatasetViewMode ? (
      <img
        style={{ maxHeight: 250 }}
        src={this.props.dataset.logoUrl}
        alt={`${this.props.dataset.owningOrganization} Logo`}
      />
    ) : null;
  }

  getDatasetName(isDatasetViewMode: boolean) {
    const { name: datasetName, displayName, description: datasetDescription } = this.props.dataset;

    if (isDatasetViewMode) {
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

  getTracingName(isDatasetViewMode: boolean) {
    if (isDatasetViewMode) return null;

    let annotationTypeLabel;

    const { annotationType, name } = this.props.tracing;
    const tracingName = name || "<untitled>";

    if (this.props.task != null) {
      // In case we have a task display its id
      annotationTypeLabel = (
        <span>
          {annotationType} : {this.props.task.id}
        </span>
      );
    } else if (!this.props.tracing.restrictions.allowUpdate) {
      // For readonly tracings display the non-editable explorative tracing name
      annotationTypeLabel = <span>Explorational Tracing: {tracingName}</span>;
    } else {
      // Or display the editable explorative tracing name
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

  handleConvertToHybrid = async () => {
    await Model.ensureSavedState();
    await convertToHybridTracing(this.props.tracing.annotationId);
    location.reload();
  };

  getTracingType(isDatasetViewMode: boolean) {
    if (isDatasetViewMode) return null;

    const isSkeleton = this.props.tracing.skeleton != null;
    const isVolume = this.props.tracing.volume != null;
    const isHybrid = isSkeleton && isVolume;
    const { allowUpdate } = this.props.tracing.restrictions;
    const isExplorational =
      this.props.tracing.annotationType === APIAnnotationTypeEnum.Explorational;

    if (isHybrid) {
      return (
        <p>
          Tracing Type:{" "}
          <Tooltip title="Skeleton and Volume">
            Hybrid <Icon type="info-circle-o" />
          </Tooltip>
        </p>
      );
    } else {
      return (
        <p>
          Tracing Type: {isVolume ? "Volume" : "Skeleton"}
          {allowUpdate && isExplorational ? (
            <ButtonComponent
              style={{ marginLeft: 10 }}
              size="small"
              onClick={this.handleConvertToHybrid}
              title="Skeleton and Volume"
            >
              Convert to Hybrid
            </ButtonComponent>
          ) : null}
        </p>
      );
    }
  }

  render() {
    const isDatasetViewMode =
      Store.getState().temporaryConfiguration.controlMode === ControlModeEnum.VIEW;

    const extentInVoxel = getDatasetExtentInVoxel(this.props.dataset);
    const extent = getDatasetExtentInLength(this.props.dataset);
    return (
      <div className="flex-overflow padded-tab-content">
        <div className="info-tab-block">
          {this.getTracingName(isDatasetViewMode)}
          {this.getTracingType(isDatasetViewMode)}
          {this.getDatasetName(isDatasetViewMode)}
        </div>

        <div className="info-tab-block">
          <p>Dataset Scale: {formatScale(this.props.dataset.dataSource.scale)}</p>
          <table>
            <tbody>
              <tr>
                <td style={{ paddingRight: 8 }}>Dataset Extent:</td>
                <td>{formatExtentWithLength(extentInVoxel, x => `${x}`)} Voxel³</td>
              </tr>
              <tr>
                <td />
                <td>{formatExtentWithLength(extent, formatNumberToLength)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="info-tab-block">{this.getTracingStatistics()}</div>
        {this.getKeyboardShortcuts(isDatasetViewMode)}
        {this.getOrganisationLogo(isDatasetViewMode)}
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
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

export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(DatasetInfoTabView);

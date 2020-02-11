/**
 * dataset_info_view.js
 * @flow
 */
import type { Dispatch } from "redux";
import { Table, Tooltip, Icon } from "antd";
import { connect } from "react-redux";
import Markdown from "react-remarkable";
import React from "react";

import { APIAnnotationTypeEnum, type APIDataset, type APIUser } from "admin/api_flow_types";
import { ControlModeEnum } from "oxalis/constants";
import { convertToHybridTracing } from "admin/admin_rest_api";
import { formatScale } from "libs/format_utils";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import { getDatasetExtentAsString, getResolutions } from "oxalis/model/accessors/dataset_accessor";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { getStats } from "oxalis/model/accessors/skeletontracing_accessor";
import { location } from "libs/window";
import {
  setAnnotationNameAction,
  setAnnotationDescriptionAction,
} from "oxalis/model/actions/annotation_actions";
import ButtonComponent from "oxalis/view/components/button_component";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import Model from "oxalis/model";
import Store, { type OxalisState, type Task, type Tracing } from "oxalis/store";

type OwnProps = {|
  portalKey: string,
|};
type StateProps = {|
  tracing: Tracing,
  dataset: APIDataset,
  task: ?Task,
  activeUser: ?APIUser,
  logZoomStep: number,
|};
type DispatchProps = {|
  setAnnotationName: string => void,
  setAnnotationDescription: string => void,
|};

type Props = {| ...OwnProps, ...StateProps, ...DispatchProps |};

const shortcutColumns = [
  {
    dataIndex: "keybinding",
    key: "keybinding",
    width: 200
  },
  {
    dataIndex: "action",
    key: "action",
  },
];

const shortcuts = [
  {
    key: "1",
    keybinding: [
      <span key="zoom-1" className="keyboard-key-icon">I</span>,
      "/",
      <span key="zoom-2" className="keyboard-key-icon">O</span>,
      "or",
      <span key="zoom-3" className="keyboard-key-icon">ALT</span>,
      "+",
      <img key="zoom-4" className="keyboard-mouse-icon" src="/assets/images/icon-mousewheel.svg" alt="Mouse Wheel"/>
      ],
    action: "Zoom in/out",
  },
  {
    key: "2",
    keybinding: [
      <img key="move-1" className="keyboard-mouse-icon" src="/assets/images/icon-mousewheel.svg" alt="Mouse Wheel"/>,
      "or",
      <span key="move-2" className="keyboard-key-icon">D</span>,
      "/",
      <span key="move-3" className="keyboard-key-icon">F</span>,
      ],
    action: "Move Along 3rd Axis",
  },
  {
    key: "3",
    keybinding: [
      <img key="move" className="keyboard-mouse-icon" src="/assets/images/icon-mouse-left.svg" alt="Left Mouse Button"/>
      ],
    action: "Move",
  },
  {
    key: "4",
    keybinding: [
      <img key="rotate" className="keyboard-mouse-icon" src="/assets/images/icon-mouse-right.svg" alt="Right Mouse Button"/>,
      "in 3D View"
      ],
    action: "Rotate 3D View",
  },
  {
    key: "5",
    keybinding: [
      <span key="scale-1" className="keyboard-key-icon">K</span>,
      "/",
      <span key="scale-2" className="keyboard-key-icon">L</span>,
      ],
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
        showHeader={false}
        dataSource={shortcuts}
        columns={shortcutColumns}
        pagination={false}
        style={{ marginRight: 20, marginTop: 25, marginBottom: 25, maxWidth: 500 }}
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
        style={{ maxHeight: 250, maxWidth: "100%", objectFit: "contain" }}
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
          Explorational Annotation:
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
          Annotation Type:{" "}
          <Tooltip title="Skeleton and Volume">
            Hybrid <Icon type="info-circle-o" />
          </Tooltip>
        </p>
      );
    } else {
      return (
        <p>
          Annotation Type: {isVolume ? "Volume" : "Skeleton"}
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

  maybePrintOwner() {
    const { activeUser } = this.props;
    const owner = this.props.tracing.user;

    if (!owner) {
      return null;
    }

    if (!activeUser || owner.id !== activeUser.id) {
      return (
        <span>
          Owner: {owner.firstName} {owner.lastName}
        </span>
      );
    }

    // Active user is owner
    return null;
  }

  render() {
    const isDatasetViewMode =
      Store.getState().temporaryConfiguration.controlMode === ControlModeEnum.VIEW;

    const extentInVoxel = getDatasetExtentAsString(this.props.dataset, true);
    const extentInLength = getDatasetExtentAsString(this.props.dataset, false);

    const resolutions = getResolutions(this.props.dataset);
    const activeResolution = resolutions[this.props.logZoomStep];

    const resolutionInfo =
      activeResolution != null ? (
        <div className="info-tab-block">
          Active Resolution: {activeResolution.join("-")}{" "}
          <Tooltip
            title={
              <div>
                This dataset contains the following resolutions:
                <ul>
                  {resolutions.map(r => (
                    <li key={r.join()}>{r.join("-")}</li>
                  ))}
                </ul>
              </div>
            }
            placement="right"
          >
            <Icon type="info-circle" />
          </Tooltip>
        </div>
      ) : null;

    return (
      <div className="flex-overflow padded-tab-content">
        <div className="info-tab-block">
          {this.getTracingName(isDatasetViewMode)}
          {this.getTracingType(isDatasetViewMode)}
          {this.getDatasetName(isDatasetViewMode)}
          {this.maybePrintOwner()}
        </div>

        <div className="info-tab-block">
          <p>Dataset Scale: {formatScale(this.props.dataset.dataSource.scale)}</p>
          <table>
            <tbody>
              <tr>
                <td style={{ paddingRight: 8 }}>Dataset Extent:</td>
                <td>{extentInVoxel}</td>
              </tr>
              <tr>
                <td />
                <td>{extentInLength}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {resolutionInfo}

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
  task: state.task,
  activeUser: state.activeUser,
  logZoomStep: getRequestLogZoomStep(state),
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

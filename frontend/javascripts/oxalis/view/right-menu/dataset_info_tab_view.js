/**
 * dataset_info_view.js
 * @flow
 */
import type { Dispatch } from "redux";
import { Tooltip, Button } from "antd";
import { EditOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { connect } from "react-redux";
import Markdown from "react-remarkable";
import React from "react";
import { Link } from "react-router-dom";

import { APIAnnotationTypeEnum, type APIDataset, type APIUser } from "types/api_flow_types";
import { ControlModeEnum, type Vector3 } from "oxalis/constants";
import { convertToHybridTracing } from "admin/admin_rest_api";
import { formatScale } from "libs/format_utils";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import { getDatasetExtentAsString, getResolutions } from "oxalis/model/accessors/dataset_accessor";
import { getCurrentResolution } from "oxalis/model/accessors/flycam_accessor";
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

type StateProps = {|
  tracing: Tracing,
  dataset: APIDataset,
  task: ?Task,
  activeUser: ?APIUser,
  activeResolution: Vector3,
|};
type DispatchProps = {|
  setAnnotationName: string => void,
  setAnnotationDescription: string => void,
|};

type Props = {| ...StateProps, ...DispatchProps |};

const shortcuts = [
  {
    key: "1",
    keybinding: [
      <span key="zoom-1" className="keyboard-key-icon">
        I
      </span>,
      "/",
      <span key="zoom-2" className="keyboard-key-icon">
        O
      </span>,
      "or",
      <span key="zoom-3" className="keyboard-key-icon">
        ALT
      </span>,
      "+",
      <img
        key="zoom-4"
        className="keyboard-mouse-icon"
        src="/assets/images/icon-mousewheel.svg"
        alt="Mouse Wheel"
      />,
    ],
    action: "Zoom in/out",
  },
  {
    key: "2",
    keybinding: [
      <img
        key="move-1"
        className="keyboard-mouse-icon"
        src="/assets/images/icon-mousewheel.svg"
        alt="Mouse Wheel"
      />,
      "or",
      <span key="move-2" className="keyboard-key-icon">
        D
      </span>,
      "/",
      <span key="move-3" className="keyboard-key-icon">
        F
      </span>,
    ],
    action: "Move Along 3rd Axis",
  },
  {
    key: "3",
    keybinding: [
      <img
        key="move"
        className="keyboard-mouse-icon"
        src="/assets/images/icon-mouse-left.svg"
        alt="Left Mouse Button"
      />,
    ],
    action: "Move",
  },
  {
    key: "4",
    keybinding: [
      <img
        key="rotate"
        className="keyboard-mouse-icon"
        src="/assets/images/icon-mouse-right.svg"
        alt="Right Mouse Button"
      />,
      "in 3D View",
    ],
    action: "Rotate 3D View",
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
      <div style={{ marginBottom: 25 }}>
        <table className="shortcut-table">
          <tbody>
            {shortcuts.map(shortcut => (
              <tr key={shortcut.key}>
                <td style={{ width: 200 }}>{shortcut.keybinding}</td>
                <td>{shortcut.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <a
          target="_blank"
          href="https://docs.webknossos.org/reference/keyboard_shortcuts"
          rel="noopener noreferrer"
          style={{ fontSize: 14 }}
        >
          More shortcuts…
        </a>
      </div>
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
    const {
      name: datasetName,
      displayName,
      description: datasetDescription,
      owningOrganization,
    } = this.props.dataset;
    const getEditSettingsIcon = () => (
      <Tooltip title="Edit dataset settings">
        <Button
          type="text"
          icon={<EditOutlined />}
          href={`/datasets/${owningOrganization}/${datasetName}/edit`}
        />
      </Tooltip>
    );

    if (isDatasetViewMode) {
      return (
        <div>
          <p style={{ wordWrap: "break-word" }}>
            <strong>{displayName || datasetName}</strong>
            {getEditSettingsIcon()}
          </p>
          {datasetDescription ? (
            <div style={{ fontSize: 14 }}>
              <Markdown
                source={datasetDescription}
                options={{ html: false, breaks: true, linkify: true }}
              />
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <p>
        Dataset:{" "}
        <Link
          to={`/datasets/${owningOrganization}/${datasetName}/view`}
          title={`Click to view dataset ${datasetName} without annotation`}
          style={{ wordWrap: "break-word" }}
        >
          {datasetName}
        </Link>
        {getEditSettingsIcon()}
      </p>
    );
  }

  getTracingName(isDatasetViewMode: boolean) {
    if (isDatasetViewMode) return null;

    let annotationTypeLabel;

    const { annotationType, name } = this.props.tracing;
    const tracingName = name || "[untitled]";

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
    const tracingDescription = this.props.tracing.description || "[no description]";

    let descriptionEditField;
    if (this.props.tracing.restrictions.allowUpdate) {
      descriptionEditField = (
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
      );
    } else {
      descriptionEditField = (
        <span style={{ verticalAlign: "top" }}>
          Description:
          <Markdown
            source={tracingDescription}
            options={{ html: false, breaks: true, linkify: true }}
          />
        </span>
      );
    }

    return (
      <div>
        <div>{annotationTypeLabel}</div>
        <div>{descriptionEditField}</div>
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
            Hybrid <InfoCircleOutlined />
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
    const { dataset, activeResolution } = this.props;
    const isDatasetViewMode =
      Store.getState().temporaryConfiguration.controlMode === ControlModeEnum.VIEW;

    const extentInVoxel = getDatasetExtentAsString(dataset, true);
    const extentInLength = getDatasetExtentAsString(dataset, false);
    const resolutions = getResolutions(dataset);

    const resolutionInfo =
      activeResolution != null ? (
        <Tooltip
          title={
            <div>
              Currently rendered resolution {activeResolution.join("-")}.<br />
              <br />
              Available resolutions:
              <ul>
                {resolutions.map(r => (
                  <li key={r.join()}>{r.join("-")}</li>
                ))}
              </ul>
            </div>
          }
          placement="left"
        >
          <tr>
            <td style={{ paddingRight: 4, paddingTop: 10, verticalAlign: "top" }}>
              <img
                className="info-tab-icon"
                src="/assets/images/icon-downsampling.svg"
                alt="Resolution"
              />
            </td>
            <td style={{ paddingRight: 4, paddingTop: 10, verticalAlign: "top" }}>
              {activeResolution.join("-")}
            </td>
          </tr>
        </Tooltip>
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
          <table style={{ fontSize: 14 }}>
            <tbody>
              <Tooltip title="Dataset voxel size" placement="left">
                <tr>
                  <td style={{ paddingRight: 4, verticalAlign: "top" }}>
                    <img
                      className="info-tab-icon"
                      src="/assets/images/icon-voxelsize.svg"
                      alt="Voxel size"
                    />
                  </td>
                  <td>{formatScale(this.props.dataset.dataSource.scale)}</td>
                </tr>
              </Tooltip>
              <Tooltip title="Dataset extent" placement="left">
                <tr>
                  <td style={{ paddingRight: 4, paddingTop: 10, verticalAlign: "top" }}>
                    <img
                      className="info-tab-icon"
                      src="/assets/images/icon-extent.svg"
                      alt="Dataset extent"
                    />
                  </td>
                  <td style={{ paddingTop: 10 }}>
                    {extentInVoxel}
                    <br /> {extentInLength}
                  </td>
                </tr>
              </Tooltip>
              {resolutionInfo}
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
  task: state.task,
  activeUser: state.activeUser,
  activeResolution: getCurrentResolution(state),
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  setAnnotationName(tracingName: string) {
    dispatch(setAnnotationNameAction(tracingName));
  },
  setAnnotationDescription(comment: string) {
    dispatch(setAnnotationDescriptionAction(comment));
  },
});

export default connect<Props, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(DatasetInfoTabView);

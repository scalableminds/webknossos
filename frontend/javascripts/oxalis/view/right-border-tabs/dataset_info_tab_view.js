/**
 * dataset_info_view.js
 * @flow
 */
import type { Dispatch } from "redux";
import { Tooltip, Button, Dropdown, Menu } from "antd";
import { SettingOutlined, InfoCircleOutlined, StarOutlined } from "@ant-design/icons";
import { connect } from "react-redux";
import Markdown from "react-remarkable";
import React from "react";
import { Link } from "react-router-dom";

import { APIAnnotationTypeEnum, type APIDataset, type APIUser } from "types/api_flow_types";
import { ControlModeEnum, type Vector3 } from "oxalis/constants";
import { convertToHybridTracing } from "admin/admin_rest_api";
import { formatScale } from "libs/format_utils";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import {
  getDatasetExtentAsString,
  getResolutions,
  getVisibleSegmentationLayer,
} from "oxalis/model/accessors/dataset_accessor";
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
import features from "features";
import Store, { type OxalisState, type Task, type Tracing } from "oxalis/store";
import {
  NucleiInferralModal,
  NeuronInferralModal,
} from "oxalis/view/right-border-tabs/starting_job_modals";

const StartableJobsEnum = {
  NUCLEI_INFERRAL: "nuclei inferral",
  NEURON_INFERRAL: "neuron inferral",
};

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

type State = {
  showJobsDetailsModal: ?$Values<typeof StartableJobsEnum>,
};

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

class DatasetInfoTabView extends React.PureComponent<Props, State> {
  state = {
    showJobsDetailsModal: null,
  };

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
          href="https://docs.webknossos.org/webknossos/keyboard_shortcuts.html"
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

  getProcessingJobsMenu = () => {
    const { dataset } = this.props;
    if (!dataset.jobsEnabled) {
      return (
        <tr>
          <td style={{ paddingRight: 4, paddingTop: 10, verticalAlign: "top" }}>
            <StarOutlined className="info-tab-icon" width={24} height={24} />
          </td>
          <td>
            <Tooltip title="Dataset Processing features are only available for datasets hosted natively and not on other datastores.">
              <Button disabled type="link" style={{ padding: 0 }}>
                Process Dataset
              </Button>
            </Tooltip>
          </td>
        </tr>
      );
    }
    const jobMenuItems = [
      <Menu.Item
        key="start_nuclei_inferal"
        onClick={() => this.setState({ showJobsDetailsModal: StartableJobsEnum.NUCLEI_INFERRAL })}
      >
        <Tooltip title="Start a job that automatically detects nuclei for this dataset.">
          Start Nuclei Inferral
        </Tooltip>
      </Menu.Item>,
    ];
    if (this.props.activeUser != null && this.props.activeUser.isAdmin) {
      jobMenuItems.push(
        <Menu.Item
          key="start_neuron_inferral"
          onClick={() => this.setState({ showJobsDetailsModal: StartableJobsEnum.NEURON_INFERRAL })}
        >
          <Tooltip title="Start a job that automatically reconstructs neurons for this dataset.">
            Start Neuron Inferral
          </Tooltip>
        </Menu.Item>,
      );
    }
    return (
      <tr>
        <td style={{ paddingRight: 4, paddingTop: 10, verticalAlign: "top" }}>
          <StarOutlined className="info-tab-icon" style={{ fontSize: 18 }} />
        </td>
        <Dropdown overlay={<Menu>{jobMenuItems}</Menu>} overlayStyle={{ minWidth: "unset" }}>
          <td>
            <Button type="link" style={{ padding: 0 }}>
              Process Dataset
            </Button>
          </td>
        </Dropdown>
      </tr>
    );
  };

  getDatasetName(isDatasetViewMode: boolean) {
    const {
      name: datasetName,
      displayName,
      description: datasetDescription,
      owningOrganization,
    } = this.props.dataset;
    const { activeUser } = this.props;
    const getEditSettingsIcon = () =>
      activeUser != null &&
      activeUser.organization === owningOrganization &&
      (activeUser.isAdmin || activeUser.isDatasetManager) ? (
        <Tooltip title="Edit dataset settings">
          <Button
            type="text"
            icon={<SettingOutlined />}
            href={`/datasets/${owningOrganization}/${datasetName}/edit`}
            className="transparent-background-on-hover"
            target="_blank"
          />
        </Tooltip>
      ) : null;

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

    const maybeSegmentationLayer = getVisibleSegmentationLayer(Store.getState());
    await convertToHybridTracing(
      this.props.tracing.annotationId,
      maybeSegmentationLayer != null ? maybeSegmentationLayer.name : null,
    );
    location.reload();
  };

  getTracingType(isDatasetViewMode: boolean) {
    if (isDatasetViewMode) return null;

    const isSkeleton = this.props.tracing.skeleton != null;
    const isVolume = this.props.tracing.volumes.length > 0;
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

  renderSelectedStartingJobsModal() {
    const handleClose = () => this.setState({ showJobsDetailsModal: null });
    if (this.state.showJobsDetailsModal === StartableJobsEnum.NUCLEI_INFERRAL) {
      return <NucleiInferralModal handleClose={handleClose} />;
    } else if (this.state.showJobsDetailsModal === StartableJobsEnum.NEURON_INFERRAL) {
      return <NeuronInferralModal handleClose={handleClose} />;
    }
    return null;
  }

  render() {
    const { dataset, activeResolution, activeUser } = this.props;
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

              {features().jobsEnabled &&
              activeUser != null &&
              (activeUser.isDatasetManager || activeUser.isAdmin)
                ? this.getProcessingJobsMenu()
                : null}
            </tbody>
          </table>
          {this.renderSelectedStartingJobsModal()}
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

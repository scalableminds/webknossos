import type { Dispatch } from "redux";
import { Tooltip, Typography, Tag } from "antd";
import { SettingOutlined, InfoCircleOutlined, EditOutlined } from "@ant-design/icons";
import { connect } from "react-redux";
import Markdown from "react-remarkable";
import React, { CSSProperties, ChangeEvent } from "react";
import { Link } from "react-router-dom";
import type { APIDataset, APIUser } from "types/api_flow_types";
import { ControlModeEnum } from "oxalis/constants";
import { formatScale } from "libs/format_utils";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import {
  getDatasetExtentAsString,
  getResolutionUnion,
} from "oxalis/model/accessors/dataset_accessor";
import { getActiveResolutionInfo } from "oxalis/model/accessors/flycam_accessor";
import {
  getCombinedStats,
  type CombinedTracingStats,
} from "oxalis/model/accessors/annotation_accessor";
import {
  setAnnotationNameAction,
  setAnnotationDescriptionAction,
} from "oxalis/model/actions/annotation_actions";

import type { OxalisState, Task, Tracing } from "oxalis/store";

import { formatUserName } from "oxalis/model/accessors/user_accessor";
import { mayEditAnnotationProperties } from "oxalis/model/accessors/annotation_accessor";
import { mayUserEditDataset, pluralize } from "libs/utils";
import { getReadableNameForLayerName } from "oxalis/model/accessors/volumetracing_accessor";
import { getOrganization } from "admin/admin_rest_api";
import { MarkdownModal } from "../components/markdown_modal";

type StateProps = {
  annotation: Tracing;
  dataset: APIDataset;
  task: Task | null | undefined;
  activeUser: APIUser | null | undefined;
  activeResolutionInfo: ReturnType<typeof getActiveResolutionInfo>;
  isDatasetViewMode: boolean;
  mayEditAnnotation: boolean;
};
type DispatchProps = {
  setAnnotationName: (arg0: string) => void;
  setAnnotationDescription: (arg0: string) => void;
};
type Props = StateProps & DispatchProps;
type State = {
  owningOrganizationDisplayName: string | null;
  isMarkdownModalOpen: boolean;
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
        title="Mouse Wheel"
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
        title="Mouse Wheel"
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
      <div
        key="move"
        title="Left Mouse Button Drag"
        className="keyboard-mouse-icon icon-mouse-left"
      />,
    ],
    action: "Move",
  },
  {
    key: "4",
    keybinding: [
      <div
        key="rotate"
        title="Right Mouse Button Drag"
        className="keyboard-mouse-icon icon-mouse-right"
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

export function convertNmToPixels(
  lengthInNm: number,
  zoomValue: number,
  dataset: APIDataset,
): number {
  return lengthInNm / (zoomValue * getBaseVoxel(dataset.dataSource.scale));
}

export function DatasetExtentRow({ dataset }: { dataset: APIDataset }) {
  const extentInVoxel = getDatasetExtentAsString(dataset, true);
  const extentInLength = getDatasetExtentAsString(dataset, false);

  return (
    <Tooltip title="Dataset extent" placement="left">
      <tr>
        <td
          style={{
            paddingRight: 20,
            paddingTop: 10,
          }}
        >
          <img
            className="info-tab-icon"
            src="/assets/images/icon-extent.svg"
            alt="Dataset extent"
          />
        </td>
        <td
          style={{
            paddingTop: 10,
          }}
        >
          {extentInVoxel}
          <br /> {extentInLength}
        </td>
      </tr>
    </Tooltip>
  );
}

export function VoxelSizeRow({ dataset }: { dataset: APIDataset }) {
  return (
    <Tooltip title="Dataset voxel size" placement="left">
      <tr>
        <td
          style={{
            paddingRight: 20,
          }}
        >
          <img className="info-tab-icon" src="/assets/images/icon-voxelsize.svg" alt="Voxel size" />
        </td>
        <td>{formatScale(dataset.dataSource.scale)}</td>
      </tr>
    </Tooltip>
  );
}

export function OwningOrganizationRow({ organizationName }: { organizationName: string | null }) {
  return (
    <Tooltip title="Organization" placement="left">
      <div className="info-tab-block">
        <p className="sidebar-label">Organization</p>
        <p>
          <Tag color="blue">{organizationName === null ? <i>loading...</i> : organizationName}</Tag>
        </p>
      </div>
    </Tooltip>
  );
}

export function AnnotationStats({
  stats,
  asInfoBlock,
  withMargin,
}: {
  stats: CombinedTracingStats;
  asInfoBlock: boolean;
  withMargin?: boolean | null | undefined;
}) {
  const formatLabel = (str: string) => (asInfoBlock ? str : "");
  const useStyleWithMargin = withMargin != null ? withMargin : true;
  const styleWithLargeMarginBottom = { marginBottom: 14 };
  const styleWithSmallMargin = { margin: "2px auto" };

  return (
    <div
      className="info-tab-block"
      style={useStyleWithMargin ? styleWithLargeMarginBottom : styleWithSmallMargin}
    >
      {asInfoBlock && <p className="sidebar-label">Statistics</p>}
      <table className={asInfoBlock ? "annotation-stats-table" : "annotation-stats-table-slim"}>
        <tbody>
          {"treeCount" in stats ? (
            <Tooltip
              placement="left"
              title={
                <>
                  <p>Trees: {stats.treeCount}</p>
                  <p>Nodes: {stats.nodeCount}</p>
                  <p>Edges: {stats.edgeCount}</p>
                  <p>Branchpoints: {stats.branchPointCount}</p>
                </>
              }
            >
              <tr>
                <td>
                  <img
                    className="info-tab-icon"
                    src="/assets/images/icon-skeletons.svg"
                    alt="Skeletons"
                  />
                </td>
                <td>
                  {stats.treeCount} {formatLabel(pluralize("Tree", stats.treeCount))}
                </td>
              </tr>
            </Tooltip>
          ) : null}
          {"segmentCount" in stats ? (
            <Tooltip
              placement="left"
              title={`${stats.segmentCount} ${pluralize("Segment", stats.segmentCount)} – Only segments that were manually registered (either brushed or
                                      interacted with) are counted in this statistic. Segmentation layers
                                      created from automated workflows (also known as fallback layers) are not
                                      considered currently.`}
            >
              <tr>
                <td>
                  <img
                    className="info-tab-icon"
                    src="/assets/images/icon-segments.svg"
                    alt="Segments"
                  />
                </td>
                <td>
                  {stats.segmentCount} {formatLabel(pluralize("Segment", stats.segmentCount))}
                </td>
              </tr>
            </Tooltip>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export class DatasetInfoTabView extends React.PureComponent<Props, State> {
  state: State = {
    isMarkdownModalOpen: false,
    owningOrganizationDisplayName: null,
  };

  setAnnotationName = (newName: string) => {
    this.props.setAnnotationName(newName);
  };

  setAnnotationDescription = (evt: ChangeEvent<HTMLTextAreaElement>) => {
    this.props.setAnnotationDescription(evt.target.value);
  };

  componentDidMount(): void {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    const organization = await getOrganization(this.props.dataset.owningOrganization);
    this.setState({
      owningOrganizationDisplayName: organization.displayName,
    });
    console.log(this.state.owningOrganizationDisplayName);
  }

  getAnnotationStatistics() {
    if (this.props.isDatasetViewMode) return null;

    return <AnnotationStats stats={getCombinedStats(this.props.annotation)} asInfoBlock />;
  }

  getKeyboardShortcuts() {
    return this.props.isDatasetViewMode ? (
      <div className="info-tab-block">
        <Typography.Title level={5}>Keyboard Shortcuts</Typography.Title>
        <p>
          Find the complete list of shortcuts in the{" "}
          <a
            target="_blank"
            href="https://docs.webknossos.org/webknossos/keyboard_shortcuts.html"
            rel="noopener noreferrer"
          >
            documentation
          </a>
          .
        </p>
        <table className="shortcut-table">
          <tbody>
            {shortcuts.map((shortcut) => (
              <tr key={shortcut.key}>
                <td
                  style={{
                    width: 170,
                  }}
                >
                  {shortcut.keybinding}
                </td>
                <td>{shortcut.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : null;
  }

  getDatasetName() {
    const {
      name: datasetName,
      displayName,
      description: datasetDescription,
      owningOrganization,
    } = this.props.dataset;
    const { activeUser } = this.props;

    const getEditSettingsIcon = () =>
      mayUserEditDataset(activeUser, this.props.dataset) ? (
        <Tooltip title="Edit dataset settings">
          <Link
            to={`/datasets/${owningOrganization}/${datasetName}/edit`}
            style={{ paddingLeft: 3 }}
          >
            <Typography.Text type="secondary">
              <SettingOutlined />
            </Typography.Text>
          </Link>
        </Tooltip>
      ) : null;

    if (this.props.isDatasetViewMode) {
      return (
        <div className="info-tab-block">
          <div
            style={{
              wordWrap: "break-word",
            }}
          >
            <Typography.Title level={5} style={{ display: "initial" }}>
              {displayName || datasetName}
            </Typography.Title>
            {getEditSettingsIcon()}
          </div>
          {datasetDescription ? (
            <div
              style={{
                fontSize: 14,
              }}
            >
              <Markdown
                source={datasetDescription}
                options={{
                  html: false,
                  breaks: true,
                  linkify: true,
                }}
              />
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div className="info-tab-block">
        <p className="sidebar-label">Dataset {getEditSettingsIcon()}</p>
        <Link
          to={`/datasets/${owningOrganization}/${datasetName}/view`}
          title={`Click to view dataset ${datasetName} without annotation`}
          style={{
            wordWrap: "break-word",
          }}
        >
          {datasetName}
        </Link>
      </div>
    );
  }

  getAnnotationName() {
    if (this.props.isDatasetViewMode) return null;

    const annotationName = this.props.annotation.name || "[unnamed]";

    if (this.props.task != null) {
      // In case we have a task display its id
      return (
        <div className="info-tab-block">
          <p className="sidebar-label">Task ID</p>
          {this.props.task.id}
        </div>
      );
    }

    if (!this.props.mayEditAnnotation) {
      // For readonly annotations display the non-editable annotation name
      return (
        <div className="info-tab-block">
          <p className="sidebar-label">Annotation Name</p>
          {annotationName}
        </div>
      );
    }

    // Or display the editable annotation name
    return (
      <div className="info-tab-block">
        <p className="sidebar-label">Annotation Name</p>
        <Typography.Text editable={{ onChange: this.setAnnotationName }}>
          {annotationName}
        </Typography.Text>
      </div>
    );
  }
  getAnnotationDescription() {
    if (this.props.isDatasetViewMode) return null;

    const annotationDescription = this.props.annotation.description || "[no description]";
    const isDescriptionEmpty = this.props.annotation.description === "";
    const description = isDescriptionEmpty ? (
      annotationDescription
    ) : (
      <Markdown
        source={annotationDescription}
        container={"span"}
        options={{
          html: false,
          breaks: true,
          linkify: true,
        }}
      />
    );
    const buttonStylesForMarkdownRendering: CSSProperties = isDescriptionEmpty
      ? {}
      : {
          position: "absolute",
          right: 10,
          bottom: 0,
        };

    if (this.props.mayEditAnnotation) {
      return (
        <div className="info-tab-block">
          <p className="sidebar-label">Description</p>
          <div style={{ position: "relative" }}>
            <Typography.Text>
              {description}
              <Tooltip title="Edit">
                <div
                  role="button"
                  className="ant-typography-edit"
                  style={{
                    display: "inline-block",
                    ...buttonStylesForMarkdownRendering,
                  }}
                  onClick={() =>
                    this.setState({
                      isMarkdownModalOpen: true,
                    })
                  }
                >
                  <EditOutlined />
                </div>
              </Tooltip>
            </Typography.Text>
          </div>
          <MarkdownModal
            label="Annotation Description"
            placeholder="[No description]"
            source={this.props.annotation.description}
            isOpen={this.state.isMarkdownModalOpen}
            onOk={() => this.setState({ isMarkdownModalOpen: false })}
            onChange={this.setAnnotationDescription}
          />
        </div>
      );
    }

    return (
      <div className="info-tab-block">
        <p className="sidebar-label">Description</p>
        <Markdown
          source={annotationDescription}
          options={{
            html: false,
            breaks: true,
            linkify: true,
          }}
        />
      </div>
    );
  }

  maybePrintOrganization = () => {
    const { activeUser, dataset } = this.props;
    const owningOrganization = dataset.owningOrganization;
    if (activeUser?.organization === owningOrganization) return;
    return <OwningOrganizationRow organizationName={this.state.owningOrganizationDisplayName} />;
  };

  maybePrintOwnerAndContributors() {
    const { activeUser } = this.props;
    const { owner, contributors } = this.props.annotation;

    if (!owner) {
      return null;
    }

    const contributorTags =
      contributors.length > 0
        ? contributors.map((user) => (
            <Tag key={user.id} color="blue">
              {formatUserName(activeUser, user)}
            </Tag>
          ))
        : [
            <Tag key="None" color="blue">
              None
            </Tag>,
          ];

    return (
      <>
        <div className="info-tab-block">
          <p className="sidebar-label">Owner</p>
          <p>
            <Tag color="blue">{formatUserName(activeUser, owner)}</Tag>
          </p>
        </div>
        <div className="info-tab-block">
          <p className="sidebar-label">
            Contributors
            <Tooltip title='If other users edited this annotation, they will be listed here. You can allow other users to edit the annotation by opening the "Share" dialog from the dropdown menu.'>
              <InfoCircleOutlined
                style={{
                  marginLeft: 6,
                }}
              />
            </Tooltip>
          </p>
          <p>{contributorTags}</p>
        </div>
      </>
    );
  }

  getResolutionInfo() {
    const { dataset, annotation, activeResolutionInfo } = this.props;
    const { activeMagOfEnabledLayers, representativeResolution, isActiveResolutionGlobal } =
      activeResolutionInfo;

    const resolutionUnion = getResolutionUnion(dataset);
    return representativeResolution != null ? (
      <Tooltip
        title={
          <div>
            Rendered magnification per layer:
            <ul>
              {Object.entries(activeMagOfEnabledLayers).map(([layerName, mag]) => {
                const readableName = getReadableNameForLayerName(dataset, annotation, layerName);

                return (
                  <li key={layerName}>
                    {readableName}: {mag ? mag.join("-") : "none"}
                  </li>
                );
              })}
            </ul>
            Available resolutions:
            <ul>
              {resolutionUnion.map((mags) => (
                <li key={mags[0].join()}>{mags.map((mag) => mag.join("-")).join(", ")}</li>
              ))}
            </ul>
          </div>
        }
        placement="left"
      >
        <tr>
          <td
            style={{
              paddingRight: 4,
              paddingTop: 8,
            }}
          >
            <img
              className="info-tab-icon"
              src="/assets/images/icon-downsampling.svg"
              alt="Resolution"
            />
          </td>
          <td
            style={{
              paddingRight: 4,
              paddingTop: 8,
            }}
          >
            {representativeResolution.join("-")}
            {isActiveResolutionGlobal ? "" : "*"}{" "}
          </td>
        </tr>
      </Tooltip>
    ) : null;
  }

  render() {
    const { dataset } = this.props;

    return (
      <div className="flex-overflow padded-tab-content">
        {this.getAnnotationName()}
        {this.getAnnotationDescription()}
        {this.getDatasetName()}
        {this.maybePrintOrganization()}
        {this.maybePrintOwnerAndContributors()}

        <div className="info-tab-block">
          <p className="sidebar-label">Dimensions</p>
          <table
            style={{
              fontSize: 14,
              marginLeft: 4,
            }}
          >
            <tbody>
              <VoxelSizeRow dataset={dataset} />
              <DatasetExtentRow dataset={dataset} />
              {this.getResolutionInfo()}
            </tbody>
          </table>
        </div>

        {this.getAnnotationStatistics()}
        {this.getKeyboardShortcuts()}
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  annotation: state.tracing,
  dataset: state.dataset,
  task: state.task,
  activeUser: state.activeUser,
  isDatasetViewMode: state.temporaryConfiguration.controlMode === ControlModeEnum.VIEW,
  activeResolutionInfo: getActiveResolutionInfo(state),
  mayEditAnnotation: mayEditAnnotationProperties(state),
});

const mapDispatchToProps = (dispatch: Dispatch<any>) => ({
  setAnnotationName(annotationName: string) {
    dispatch(setAnnotationNameAction(annotationName));
  },

  setAnnotationDescription(comment: string) {
    dispatch(setAnnotationDescriptionAction(comment));
  },
});

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(DatasetInfoTabView);

import type { Dispatch } from "redux";
import { Typography, Tag } from "antd";
import { SettingOutlined, InfoCircleOutlined, EditOutlined } from "@ant-design/icons";
import { connect } from "react-redux";
import Markdown from "libs/markdown_adapter";
import React, { type CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { APIDataset, APIUser } from "types/api_flow_types";
import { ControlModeEnum } from "oxalis/constants";
import { formatScale } from "libs/format_utils";
import {
  getDatasetExtentAsString,
  getMagnificationUnion,
} from "oxalis/model/accessors/dataset_accessor";
import { getActiveMagInfo } from "oxalis/model/accessors/flycam_accessor";
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
import { mayUserEditDataset, pluralize, safeNumberToStr } from "libs/utils";
import { getReadableNameForLayerName } from "oxalis/model/accessors/volumetracing_accessor";
import { getOrganization } from "admin/admin_rest_api";
import { MarkdownModal } from "../components/markdown_modal";
import FastTooltip from "components/fast_tooltip";
import messages from "messages";

type StateProps = {
  annotation: Tracing;
  dataset: APIDataset;
  task: Task | null | undefined;
  activeUser: APIUser | null | undefined;
  activeMagInfo: ReturnType<typeof getActiveMagInfo>;
  isDatasetViewMode: boolean;
  mayEditAnnotation: boolean;
};
type DispatchProps = {
  setAnnotationName: (arg0: string) => void;
  setAnnotationDescription: (arg0: string) => void;
};
type Props = StateProps & DispatchProps;
type State = {
  owningOrganizationName: string | null;
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

export function DatasetExtentRow({ dataset }: { dataset: APIDataset }) {
  const extentInVoxel = getDatasetExtentAsString(dataset, true);
  const extentInLength = getDatasetExtentAsString(dataset, false);

  return (
    <FastTooltip title="Dataset extent" placement="left" wrapper="tr">
      <td
        style={{
          paddingRight: 20,
          paddingTop: 10,
        }}
      >
        <img className="info-tab-icon" src="/assets/images/icon-extent.svg" alt="Dataset extent" />
      </td>
      <td
        style={{
          paddingTop: 10,
        }}
      >
        {extentInVoxel}
        <br /> {extentInLength}
      </td>
    </FastTooltip>
  );
}

export function VoxelSizeRow({ dataset }: { dataset: APIDataset }) {
  return (
    <FastTooltip title="Dataset voxel size" placement="left" wrapper="tr">
      <td
        style={{
          paddingRight: 20,
        }}
      >
        <img className="info-tab-icon" src="/assets/images/icon-voxelsize.svg" alt="Voxel size" />
      </td>
      <td>{formatScale(dataset.dataSource.scale)}</td>
    </FastTooltip>
  );
}

export function OwningOrganizationRow({ organizationId }: { organizationId: string | null }) {
  return (
    <FastTooltip title="Organization" placement="left">
      <div className="info-tab-block">
        <p className="sidebar-label">Organization</p>
        <p>
          <Tag color="blue">{organizationId === null ? <i>loading...</i> : organizationId}</Tag>
        </p>
      </div>
    </FastTooltip>
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
  const styleWithSmallMargin = { margin: 2 };

  return (
    <div
      className="info-tab-block"
      style={useStyleWithMargin ? styleWithLargeMarginBottom : styleWithSmallMargin}
    >
      {asInfoBlock && <p className="sidebar-label">Statistics</p>}
      <table className={asInfoBlock ? "annotation-stats-table" : "annotation-stats-table-slim"}>
        <tbody>
          {"treeCount" in stats ? (
            <FastTooltip
              placement="left"
              html={`
                  <p>Trees: ${safeNumberToStr(stats.treeCount)}</p>
                  <p>Nodes: ${safeNumberToStr(stats.nodeCount)}</p>
                  <p>Edges: ${safeNumberToStr(stats.edgeCount)}</p>
                  <p>Branchpoints: ${safeNumberToStr(stats.branchPointCount)}</p>
                `}
              wrapper="tr"
            >
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
            </FastTooltip>
          ) : null}
          {"segmentCount" in stats ? (
            <FastTooltip
              placement="left"
              title={`${stats.segmentCount} ${pluralize("Segment", stats.segmentCount)} – Only segments that were manually registered (either brushed or
                                      interacted with) are counted in this statistic. Segmentation layers
                                      created from automated workflows (also known as fallback layers) are not
                                      considered currently.`}
              wrapper="tr"
            >
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
            </FastTooltip>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export class DatasetInfoTabView extends React.PureComponent<Props, State> {
  state: State = {
    isMarkdownModalOpen: false,
    owningOrganizationName: null,
  };

  setAnnotationName = (newName: string) => {
    this.props.setAnnotationName(newName);
  };

  componentDidMount(): void {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    const organization = await getOrganization(this.props.dataset.owningOrganization);
    this.setState({
      owningOrganizationName: organization.name,
    });
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
            href="https://docs.webknossos.org/webknossos/ui/keyboard_shortcuts.html"
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
        <FastTooltip title="Edit dataset settings">
          <Link
            to={`/datasets/${owningOrganization}/${datasetName}/edit`}
            style={{ paddingLeft: 3 }}
          >
            <Typography.Text type="secondary">
              <SettingOutlined />
            </Typography.Text>
          </Link>
        </FastTooltip>
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
              <Markdown>{datasetDescription}</Markdown>
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
      <Markdown>{annotationDescription}</Markdown>
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
              <FastTooltip title="Edit">
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
              </FastTooltip>
            </Typography.Text>
          </div>
          <MarkdownModal
            label="Annotation Description"
            placeholder="[No description]"
            source={this.props.annotation.description}
            isOpen={this.state.isMarkdownModalOpen}
            onOk={() => this.setState({ isMarkdownModalOpen: false })}
            onChange={this.props.setAnnotationDescription}
          />
        </div>
      );
    }

    return (
      <div className="info-tab-block">
        <p className="sidebar-label">Description</p>
        <Markdown>{annotationDescription}</Markdown>
      </div>
    );
  }

  maybePrintOrganization = () => {
    const { activeUser, dataset } = this.props;
    const owningOrganization = dataset.owningOrganization;
    if (activeUser?.organization === owningOrganization) return;
    return <OwningOrganizationRow organizationId={this.state.owningOrganizationName} />;
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
            <FastTooltip title='If other users edited this annotation, they will be listed here. You can allow other users to edit the annotation by opening the "Share" dialog from the dropdown menu.'>
              <InfoCircleOutlined
                style={{
                  marginLeft: 6,
                }}
              />
            </FastTooltip>
          </p>
          <p>{contributorTags}</p>
        </div>
      </>
    );
  }

  renderResolutionsTooltip = () => {
    const { dataset, annotation, activeMagInfo: activeResolutionInfo } = this.props;
    const { activeMagOfEnabledLayers } = activeResolutionInfo;
    const resolutionUnion = getMagnificationUnion(dataset);
    return (
      <div style={{ width: 200 }}>
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
        Available magnifications:
        <ul>
          {resolutionUnion.map((mags) => (
            <li key={mags[0].join()}>{mags.map((mag) => mag.join("-")).join(", ")}</li>
          ))}
        </ul>
        {messages["dataset.mag_explanation"]}
      </div>
    );
  };

  getResolutionInfo() {
    const { activeMagInfo: activeResolutionInfo } = this.props;
    const { representativeResolution, isActiveResolutionGlobal } = activeResolutionInfo;

    return representativeResolution != null ? (
      <FastTooltip dynamicRenderer={this.renderResolutionsTooltip} placement="left" wrapper="tr">
        <td
          style={{
            paddingRight: 4,
            paddingTop: 8,
          }}
        >
          <img
            className="info-tab-icon"
            src="/assets/images/icon-downsampling.svg"
            alt="Magnification"
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
      </FastTooltip>
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
  activeMagInfo: getActiveMagInfo(state),
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

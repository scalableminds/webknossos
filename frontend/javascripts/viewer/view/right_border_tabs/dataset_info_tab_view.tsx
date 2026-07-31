import Icon, {
  EditOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import IconDownsampling from "@images/icons/icon-downsampling.svg?react";
import IconExtent from "@images/icons/icon-extent.svg?react";
import IconMousewheel from "@images/icons/icon-mousewheel.svg?react";
import IconSegments from "@images/icons/icon-segments.svg?react";
import IconSkeletons from "@images/icons/icon-skeletons.svg?react";
import IconVoxelsize from "@images/icons/icon-voxelsize.svg?react";
import { getOrganization } from "admin/api/organization";
import { Space, Tag, Typography } from "antd";
import FastTooltip from "components/fast_tooltip";
import { ThemedIcon } from "components/themed_icon";
import { copyToClipboard } from "libs/clipboard";
import {
  formatNumberToVolume,
  formatScale,
  formatScaleForClipboard,
  formatVoxels,
} from "libs/format_utils";
import Markdown from "libs/markdown_adapter";
import { useWkSelector } from "libs/react_hooks";
import { mayUserEditDataset, pluralize, safeNumberToStr } from "libs/utils";
import memoizeOne from "memoize-one";
import messages from "messages";
import React, { type CSSProperties } from "react";
import { connect, useDispatch } from "react-redux";
import { Link } from "react-router-dom";
import type { Dispatch } from "redux";
import type { APIDataset, APIUser, APIUserBase } from "types/api_types";
import type { EmptyObject } from "types/type_utils";
import { WkDevFlags } from "viewer/api/wk_dev";
import constants, { ControlModeEnum, LongUnitToShortUnitMap } from "viewer/constants";
import { reuseInstanceOnEquality } from "viewer/model/accessors/accessor_helpers";
import {
  getSkeletonStats,
  getStats,
  getVolumeStats,
  mayEditAnnotationProperties,
  type TracingStats,
} from "viewer/model/accessors/annotation_accessor";
import {
  getDatasetExtentAsString,
  getDatasetExtentInUnitAsProduct,
  getDatasetExtentInVoxel,
  getDatasetExtentInVoxelAsProduct,
  getMagnificationUnion,
  getReadableURLPart,
  getViewDatasetURL,
} from "viewer/model/accessors/dataset_accessor";
import { getActiveMagInfo } from "viewer/model/accessors/flycam_accessor";
import { formatUserName } from "viewer/model/accessors/user_accessor";
import { getReadableNameForLayerName } from "viewer/model/accessors/volumetracing_accessor";
import {
  setAnnotationDescriptionAction,
  setAnnotationNameAction,
} from "viewer/model/actions/annotation_actions";
import { ensureHasNewestVersionAction } from "viewer/model/actions/save_actions";
import Store, { type Task, type WebknossosState } from "viewer/store";
import DomVisibilityObserver from "viewer/view/components/dom_visibility_observer";
import { KeyboardKeyIcon } from "../components/keyboard_key_icon";
import { MarkdownModal } from "../components/markdown_modal";
import type { KeyboardShortcutId } from "../keyboard_shortcuts/keyboard_shortcut_constants";
import type {
  KeyboardShortcutsMap,
  UnmodifiedLayoutMap,
} from "../keyboard_shortcuts/keyboard_shortcut_types";
import { keySequenceToUiElements } from "../keyboard_shortcuts/keyboard_shortcut_utils";

type StateProps = {
  annotationName: string;
  annotationDescription: string;
  annotationOwner: APIUserBase | null | undefined;
  annotationContributors: APIUserBase[];
  dataset: APIDataset;
  task: Task | null | undefined;
  activeUser: APIUser | null | undefined;
  isDatasetViewMode: boolean;
  isPlaneMode: boolean;
  mayEditAnnotation: boolean;
  keyboardShortcutsConfig: KeyboardShortcutsMap;
  unmodifiedLayoutMap: UnmodifiedLayoutMap;
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

type ShortcutInfo = {
  key: string;
  keybinding: React.ReactNode[];
  action: string;
};

const datasetInfoTabId = "dataset-info-tab";

// getStats iterates over all trees which can be expensive for large tracings.
// memoizeOne avoids recomputing while the annotation is unchanged, and
// reuseInstanceOnEquality keeps the result instance stable when a mutation
// did not change any of the counts (to avoid unnecessary re-renders).
const cachedGetStats = reuseInstanceOnEquality(memoizeOne(getStats));

const getShortcuts = (
  keyboardShortcutsConfig: KeyboardShortcutsMap,
  unmodifiedLayoutMap: UnmodifiedLayoutMap,
  isInPlaneMode: boolean,
): ShortcutInfo[] => {
  const toUiElement = (keyboardShortcutId: KeyboardShortcutId) =>
    (keyboardShortcutsConfig[keyboardShortcutId] ?? []).flatMap((keySeq, comboIndex) => {
      const capitalizedKeySeq = keySeq.map((keys) => keys.map((key) => key.toUpperCase()));
      return keySequenceToUiElements(
        capitalizedKeySeq,
        true,
        `${keyboardShortcutId}-${comboIndex}-`,
        unmodifiedLayoutMap,
      );
    });
  return [
    {
      key: "1",
      keybinding: [
        isInPlaneMode ? toUiElement("ZOOM_IN_PLANE") : toUiElement("ZOOM_IN_FLIGHT"),
        "/",
        isInPlaneMode ? toUiElement("ZOOM_OUT_PLANE") : toUiElement("ZOOM_OUT_FLIGHT"),

        "or",
        <KeyboardKeyIcon label="ALT" key="zoom-3" className="keyboard-key-icon" />,
        "+",

        <Icon
          component={IconMousewheel}
          key="zoom-4"
          className="keyboard-mouse-icon"
          aria-label="Mouse Wheel"
          title="Mouse Wheel"
          style={{ color: "var(--ant-color-primary)" }}
        />,
      ],
      action: "Zoom in/out",
    },
    {
      key: "2",
      keybinding: [
        <Icon
          component={IconMousewheel}
          key="move-1"
          className="keyboard-mouse-icon"
          aria-label="Mouse Wheel"
          title="Mouse Wheel"
          style={{ color: "var(--ant-color-primary)" }}
        />,
        "or",
        isInPlaneMode
          ? toUiElement("MOVE_ONE_BACKWARD_DIRECTION_AWARE")
          : toUiElement("MOVE_BACKWARD_WITHOUT_RECORDING"),
        "/",
        isInPlaneMode
          ? toUiElement("MOVE_ONE_FORWARD_DIRECTION_AWARE")
          : toUiElement("MOVE_FORWARD_WITHOUT_RECORDING"),
      ],
      action: "Move Along 3rd Axis",
    },
    {
      key: "3",
      keybinding: [
        <ThemedIcon
          name="icon-mouse-left"
          key="move"
          className="keyboard-mouse-icon"
          aria-label="Left Mouse Button Drag"
          style={{ color: "var(--ant-color-primary)" }}
        />,
      ],
      action: "Move",
    },
    {
      key: "4",
      keybinding: [
        <ThemedIcon
          name="icon-mouse-right"
          key="rotate"
          className="keyboard-mouse-icon"
          aria-label="Right Mouse Button Drag"
          style={{ color: "var(--ant-color-primary)" }}
        />,
        "in 3D View",
      ],
      action: "Rotate 3D View",
    },
  ];
};

export function DatasetExtentRow({ dataset }: { dataset: APIDataset }) {
  const extentInVoxel = getDatasetExtentAsString(dataset, true);
  const extentInLength = getDatasetExtentAsString(dataset, false);
  const extentProductInVx = getDatasetExtentInVoxelAsProduct(dataset);
  const extentProductInUnit = getDatasetExtentInUnitAsProduct(dataset);
  const formattedExtentInUnit = formatNumberToVolume(
    extentProductInUnit,
    LongUnitToShortUnitMap[dataset.dataSource.scale.unit],
  );

  const renderDSExtentTooltip = () => {
    return (
      <div>
        Dataset extent:
        <br />
        {formatVoxels(extentProductInVx)}
        <br />
        {formattedExtentInUnit}
      </div>
    );
  };

  const copyExtentToClipboard = () => {
    const { width, height, depth } = getDatasetExtentInVoxel(dataset);
    copyToClipboard(`${width},${height},${depth}`, "dataset extent", true);
  };

  return (
    <FastTooltip
      dynamicRenderer={renderDSExtentTooltip}
      placement="left"
      wrapper="tr"
      key={dataset.id}
    >
      <td
        style={{
          paddingRight: 20,
          paddingTop: 10,
        }}
      >
        <Icon component={IconExtent} className="info-tab-icon" aria-label="Dataset extent" />
      </td>
      <td
        style={{
          paddingTop: 10,
        }}
        onClick={copyExtentToClipboard}
      >
        {extentInVoxel}
        <br /> {extentInLength}
      </td>
    </FastTooltip>
  );
}

export function VoxelSizeRow({ dataset }: { dataset: APIDataset }) {
  const copyVoxelSizeToClipboard = () => {
    copyToClipboard(formatScaleForClipboard(dataset.dataSource.scale), "dataset voxel size", true);
  };

  return (
    <FastTooltip title="Dataset voxel size" placement="left" wrapper="tr">
      <td
        style={{
          paddingRight: 20,
        }}
      >
        <Icon component={IconVoxelsize} className="info-tab-icon" aria-label="Voxel size" />
      </td>
      <td onClick={copyVoxelSizeToClipboard}>{formatScale(dataset.dataSource.scale)}</td>
    </FastTooltip>
  );
}

export function OwningOrganizationRow({ organizationId }: { organizationId: string | null }) {
  return (
    <FastTooltip title="Organization" placement="left">
      <div className="info-tab-block">
        <p className="sidebar-label">Organization</p>
        <p>
          <Tag color="blue" variant="outlined">
            {organizationId === null ? <i>loading...</i> : organizationId}
          </Tag>
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
  stats: TracingStats | EmptyObject;
  asInfoBlock: boolean;
  withMargin?: boolean | null | undefined;
}) {
  if (!stats || Object.keys(stats).length === 0) return null;
  const formatLabel = (str: string) => (asInfoBlock ? str : "");
  const useStyleWithMargin = withMargin != null ? withMargin : true;
  const styleWithLargeMarginBottom = { marginBottom: 14 };
  const styleWithSmallMargin = { margin: 2 };
  const skeletonStats = getSkeletonStats(stats);
  const volumeStats = getVolumeStats(stats);
  const totalSegmentCount = volumeStats.reduce((sum, [_, volume]) => sum + volume.segmentCount, 0);

  return (
    <div
      className="info-tab-block"
      style={useStyleWithMargin ? styleWithLargeMarginBottom : styleWithSmallMargin}
    >
      {asInfoBlock && <p className="sidebar-label">Statistics</p>}
      <table className={asInfoBlock ? "annotation-stats-table" : "annotation-stats-table-slim"}>
        <tbody>
          {skeletonStats ? (
            <FastTooltip
              placement="left"
              html={`
                  <p>Trees: ${safeNumberToStr(skeletonStats.treeCount)}</p>
                  <p>Nodes: ${safeNumberToStr(skeletonStats.nodeCount)}</p>
                  <p>Edges: ${safeNumberToStr(skeletonStats.edgeCount)}</p>
                  <p>Branchpoints: ${safeNumberToStr(skeletonStats.branchPointCount)}</p>
                `}
              wrapper="tr"
            >
              <td>
                <Icon component={IconSkeletons} className="info-tab-icon" aria-label="Skeletons" />
              </td>
              <td>
                {skeletonStats.treeCount} {formatLabel(pluralize("Tree", skeletonStats.treeCount))}
              </td>
            </FastTooltip>
          ) : null}
          {volumeStats.length > 0 ? (
            <FastTooltip
              placement="left"
              html={`${totalSegmentCount}
                      Only segments that were manually registered (either brushed or
                      interacted with) are counted in this statistic. Segmentation layers
                      created from automated workflows (also known as fallback layers) are not
                      considered currently.`}
              wrapper="tr"
            >
              <td>
                <Icon component={IconSegments} className="info-tab-icon" aria-label="Segments" />
              </td>
              <td>
                {totalSegmentCount} {formatLabel(pluralize("Segment", totalSegmentCount))}
              </td>
            </FastTooltip>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function AnnotationStatisticsSection() {
  const stats = useWkSelector((state) => cachedGetStats(state.annotation));
  return <AnnotationStats stats={stats} asInfoBlock />;
}

function MagInfoRow() {
  const activeMagInfo = useWkSelector(getActiveMagInfo);
  const dataset = useWkSelector((state) => state.dataset);
  const { representativeMag, isActiveMagGlobal, activeMagOfEnabledLayers } = activeMagInfo;

  const renderMagsTooltip = () => {
    // The annotation is read lazily when the tooltip is actually rendered
    // (i.e., on hover) so that this row doesn't need to subscribe to (and
    // re-render on) every annotation mutation.
    const { annotation } = Store.getState();
    const magUnion = getMagnificationUnion(dataset);
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
          {magUnion.map((mags) => (
            <li key={mags[0].join()}>{mags.map((mag) => mag.join("-")).join(", ")}</li>
          ))}
        </ul>
        {messages["dataset.mag_explanation"]}
      </div>
    );
  };

  return representativeMag != null ? (
    <FastTooltip dynamicRenderer={renderMagsTooltip} placement="left" wrapper="tr">
      <td
        style={{
          paddingRight: 4,
          paddingTop: 8,
        }}
      >
        <Icon component={IconDownsampling} className="info-tab-icon" aria-label="Magnification" />
      </td>
      <td
        style={{
          paddingRight: 4,
          paddingTop: 8,
        }}
      >
        {representativeMag.join("-")}
        {isActiveMagGlobal ? "" : "*"}{" "}
      </td>
    </FastTooltip>
  ) : null;
}

class DatasetInfoTabView extends React.PureComponent<Props, State> {
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

    return <AnnotationStatisticsSection />;
  }

  getKeyboardShortcuts() {
    const { isDatasetViewMode, keyboardShortcutsConfig, unmodifiedLayoutMap, isPlaneMode } =
      this.props;
    return isDatasetViewMode ? (
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
        <table className="shortcut-table-info-tab">
          <tbody>
            {getShortcuts(keyboardShortcutsConfig, unmodifiedLayoutMap, isPlaneMode).map(
              (shortcut) => (
                <tr key={shortcut.key}>
                  <td
                    style={{
                      width: 170,
                    }}
                  >
                    <Space size={4} align="center">
                      {shortcut.keybinding}
                    </Space>
                  </td>
                  <td>{shortcut.action}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    ) : null;
  }

  getDatasetName() {
    const { activeUser, dataset, isDatasetViewMode } = this.props;
    const { name: datasetName, description: datasetDescription } = dataset;

    const getEditSettingsIcon = () =>
      mayUserEditDataset(activeUser, this.props.dataset) ? (
        <FastTooltip title="Edit dataset settings">
          <Link to={`/datasets/${getReadableURLPart(dataset)}/edit`} style={{ paddingLeft: 3 }}>
            <Typography.Text type="secondary">
              <SettingOutlined />
            </Typography.Text>
          </Link>
        </FastTooltip>
      ) : null;

    if (isDatasetViewMode) {
      return (
        <div className="info-tab-block">
          <div
            style={{
              wordWrap: "break-word",
            }}
          >
            <Typography.Title level={5} style={{ display: "initial" }}>
              {datasetName}
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
          to={getViewDatasetURL(dataset)}
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

    const annotationName = this.props.annotationName || "[unnamed]";

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

    const annotationDescription = this.props.annotationDescription || "[no description]";
    const isDescriptionEmpty = this.props.annotationDescription === "";
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
                {/* biome-ignore lint/a11y/useFocusableInteractive: don't use <button> to not mess with its default styles */}
                {/* biome-ignore lint/a11y/useSemanticElements: don't use <button> to not mess with its default styles */}
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
            source={this.props.annotationDescription}
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
    const { activeUser, annotationOwner: owner, annotationContributors: contributors } = this.props;

    if (!owner) {
      return null;
    }

    const contributorTags =
      contributors.length > 0
        ? contributors.map((user) => (
            <Tag key={user.id} color="blue" variant="outlined">
              {formatUserName(activeUser, user)}
            </Tag>
          ))
        : [
            <Tag key="None" color="blue" variant="outlined">
              None
            </Tag>,
          ];

    return (
      <>
        <div className="info-tab-block">
          <p className="sidebar-label">Owner</p>
          <p>
            <Tag color="blue" variant="outlined">
              {formatUserName(activeUser, owner)}
            </Tag>
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
          <div>
            <Space size={4} wrap>
              {contributorTags}
            </Space>
          </div>
        </div>
      </>
    );
  }

  render() {
    const { dataset } = this.props;

    return (
      <div id={datasetInfoTabId} className="flex-overflow padded-tab-content">
        <DomVisibilityObserver targetId={datasetInfoTabId}>
          {(isVisibleInDom) => {
            // Skip rendering entirely while the tab is hidden, except when the
            // markdown modal is open (it would disappear otherwise).
            if (!isVisibleInDom && !this.state.isMarkdownModalOpen) {
              return null;
            }

            return (
              <React.Fragment>
                {WkDevFlags.debugging.showCurrentVersionInInfoTab && <DebugInfo />}
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
                      <MagInfoRow />
                    </tbody>
                  </table>
                </div>

                {this.getAnnotationStatistics()}
                {this.getKeyboardShortcuts()}
              </React.Fragment>
            );
          }}
        </DomVisibilityObserver>
      </div>
    );
  }
}

function DebugInfo() {
  const dispatch = useDispatch();
  const versionOnClient = useWkSelector((state) => {
    return state.annotation.version;
  });
  return (
    <>
      Version: {versionOnClient}
      <ReloadOutlined onClick={() => dispatch(ensureHasNewestVersionAction(() => {}))} />{" "}
    </>
  );
}

const mapStateToProps = (state: WebknossosState): StateProps => ({
  annotationName: state.annotation.name,
  annotationDescription: state.annotation.description,
  annotationOwner: state.annotation.owner,
  annotationContributors: state.annotation.contributors,
  dataset: state.dataset,
  task: state.task,
  activeUser: state.activeUser,
  isDatasetViewMode: state.temporaryConfiguration.controlMode === ControlModeEnum.VIEW,
  isPlaneMode: constants.MODES_PLANE.includes(state.temporaryConfiguration.viewMode),
  keyboardShortcutsConfig: state.keyboardConfiguration.shortcutsConfig,
  unmodifiedLayoutMap: state.keyboardConfiguration.unmodifiedLayoutMap,
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

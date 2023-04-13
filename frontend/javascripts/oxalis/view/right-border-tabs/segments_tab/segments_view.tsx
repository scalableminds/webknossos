import { AutoSizer } from "react-virtualized";
import {
  Button,
  ConfigProvider,
  List,
  Tooltip,
  Select,
  Popover,
  Empty,
  TreeProps,
  Tree,
  Dropdown,
  MenuProps,
} from "antd";
import type { Dispatch } from "redux";
import {
  LoadingOutlined,
  ReloadOutlined,
  SettingOutlined,
  PlusOutlined,
  DownOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { connect, useSelector } from "react-redux";
import React from "react";
import _ from "lodash";
import memoizeOne from "memoize-one";
import type { APISegmentationLayer, APIUser, APIDataset, APIMeshFile } from "types/api_flow_types";
import type { Vector3 } from "oxalis/constants";
import { MappingStatusEnum } from "oxalis/constants";
import {
  loadAdHocMeshAction,
  loadPrecomputedMeshAction,
} from "oxalis/model/actions/segmentation_actions";
import {
  maybeFetchMeshFilesAction,
  updateCurrentMeshFileAction,
} from "oxalis/model/actions/annotation_actions";
import {
  getActiveSegmentationTracing,
  getVisibleSegments,
  hasEditableMapping,
} from "oxalis/model/accessors/volumetracing_accessor";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import { getSegmentIdForPosition } from "oxalis/controller/combinations/volume_handlers";
import {
  getVisibleSegmentationLayer,
  getResolutionInfoOfVisibleSegmentationLayer,
  getMappingInfo,
  ResolutionInfo,
} from "oxalis/model/accessors/dataset_accessor";
import { getBaseSegmentationName } from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import { setPositionAction } from "oxalis/model/actions/flycam_actions";
import { startComputeMeshFileJob, getJobs } from "admin/admin_rest_api";
import { updateTemporarySettingAction } from "oxalis/model/actions/settings_actions";
import {
  updateSegmentAction,
  setActiveCellAction,
  removeSegmentAction,
  setSegmentGroupsAction,
} from "oxalis/model/actions/volumetracing_actions";
import DataLayer from "oxalis/model/data_layer";
import DomVisibilityObserver from "oxalis/view/components/dom_visibility_observer";
import { Model } from "oxalis/singletons";
import SegmentListItem from "oxalis/view/right-border-tabs/segments_tab/segment_list_item";
import type {
  ActiveMappingInfo,
  Flycam,
  IsosurfaceInformation,
  OxalisState,
  Segment,
  SegmentGroup,
  SegmentMap,
} from "oxalis/store";
import Store from "oxalis/store";
import Toast from "libs/toast";
import features from "features";
import {
  getFeatureNotAvailableInPlanMessage,
  isFeatureAllowedByPricingPlan,
  PricingPlanEnum,
} from "admin/organization/pricing_plan_utils";
import { DataNode } from "antd/lib/tree";
import {
  callDeep,
  createGroupToSegmentsMap,
  findGroup,
  findParentIdForGroupId,
  MISSING_GROUP_ID,
} from "../tree_hierarchy_view_helpers";
import { getMaximumGroupId } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import { mapGroups } from "oxalis/model/accessors/skeletontracing_accessor";

const { Option } = Select;
// Interval in ms to check for running mesh file computation jobs for this dataset
const refreshInterval = 5000;

export const stlIsosurfaceConstants = {
  isosurfaceMarker: [105, 115, 111],
  // ASCII codes for ISO
  segmentIdIndex: 3, // Write cell index after the isosurfaceMarker
};
const segmentsTabId = "segment-list";

type StateProps = {
  isosurfaces: Record<number, IsosurfaceInformation>;
  dataset: APIDataset;
  isJSONMappingEnabled: boolean;
  mappingInfo: ActiveMappingInfo;
  flycam: Flycam;
  hasVolumeTracing: boolean;
  hoveredSegmentId: number | null | undefined;
  segments: SegmentMap | null | undefined;
  segmentGroups: Array<SegmentGroup>;
  visibleSegmentationLayer: APISegmentationLayer | null | undefined;
  allowUpdate: boolean;
  organization: string;
  datasetName: string;
  availableMeshFiles: Array<APIMeshFile> | null | undefined;
  currentMeshFile: APIMeshFile | null | undefined;
  activeUser: APIUser | null | undefined;
  activeCellId: number | null | undefined;
  preferredQualityForMeshPrecomputation: number;
  preferredQualityForMeshAdHocComputation: number;
  resolutionInfoOfVisibleSegmentationLayer: ResolutionInfo;
};

const mapStateToProps = (state: OxalisState): StateProps => {
  const visibleSegmentationLayer = getVisibleSegmentationLayer(state);
  const activeVolumeTracing = getActiveSegmentationTracing(state);
  const mappingInfo = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    visibleSegmentationLayer?.name,
  );

  const { segments, segmentGroups } = getVisibleSegments(state);

  return {
    activeCellId: activeVolumeTracing?.activeCellId,
    isosurfaces:
      visibleSegmentationLayer != null
        ? state.localSegmentationData[visibleSegmentationLayer.name].isosurfaces
        : {},
    dataset: state.dataset,
    isJSONMappingEnabled:
      mappingInfo.mappingStatus === MappingStatusEnum.ENABLED && mappingInfo.mappingType === "JSON",
    mappingInfo,
    flycam: state.flycam,
    hasVolumeTracing: state.tracing.volumes.length > 0,
    hoveredSegmentId: state.temporaryConfiguration.hoveredSegmentId,
    segments,
    segmentGroups,
    visibleSegmentationLayer,
    allowUpdate: state.tracing.restrictions.allowUpdate,
    organization: state.dataset.owningOrganization,
    datasetName: state.dataset.name,
    availableMeshFiles:
      visibleSegmentationLayer != null
        ? state.localSegmentationData[visibleSegmentationLayer.name].availableMeshFiles
        : null,
    currentMeshFile:
      visibleSegmentationLayer != null
        ? state.localSegmentationData[visibleSegmentationLayer.name].currentMeshFile
        : null,
    activeUser: state.activeUser,
    preferredQualityForMeshPrecomputation:
      state.temporaryConfiguration.preferredQualityForMeshPrecomputation,
    preferredQualityForMeshAdHocComputation:
      state.temporaryConfiguration.preferredQualityForMeshAdHocComputation,
    resolutionInfoOfVisibleSegmentationLayer: getResolutionInfoOfVisibleSegmentationLayer(state),
  };
};

const mapDispatchToProps = (dispatch: Dispatch<any>) => ({
  setHoveredSegmentId(segmentId: number | null | undefined) {
    dispatch(updateTemporarySettingAction("hoveredSegmentId", segmentId || null));
  },

  loadAdHocMesh(segmentId: number, seedPosition: Vector3) {
    dispatch(loadAdHocMeshAction(segmentId, seedPosition));
  },

  loadPrecomputedMesh(segmentId: number, seedPosition: Vector3, meshFileName: string) {
    dispatch(loadPrecomputedMeshAction(segmentId, seedPosition, meshFileName));
  },

  setActiveCell(segmentId: number, somePosition?: Vector3) {
    dispatch(setActiveCellAction(segmentId, somePosition));
  },

  setCurrentMeshFile(layerName: string, fileName: string) {
    dispatch(updateCurrentMeshFileAction(layerName, fileName));
  },

  setPosition(position: Vector3) {
    dispatch(setPositionAction(position));
  },

  updateSegment(
    segmentId: number,
    segmentShape: Partial<Segment>,
    layerName: string,
    createsNewUndoState: boolean,
  ) {
    dispatch(
      updateSegmentAction(segmentId, segmentShape, layerName, undefined, createsNewUndoState),
    );
  },

  removeSegment(segmentId: number, layerName: string) {
    dispatch(removeSegmentAction(segmentId, layerName));
  },

  onUpdateSegmentGroups(segmentGroups: SegmentGroup[], layerName: string) {
    dispatch(setSegmentGroupsAction(segmentGroups, layerName));
  },
});

type DispatchProps = ReturnType<typeof mapDispatchToProps>;
type Props = DispatchProps & StateProps;
type State = {
  selectedSegmentId: number | null | undefined;
  activeMeshJobId: string | null | undefined;
  activeDropdownSegmentId: number | null | undefined;
  groupTree: TreeNode[];
  prevProps: Props | null | undefined;
};

const formatMagWithLabel = (mag: Vector3, index: number) => {
  // index refers to the array of available mags. Thus, we can directly
  // use that index to pick an adequate label.
  const labels = ["Highest", "High", "Medium", "Low", "Very Low"];
  // Use "Very Low" for all low Mags which don't have extra labels
  const clampedIndex = Math.min(labels.length - 1, index);
  return `${labels[clampedIndex]} (Mag ${mag.join("-")})`;
};

const formatMeshFile = (meshFile: APIMeshFile | null | undefined): string | null | undefined => {
  if (meshFile == null) return null;
  if (meshFile.mappingName == null) return meshFile.meshFileName;
  return `${meshFile.meshFileName} (${meshFile.mappingName})`;
};

function _getMapIdFn(visibleSegmentationLayer: APISegmentationLayer | null | undefined) {
  const dataLayer =
    visibleSegmentationLayer != null ? Model.getLayerByName(visibleSegmentationLayer.name) : null;

  const mapId = dataLayer != null ? (id: number) => dataLayer.cube.mapId(id) : (id: number) => id;
  return mapId;
}

const getMapIdFn = memoizeOne(_getMapIdFn);

function renderEmptyMeshFileSelect() {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="No mesh file found. Click the + icon to compute a mesh file."
    />
  );
}

type SegmentOrGroup = "segment" | "group";

export type TreeNode =
  | (Segment & {
      type: "segment";
      key: string;
    })
  | {
      type: "group";
      name: string | null | undefined;
      id: number;
      key: string;
      // timestamp: number;
      children: Array<TreeNode>;
    };

function constructTreeData(
  groups: { name: string; groupId: number; children: SegmentGroup[] }[],
  groupToTreesMap: Record<number, Segment[]>,
  expandedGroupIds: {},
  _arg3: string,
): TreeNode[] {
  // return {
  //   key: "string",
  //   children: [],
  // };

  // Insert all trees into their respective groups in the group hierarchy and transform groups to tree nodes
  return groups.map((group) => {
    const { groupId } = group;
    const segments = groupToTreesMap[groupId] || [];
    const treeNode: TreeNode = {
      ...group,
      key: `group-${groupId}`,
      id: groupId,
      type: "group",
      // Ensure that groups are always at the top when sorting by timestamp
      // timestamp: 0,
      // treeNode.children = _.orderBy(treeNode.children, ["name"], ["asc"]).concat(segments);
      children: constructTreeData(
        group.children,
        groupToTreesMap,
        expandedGroupIds,
        "sortBy",
      ).concat(
        segments.map(
          (segment): TreeNode => ({
            ...segment,
            type: "segment",
            key: `segment-${segment.id}`,
            id: segment.id,
          }),
        ),
      ),
    };

    // Groups are always sorted by name and appear before the trees, trees are sorted according to the sortBy prop

    // treeNode.isChecked = _.every(
    //   treeNode.children, // Groups that don't contain any trees should not influence the state of their parents
    //   (groupOrTree) => groupOrTree.isChecked || !groupOrTree.containsTrees,
    // );
    // treeNode.isIndeterminate = treeNode.isChecked
    //   ? false
    //   : _.some(
    //       treeNode.children, // Groups that don't contain any trees should not influence the state of their parents
    //       (groupOrTree) =>
    //         (groupOrTree.isChecked || groupOrTree.isIndeterminate) && groupOrTree.containsTrees,
    //     );
    // treeNode.containsTrees =
    //   trees.length > 0 || _.some(treeNode.children, (groupOrTree) => groupOrTree.containsTrees);
    return treeNode;
  });
}

class SegmentsView extends React.Component<Props, State> {
  intervalID: ReturnType<typeof setTimeout> | null | undefined;
  state: State = {
    selectedSegmentId: null,
    activeMeshJobId: null,
    activeDropdownSegmentId: null,
    groupTree: [],
    prevProps: null,
  };

  componentDidMount() {
    Store.dispatch(
      maybeFetchMeshFilesAction(this.props.visibleSegmentationLayer, this.props.dataset, false),
    );

    if (features().jobsEnabled) {
      this.pollJobData();
    }
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.visibleSegmentationLayer !== this.props.visibleSegmentationLayer) {
      Store.dispatch(
        maybeFetchMeshFilesAction(this.props.visibleSegmentationLayer, this.props.dataset, false),
      );
    }
  }

  componentWillUnmount() {
    if (this.intervalID != null) {
      clearTimeout(this.intervalID);
    }
  }

  static getDerivedStateFromProps(nextProps: Props, prevState: State) {
    // if (prevState.prevProps == null || didTreeDataChange(prevState.prevProps, nextProps)) {
    // Insert the trees into the corresponding groups and create a
    // groupTree object that can be rendered using a SortableTree component
    const { segments, segmentGroups } = nextProps;
    if (
      segments != null &&
      (prevState.prevProps?.segments !== segments ||
        prevState.prevProps?.segmentGroups !== segmentGroups)
    ) {
      const groupToTreesMap = createGroupToSegmentsMap(segments);
      const rootGroup = {
        name: "Root",
        groupId: MISSING_GROUP_ID,
        key: MISSING_GROUP_ID,
        children: nextProps.segmentGroups,
      };

      // const expandedGroupIds = _.cloneDeep(prevState.expandedGroupIds);
      const expandedGroupIds = {};

      const generatedGroupTree = constructTreeData(
        [rootGroup],
        groupToTreesMap,
        expandedGroupIds,
        "id", // nextProps.sortBy,
      );
      return {
        groupTree: generatedGroupTree,
        expandedGroupIds,
        prevProps: nextProps,
      };
    } else {
      return {
        prevProps: nextProps,
      };
    }
  }

  async pollJobData(): Promise<void> {
    const jobs = this.props.activeUser != null ? await getJobs() : [];
    const oldActiveJobId = this.state.activeMeshJobId;
    const meshJobsForDataset = jobs.filter(
      (job) => job.type === "compute_mesh_file" && job.datasetName === this.props.datasetName,
    );
    const activeJob =
      oldActiveJobId != null ? meshJobsForDataset.find((job) => job.id === oldActiveJobId) : null;

    if (activeJob != null) {
      // We are aware of a running mesh job. Check whether the job is finished now.
      switch (activeJob.state) {
        case "SUCCESS": {
          Toast.success(
            'The computation of a mesh file for this dataset has finished. You can now use the "Load Mesh (precomputed)" functionality in the context menu.',
          );
          this.setState({
            activeMeshJobId: null,
          });
          // maybeFetchMeshFiles will fetch the new mesh file and also activate it if no other mesh file
          // currently exists.
          Store.dispatch(
            maybeFetchMeshFilesAction(
              this.props.visibleSegmentationLayer,
              this.props.dataset,
              true,
            ),
          );
          break;
        }

        case "STARTED":
        case "UNKNOWN":
        case "PENDING": {
          break;
        }

        case "FAILURE": {
          Toast.info("The computation of a mesh file for this dataset didn't finish properly.");
          this.setState({
            activeMeshJobId: null,
          });
          break;
        }

        case "MANUAL": {
          Toast.info(
            "The computation of a mesh file for this dataset didn't finish properly. The job will be handled by an admin shortly. Please check back here soon.",
          );
          this.setState({
            activeMeshJobId: null,
          });
          break;
        }

        default: {
          break;
        }
      }
    } else {
      // Check whether there is an active mesh job (e.g., the user
      // started the job earlier and reopened WEBKNOSSOS in the meantime).
      const pendingJobs = meshJobsForDataset.filter(
        (job) => job.state === "STARTED" || job.state === "PENDING",
      );
      const activeMeshJobId = pendingJobs.length > 0 ? pendingJobs[0].id : null;
      this.setState({
        activeMeshJobId,
      });
    }

    // refresh according to the refresh interval
    this.intervalID = setTimeout(() => this.pollJobData(), refreshInterval);
  }

  getPrecomputeMeshesTooltipInfo = () => {
    let title = "";
    let disabled = true;

    const activeOrganization = useSelector((state: OxalisState) => state.activeOrganization);
    const activeUser = useSelector((state: OxalisState) => state.activeUser);
    if (!isFeatureAllowedByPricingPlan(activeOrganization, PricingPlanEnum.Team)) {
      return {
        disabled: true,
        title: getFeatureNotAvailableInPlanMessage(
          PricingPlanEnum.Team,
          activeOrganization,
          activeUser,
        ),
      };
    }

    if (!features().jobsEnabled) {
      title = "Computation jobs are not enabled for this WEBKNOSSOS instance.";
    } else if (this.props.activeUser == null) {
      title = "Please log in to precompute the meshes of this dataset.";
    } else if (!this.props.dataset.jobsEnabled) {
      title =
        "Meshes Computation is not supported for datasets that are not natively hosted on the server. Upload your dataset directly to weknossos.org to enable this feature.";
    } else if (this.props.hasVolumeTracing) {
      title = this.props.visibleSegmentationLayer?.fallbackLayer
        ? "Meshes cannot be precomputed for volume annotations. However, you can open this dataset in view mode to precompute meshes for the dataset's segmentation layer."
        : "Meshes cannot be precomputed for volume annotations.";
    } else if (this.props.visibleSegmentationLayer == null) {
      title = "There is no segmentation layer for which meshes could be precomputed.";
    } else {
      title =
        "Precompute meshes for all segments of this dataset so that meshes for segments can be loaded quickly afterwards from a mesh file.";
      disabled = false;
    }

    return {
      disabled,
      title,
    };
  };

  onSelectSegment = (segment: Segment) => {
    this.setState({
      selectedSegmentId: segment.id,
    });

    if (!segment.somePosition) {
      Toast.info(
        <React.Fragment>
          Cannot go to this segment, because its position is unknown.
        </React.Fragment>,
      );
      return;
    }
    this.props.setPosition(segment.somePosition);
  };

  handleSegmentDropdownMenuVisibility = (segmentId: number, isVisible: boolean) => {
    if (isVisible) {
      this.setState({
        activeDropdownSegmentId: segmentId,
      });
      return;
    }

    this.setState({
      activeDropdownSegmentId: null,
    });
  };

  startComputingMeshfile = async () => {
    const {
      mappingInfo,
      preferredQualityForMeshPrecomputation,
      resolutionInfoOfVisibleSegmentationLayer: datasetResolutionInfo,
    } = this.props;
    const defaultOrHigherIndex = datasetResolutionInfo.getIndexOrClosestHigherIndex(
      preferredQualityForMeshPrecomputation,
    );
    const meshfileResolutionIndex =
      defaultOrHigherIndex != null
        ? defaultOrHigherIndex
        : datasetResolutionInfo.getClosestExistingIndex(preferredQualityForMeshPrecomputation);
    const meshfileResolution = datasetResolutionInfo.getResolutionByIndexWithFallback(
      meshfileResolutionIndex,
      null,
    );

    if (this.props.visibleSegmentationLayer != null) {
      const isEditableMapping = hasEditableMapping(
        Store.getState(),
        this.props.visibleSegmentationLayer.name,
      );

      const maybeMappingName =
        !isEditableMapping &&
        mappingInfo.mappingStatus !== MappingStatusEnum.DISABLED &&
        mappingInfo.mappingType === "HDF5" &&
        mappingInfo.mappingName != null
          ? mappingInfo.mappingName
          : undefined;

      const job = await startComputeMeshFileJob(
        this.props.organization,
        this.props.datasetName,
        getBaseSegmentationName(this.props.visibleSegmentationLayer),
        meshfileResolution,
        maybeMappingName,
      );
      this.setState({
        activeMeshJobId: job.id,
      });
      Toast.info(
        <React.Fragment>
          The computation of a mesh file was started. For large datasets, this may take a while.
          Closing this tab will not stop the computation.
          <br />
          See{" "}
          <a target="_blank" href="/jobs" rel="noopener noreferrer">
            Processing Jobs
          </a>{" "}
          for an overview of running jobs.
        </React.Fragment>,
      );
    } else {
      Toast.error(
        "The computation of a mesh file could not be started because no segmentation layer was found.",
      );
    }
  };

  handleMeshFileSelected = async (meshFileName: string) => {
    if (this.props.visibleSegmentationLayer != null && meshFileName != null) {
      this.props.setCurrentMeshFile(this.props.visibleSegmentationLayer.name, meshFileName);
    }
  };

  handleQualityChangeForPrecomputation = (resolutionIndex: number) =>
    Store.dispatch(
      updateTemporarySettingAction("preferredQualityForMeshPrecomputation", resolutionIndex),
    );

  handleQualityChangeForAdHocGeneration = (resolutionIndex: number) =>
    Store.dispatch(
      updateTemporarySettingAction("preferredQualityForMeshAdHocComputation", resolutionIndex),
    );

  getAdHocMeshSettings = () => {
    const {
      preferredQualityForMeshAdHocComputation,
      resolutionInfoOfVisibleSegmentationLayer: datasetResolutionInfo,
    } = this.props;
    return (
      <div>
        <Tooltip title="The higher the quality, the more computational resources are required">
          <div>Quality for Ad-Hoc Mesh Computation:</div>
        </Tooltip>
        <Select
          size="small"
          style={{
            width: 220,
          }}
          value={datasetResolutionInfo.getClosestExistingIndex(
            preferredQualityForMeshAdHocComputation,
          )}
          onChange={this.handleQualityChangeForAdHocGeneration}
        >
          {datasetResolutionInfo
            .getResolutionsWithIndices()
            .map(([log2Index, mag]: [number, Vector3], index: number) => (
              <Option value={log2Index} key={log2Index}>
                {formatMagWithLabel(mag, index)}
              </Option>
            ))}
        </Select>
      </div>
    );
  };

  getPreComputeMeshesPopover = () => {
    const { disabled, title } = this.getPrecomputeMeshesTooltipInfo();
    const {
      preferredQualityForMeshPrecomputation,
      resolutionInfoOfVisibleSegmentationLayer: datasetResolutionInfo,
    } = this.props;
    return (
      <div
        style={{
          maxWidth: 500,
        }}
      >
        <h3>Precompute Meshes</h3>
        <p>
          Mesh visualizations can be very helpful when exploring segmentations. WEBKNOSSOS can
          precompute all meshes for a segmentation layer. Once the precomputation has finished,
          individual meshes can be loaded very quickly. As an alternative, you can use the ad-hoc
          mesh functionality which is a bit slower but does not require pre-computation.
        </p>

        <div>
          <div>
            <Tooltip title="The higher the quality, the more computational resources are required">
              Quality for Mesh Precomputation:
            </Tooltip>
          </div>

          <Select
            size="small"
            style={{
              width: 220,
            }}
            value={datasetResolutionInfo.getClosestExistingIndex(
              preferredQualityForMeshPrecomputation,
            )}
            onChange={this.handleQualityChangeForPrecomputation}
          >
            {datasetResolutionInfo
              .getResolutionsWithIndices()
              .map(([log2Index, mag]: [number, Vector3], index: number) => (
                <Option value={log2Index} key={log2Index}>
                  {formatMagWithLabel(mag, index)}
                </Option>
              ))}
          </Select>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: 16,
          }}
        >
          <Tooltip title={title}>
            <Button
              size="large"
              loading={this.state.activeMeshJobId != null}
              type="primary"
              disabled={disabled}
              onClick={this.startComputingMeshfile}
            >
              Precompute Meshes
            </Button>
          </Tooltip>
        </div>
      </div>
    );
  };

  getMeshesHeader = () => (
    <>
      <Tooltip title="Select a mesh file from which precomputed meshes will be loaded.">
        <ConfigProvider renderEmpty={renderEmptyMeshFileSelect}>
          <Select
            style={{
              width: 180,
              display: "inline-block",
            }}
            placeholder="Select a mesh file"
            value={
              this.props.currentMeshFile != null ? this.props.currentMeshFile.meshFileName : null
            }
            onChange={this.handleMeshFileSelected}
            size="small"
            loading={this.props.availableMeshFiles == null}
            dropdownMatchSelectWidth={false}
          >
            {this.props.availableMeshFiles ? (
              this.props.availableMeshFiles.map((meshFile: APIMeshFile) => (
                <Option key={meshFile.meshFileName} value={meshFile.meshFileName}>
                  {formatMeshFile(meshFile)}
                </Option>
              ))
            ) : (
              <Option value="" disabled>
                No files available.
              </Option>
            )}
          </Select>
        </ConfigProvider>
      </Tooltip>
      <Tooltip title="Refresh list of available Mesh files">
        <ReloadOutlined
          key="refresh"
          onClick={() =>
            Store.dispatch(
              maybeFetchMeshFilesAction(
                this.props.visibleSegmentationLayer,
                this.props.dataset,
                true,
              ),
            )
          }
          style={{
            marginLeft: 8,
          }}
        >
          Reload from Server
        </ReloadOutlined>
      </Tooltip>
      <Popover content={this.getPreComputeMeshesPopover} trigger="click" placement="bottom">
        <Tooltip title="Add a precomputed mesh file">
          <PlusOutlined />
        </Tooltip>
      </Popover>
      {this.state.activeMeshJobId != null ? (
        <Tooltip title='A mesh file is currently being computed. See "Processing Jobs" for more information.'>
          <LoadingOutlined />
        </Tooltip>
      ) : null}
      <Tooltip title="Configure ad-hoc mesh computation">
        <Popover content={this.getAdHocMeshSettings} trigger="click" placement="bottom">
          <SettingOutlined />
        </Popover>
      </Tooltip>
    </>
  );

  render() {
    const onSelect: TreeProps["onSelect"] = (selectedKeys, info) => {
      console.log("selected", selectedKeys, info);
    };

    return (
      <div id={segmentsTabId} className="padded-tab-content">
        <DomVisibilityObserver targetId={segmentsTabId}>
          {(isVisibleInDom) => {
            if (!isVisibleInDom) return null;
            const centeredSegmentId = getSegmentIdForPosition(getPosition(this.props.flycam));
            const allSegments = this.props.segments;
            const mapId = getMapIdFn(this.props.visibleSegmentationLayer);

            if (!this.props.visibleSegmentationLayer) {
              return (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No segmentation layer visible."
                />
              );
            }

            const titleRender = (treeItem: TreeNode) => {
              if (treeItem.type === "segment") {
                const segment = treeItem;
                return (
                  <SegmentListItem
                    key={segment.id}
                    mapId={mapId}
                    segment={segment}
                    centeredSegmentId={centeredSegmentId}
                    selectedSegmentId={this.state.selectedSegmentId}
                    activeDropdownSegmentId={this.state.activeDropdownSegmentId}
                    onSelectSegment={this.onSelectSegment}
                    handleSegmentDropdownMenuVisibility={this.handleSegmentDropdownMenuVisibility}
                    isosurface={this.props.isosurfaces[segment.id]}
                    isJSONMappingEnabled={this.props.isJSONMappingEnabled}
                    mappingInfo={this.props.mappingInfo}
                    isHoveredSegmentId={this.props.hoveredSegmentId === segment.id}
                    activeCellId={this.props.activeCellId}
                    setHoveredSegmentId={this.props.setHoveredSegmentId}
                    allowUpdate={this.props.allowUpdate}
                    updateSegment={this.props.updateSegment}
                    removeSegment={this.props.removeSegment}
                    visibleSegmentationLayer={this.props.visibleSegmentationLayer}
                    loadAdHocMesh={this.props.loadAdHocMesh}
                    loadPrecomputedMesh={this.props.loadPrecomputedMesh}
                    setActiveCell={this.props.setActiveCell}
                    setPosition={this.props.setPosition}
                    currentMeshFile={this.props.currentMeshFile}
                  />
                );
              } else {
                // The root group must not be removed or renamed
                const { id, name } = treeItem;
                const isEditingDisabled = !this.props.allowUpdate;

                const createMenu: MenuProps = {
                  items: [
                    {
                      key: "create",
                      onClick: () => this.createGroup(id),
                      disabled: isEditingDisabled,
                      icon: <PlusOutlined />,
                      label: "Create new group",
                    },
                    {
                      key: "delete",
                      disabled: isEditingDisabled,
                      onClick: () => this.deleteGroup(id),
                      icon: <DeleteOutlined />,
                      label: "Delete group",
                    },
                  ],
                };

                // Make sure the displayed name is not empty
                const displayableName = name?.trim() || "<no name>";
                return (
                  <div>
                    <Dropdown
                      menu={createMenu}
                      placement="bottom"
                      // AutoDestroy is used to remove the menu from DOM and keep up the performance.
                      // destroyPopupOnHide should also be an option according to the docs, but
                      // does not work properly. See https://github.com/react-component/trigger/issues/106#issuecomment-948532990
                      // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; overlay: () => Element;... Remove this comment to see the full error message
                      autoDestroy
                      trigger={["contextMenu"]}
                    >
                      <span>
                        <span
                          data-id={id}
                          style={{
                            marginLeft: 9,
                          }}
                        >
                          {displayableName}
                        </span>
                      </span>
                    </Dropdown>
                  </div>
                );

                // return treeItem.name || treeItem.id;
              }
            };

            return (
              <React.Fragment>
                <div style={{ flex: 0 }}>{this.getMeshesHeader()}</div>

                {/* todo: scrollbar is not native */}
                <div style={{ flex: 1 }}>
                  {allSegments == null || allSegments.size() === 0 ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={`There are no segments yet. ${
                        this.props.allowUpdate && this.props.hasVolumeTracing
                          ? "Use the volume tools (e.g., the brush) to create a segment. Alternatively, select or click existing segments to add them to this list."
                          : "Select or click existing segments to add them to this list."
                      }`}
                    />
                  ) : (
                    /* Without the default height, height will be 0 on the first render, leading to tree virtualization being disabled.
                       This has a major performance impact. */
                    <AutoSizer defaultHeight={500}>
                      {({ height, width }) => (
                        <div
                          style={{
                            height,
                            width,
                          }}
                        >
                          <Tree
                            onDrop={this.onDrop}
                            defaultExpandAll
                            className="segments-tree"
                            blockNode
                            // Passing an explicit height here, makes the tree virtualized
                            height={height} // without virtualization, pass 0 here and/or virtual={false}
                            draggable={{ icon: false }}
                            showLine
                            switcherIcon={<DownOutlined />}
                            defaultExpandedKeys={["0-0-0"]}
                            onSelect={onSelect}
                            treeData={this.state.groupTree}
                            titleRender={titleRender}
                            style={{
                              marginTop: 12,
                              flex: "1 1 auto",
                              overflow: "auto", // use hidden when not using virtualization
                            }}
                          />
                        </div>
                      )}
                    </AutoSizer>
                  )}
                </div>
              </React.Fragment>
            );
          }}
        </DomVisibilityObserver>
      </div>
    );
  }
  deleteGroup(_id: number): void {
    throw new Error("Method not implemented.");
  }
  createGroup(groupId: number): void {
    if (!this.props.visibleSegmentationLayer) {
      return;
    }
    const newSegmentGroups = _.cloneDeep(this.props.segmentGroups);
    const newGroupId = getMaximumGroupId(newSegmentGroups) + 1;
    const newGroup = {
      name: `Group ${newGroupId}`,
      groupId: newGroupId,
      children: [],
    };

    if (groupId === MISSING_GROUP_ID) {
      newSegmentGroups.push(newGroup);
    } else {
      callDeep(newSegmentGroups, groupId, (item) => {
        item.children.push(newGroup);
      });
    }

    this.props.onUpdateSegmentGroups(newSegmentGroups, this.props.visibleSegmentationLayer.name);
  }

  onDrop = (dropInfo: { node: TreeNode | null; dragNode: TreeNode; dropToGap: boolean }) => {
    const { node, dragNode, dropToGap } = dropInfo;

    // Node is the node onto which dragNode is dropped
    if (node == null || this.props.visibleSegmentationLayer == null) {
      return;
    }

    const dropTargetGroupId = node.type === "segment" ? node.groupId : node.id;
    let targetGroupId: number | null | undefined = null;
    if (dropTargetGroupId != null) {
      targetGroupId = dropToGap
        ? findParentIdForGroupId(this.props.segmentGroups, dropTargetGroupId)
        : dropTargetGroupId;
    }
    if (dragNode.type === "segment") {
      // A segment is being dropped onto/next to a segment or group.
      this.props.updateSegment(
        dragNode.id,
        { groupId: targetGroupId },
        this.props.visibleSegmentationLayer.name,
        true,
      );
    } else {
      // A group is being dropped onto/next to a segment or group.
      const movedGroup = findGroup(this.props.segmentGroups, dragNode.id);
      if (!movedGroup) {
        console.error("Could not find group to move");
        return;
      }

      // todo: make root handling nicer?
      const segmentGroupsWithoutDraggedGroup = mapGroups(
        [
          {
            name: "Root",
            groupId: MISSING_GROUP_ID,
            children: this.props.segmentGroups,
          },
        ],
        (parentGroup) => ({
          ...parentGroup,
          children: parentGroup.children.filter((subgroup) => subgroup.groupId !== dragNode.id),
        }),
      );
      const newSegmentGroups = mapGroups(segmentGroupsWithoutDraggedGroup, (parentGroup) => ({
        ...parentGroup,
        children:
          parentGroup.groupId === targetGroupId
            ? parentGroup.children.concat([movedGroup])
            : parentGroup.children,
      }));
      this.props.onUpdateSegmentGroups(
        newSegmentGroups[0].children,
        this.props.visibleSegmentationLayer.name,
      );
    }
  };
}

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(SegmentsView);

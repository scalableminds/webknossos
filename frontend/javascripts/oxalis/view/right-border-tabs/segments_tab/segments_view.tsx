import {
  DeleteOutlined,
  DownOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  ExclamationCircleOutlined,
  ArrowRightOutlined,
  DownloadOutlined,
  SearchOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  CloseOutlined,
} from "@ant-design/icons";
import type RcTree from "rc-tree";
import { getJobs, startComputeMeshFileJob } from "admin/admin_rest_api";
import {
  getFeatureNotAvailableInPlanMessage,
  isFeatureAllowedByPricingPlan,
  PricingPlanEnum,
} from "admin/organization/pricing_plan_utils";
import {
  Button,
  ConfigProvider,
  Divider,
  Dropdown,
  Empty,
  MenuProps,
  Modal,
  Popover,
  Select,
  Tooltip,
  Tree,
} from "antd";
import features from "features";
import Toast from "libs/toast";
import _, { isNumber } from "lodash";
import memoizeOne from "memoize-one";
import type { Vector3 } from "oxalis/constants";
import { MappingStatusEnum } from "oxalis/constants";
import { getSegmentIdForPosition } from "oxalis/controller/combinations/volume_handlers";
import {
  getMappingInfo,
  getResolutionInfoOfVisibleSegmentationLayer,
  getVisibleSegmentationLayer,
} from "oxalis/model/accessors/dataset_accessor";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import {
  getActiveSegmentationTracing,
  getVisibleSegments,
  hasEditableMapping,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  maybeFetchMeshFilesAction,
  refreshIsosurfaceAction,
  removeIsosurfaceAction,
  triggerIsosurfacesDownloadAction,
  updateCurrentMeshFileAction,
  updateIsosurfaceVisibilityAction,
} from "oxalis/model/actions/annotation_actions";
import { setPositionAction } from "oxalis/model/actions/flycam_actions";
import {
  loadAdHocMeshAction,
  loadPrecomputedMeshAction,
} from "oxalis/model/actions/segmentation_actions";
import { updateTemporarySettingAction } from "oxalis/model/actions/settings_actions";
import {
  BatchableUpdateSegmentAction,
  batchUpdateGroupsAndSegmentsAction,
  removeSegmentAction,
  setActiveCellAction,
  setSegmentGroupsAction,
  updateSegmentAction,
} from "oxalis/model/actions/volumetracing_actions";
import { ResolutionInfo } from "oxalis/model/helpers/resolution_info";
import { getMaximumGroupId } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import { api, Model } from "oxalis/singletons";
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
import DomVisibilityObserver from "oxalis/view/components/dom_visibility_observer";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import { getBaseSegmentationName } from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import SegmentListItem from "oxalis/view/right-border-tabs/segments_tab/segment_list_item";
import React, { Key } from "react";
import { connect, useSelector } from "react-redux";
import { AutoSizer } from "react-virtualized";
import type { Dispatch } from "redux";
import type { APIDataset, APIMeshFile, APISegmentationLayer, APIUser } from "types/api_flow_types";
import DeleteGroupModalView from "../delete_group_modal_view";
import {
  callDeep,
  createGroupToSegmentsMap,
  findParentIdForGroupId,
  MISSING_GROUP_ID,
} from "../tree_hierarchy_view_helpers";
import { ChangeColorMenuItemContent } from "components/color_picker";
import { ItemType } from "antd/lib/menu/hooks/useItems";
import { pluralize } from "libs/utils";
import AdvancedSearchPopover from "../advanced_search_popover";
import ButtonComponent from "oxalis/view/components/button_component";
import { DataNode } from "antd/lib/tree";

const { confirm } = Modal;
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

  updateSegments(
    segmentIds: number[],
    segmentShape: Partial<Segment>,
    layerName: string,
    createsNewUndoState: boolean,
  ) {
    segmentIds.forEach((segmentId) =>
      dispatch(
        updateSegmentAction(segmentId, segmentShape, layerName, undefined, createsNewUndoState),
      ),
    );
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

  onBatchUpdateGroupsAndSegmentsAction(actions: Array<BatchableUpdateSegmentAction>) {
    dispatch(batchUpdateGroupsAndSegmentsAction(actions));
  },
});

type DispatchProps = ReturnType<typeof mapDispatchToProps>;
type Props = DispatchProps & StateProps;
type State = {
  renamingCounter: number;
  selectedSegmentIds: number[];
  activeMeshJobId: string | null | undefined;
  activeDropdownSegmentOrGroupId: number | null | undefined;
  groupTree: TreeNode[];
  searchableTreeItemList: TreeNode[];
  prevProps: Props | null | undefined;
  groupToDelete: number | null | undefined;
  areSegmentsInGroupVisible: { [groupId: number]: boolean };
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

export type TreeNode =
  | (Segment & {
      type: "segment";
      key: string;
      title: string;
    })
  | {
      title: string;
      type: "group";
      name: string | null | undefined;
      id: number;
      key: string;
      children: Array<TreeNode>;
    };

function constructTreeData(
  groups: { name: string; groupId: number; children: SegmentGroup[] }[],
  groupToSegmentsMap: Record<number, Segment[]>,
): TreeNode[] {
  // Insert all trees into their respective groups in the group hierarchy and transform groups to tree nodes
  return _.sortBy(groups, "groupId").map((group) => {
    const { groupId } = group;
    const segments = groupToSegmentsMap[groupId] || [];
    const treeNode: TreeNode = {
      ...group,
      title: group.name,
      key: `group-${groupId}`,
      id: groupId,
      type: "group",
      children: constructTreeData(group.children, groupToSegmentsMap).concat(
        _.sortBy(segments, "id").map(
          (segment): TreeNode => ({
            ...segment,
            title: segment.name || "",
            type: "segment",
            key: `segment-${segment.id}`,
            id: segment.id,
          }),
        ),
      ),
    };
    return treeNode;
  });
}

class SegmentsView extends React.Component<Props, State> {
  intervalID: ReturnType<typeof setTimeout> | null | undefined;
  state: State = {
    renamingCounter: 0,
    selectedSegmentIds: [],
    activeMeshJobId: null,
    activeDropdownSegmentOrGroupId: null,
    groupTree: [],
    searchableTreeItemList: [],
    prevProps: null,
    groupToDelete: null,
    areSegmentsInGroupVisible: {},
  };
  tree: React.RefObject<RcTree>;

  constructor(props: Props) {
    super(props);
    this.tree = React.createRef();
  }

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

  onSelectTreeItem = (
    keys: Key[],
    event: {
      event: "select";
      selected: boolean;
      node: any;
      selectedNodes: DataNode[];
      nativeEvent: MouseEvent;
    },
  ) => {
    const { node, nativeEvent } = event;
    const { key = "" } = node;
    const treeData = this.state.groupTree;

    if (
      nativeEvent?.target instanceof HTMLElement &&
      (nativeEvent?.target?.closest(".ant-dropdown-menu") != null ||
        nativeEvent?.target?.closest(".ant-popover") != null)
    ) {
      // Ignore events that refer to elements in a popover or dropdown, since these
      // shouldn't influence the selection of the tree component.
      return;
    }

    // Windows / Mac single pick
    const ctrlPick: boolean = nativeEvent?.ctrlKey || nativeEvent?.metaKey;

    let newSelectedKeys: Key[];
    if (ctrlPick) {
      newSelectedKeys = keys;
    } else {
      newSelectedKeys = [key];
    }
    this.setState({
      selectedSegmentIds: newSelectedKeys.map((key) =>
        this.getSegmentIdForKey(String(key)),
      ) as number[],
    });
  };

  static getDerivedStateFromProps(nextProps: Props, prevState: State) {
    const { segments, segmentGroups, isosurfaces } = nextProps;
    if (segments == null) {
      return { prevProps: nextProps };
    }
    let updateStateObject;
    const groupToSegmentsMap = createGroupToSegmentsMap(segments);
    const rootGroup = {
      name: "Root",
      groupId: MISSING_GROUP_ID,
      key: MISSING_GROUP_ID,
      children: segmentGroups,
    };
    if (
      prevState.prevProps?.segments !== segments ||
      prevState.prevProps?.segmentGroups !== segmentGroups
    ) {
      // Insert the segments into the corresponding groups and create a
      // groupTree object that can be rendered using the antd Tree component
      const generatedGroupTree = constructTreeData([rootGroup], groupToSegmentsMap);

      // Traverse the tree hierarchy so that we get a list of segments and groups
      // that is in the same order as the rendered tree. That way, cycling through
      // the search results will not jump "randomly".
      const searchableTreeItemList: TreeNode[] = [];
      function visitAllItems(nodes: Array<TreeNode>, callback: (group: TreeNode) => void) {
        for (const node of nodes) {
          callback(node);
          if ("children" in node) {
            visitAllItems(node.children, callback);
          }
        }
      }
      visitAllItems(generatedGroupTree, (item: TreeNode) => {
        searchableTreeItemList.push(item);
      });

      updateStateObject = {
        groupTree: generatedGroupTree,
        searchableTreeItemList,
        prevProps: nextProps,
      };
    }
    if (prevState.prevProps?.isosurfaces !== isosurfaces) {
      // Derive the areSegmentsInGroupVisible state so that we know per group
      // if it contains only visible elements. This is used to know whether "Show meshes" or
      // "Hide meshes" context item should be shown.
      // If any segment is invisible, set the visibility of the group to false, so that the preferred
      // action is to make all meshes visible.
      const newVisibleMap: { [groupId: number]: boolean } = {};
      const segmentGroupsWithRoot = [...segmentGroups, rootGroup];
      segmentGroupsWithRoot.forEach((group) => {
        const segmentsOfGroup = groupToSegmentsMap[group.groupId];
        if (segmentsOfGroup == null) return;
        const isSomeSegmentLoadedAndInvisible = segmentsOfGroup.some((segment) => {
          const segmentIsosurface = isosurfaces[segment.id];
          // Only regard loaded, but invisible meshes
          return segmentIsosurface != null && !isosurfaces[segment.id].isVisible;
        });

        newVisibleMap[group.groupId] = !isSomeSegmentLoadedAndInvisible;
      });
      return {
        ...updateStateObject, //may be null
        prevProps: nextProps,
        areSegmentsInGroupVisible: newVisibleMap,
      };
    }
    return {
      ...updateStateObject,
      prevProps: nextProps,
    };
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

  handleDropdownMenuVisibility = (segmentOrGroupId: number, isVisible: boolean) => {
    //TODO first segment or a multiselect constant?
    //TODO naming?
    if (isVisible) {
      this.setState({
        activeDropdownSegmentOrGroupId: segmentOrGroupId,
      });
      return;
    }

    this.setState({
      activeDropdownSegmentOrGroupId: null,
    });
  };

  startComputingMeshfile = async () => {
    const {
      mappingInfo,
      preferredQualityForMeshPrecomputation,
      resolutionInfoOfVisibleSegmentationLayer: resolutionInfo,
    } = this.props;
    const defaultOrHigherIndex = resolutionInfo.getIndexOrClosestHigherIndex(
      preferredQualityForMeshPrecomputation,
    );
    const meshfileResolutionIndex =
      defaultOrHigherIndex != null
        ? defaultOrHigherIndex
        : resolutionInfo.getClosestExistingIndex(preferredQualityForMeshPrecomputation);
    const meshfileResolution = resolutionInfo.getResolutionByIndexWithFallback(
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
      resolutionInfoOfVisibleSegmentationLayer: resolutionInfo,
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
          value={resolutionInfo.getClosestExistingIndex(preferredQualityForMeshAdHocComputation)}
          onChange={this.handleQualityChangeForAdHocGeneration}
        >
          {resolutionInfo
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
      resolutionInfoOfVisibleSegmentationLayer: resolutionInfo,
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
            value={resolutionInfo.getClosestExistingIndex(preferredQualityForMeshPrecomputation)}
            onChange={this.handleQualityChangeForPrecomputation}
          >
            {resolutionInfo
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

  getToastForMissingPositions = (groupId: number | null) => {
    const segmentsWithoutPosition = this.getSegmentsWithMissingPosition(groupId);
    if (segmentsWithoutPosition.length > 0) {
      console.log(`Segments with unknown positions: ${segmentsWithoutPosition}`);
      return Toast.info(
        <React.Fragment>
          {pluralize("mesh", segmentsWithoutPosition.length, "meshes")} meshes couldn't be loaded
          because the segment position is unknown. The segment IDs were printed to the console.
        </React.Fragment>,
      );
    }
  };

  getSetGroupColorMenuItem = (
    groupId: number | null,
    segmentId: number | null = null,
  ): ItemType => {
    const isEditingDisabled = !this.props.allowUpdate;
    const title = "Change Segment Color";
    return {
      key: "changeGroupColor",
      disabled: isEditingDisabled,
      icon: (
        <i
          className="fas fa-eye-dropper fa-sm fa-icon"
          style={{
            cursor: "pointer",
          }}
        />
      ),
      label: (
        <ChangeColorMenuItemContent
          title={title}
          isDisabled={isEditingDisabled}
          onSetColor={(color) => {
            if (getVisibleSegmentationLayer == null) {
              return;
            }
            this.setGroupColor(groupId, color);
          }}
          rgb={this.getColorOfFirstSegmentOrNull(groupId)}
          hidePickerIcon // because the spacing differs from other items in the list, so set it manually
        />
      ),
    };
  };

  getResetGroupColorMenuItem = (
    groupId: number | null,
    segmentId: number | null = null,
  ): ItemType => {
    const isEditingDisabled = !this.props.allowUpdate;
    const title = "Reset Segment Color";
    return {
      key: "resetGroupColor",
      disabled: isEditingDisabled,
      icon: (
        <i
          className="fas fa-undo"
          style={{
            cursor: "pointer",
          }}
        />
      ),
      label: (
        <div
          title={title}
          onClick={(color) => {
            if (getVisibleSegmentationLayer == null) {
              return;
            }
            this.setGroupColor(groupId, null);
            this.handleDropdownMenuVisibility(groupId != null ? groupId : segmentId, false);
          }}
        >
          Reset Segment Color
        </div>
      ),
    };
  };

  getRemoveFromSegmentListMenuItem = (
    groupId: number | null,
    segmentId: number | null = null,
  ): ItemType => {
    this.assertSegmentXORGroupId(groupId, segmentId);
    return {
      key: "removeSegments",
      icon: <CloseOutlined />,
      label: (
        <div
          onClick={() => {
            if (this.props.visibleSegmentationLayer == null) {
              return;
            }
            this.handleRemoveSegmentsFromList(groupId);
            this.handleDropdownMenuVisibility(groupId != null ? groupId : segmentId, false);
          }}
        >
          Remove Segments From List
        </div>
      ),
    };
  };

  getColorOfFirstSegmentOrNull = (groupId: number | null) => {
    const relevantSegments =
      groupId != null ? this.getSegmentsOfGroup(groupId) : this.getSelectedSegments();
    if (relevantSegments == null || relevantSegments[0]?.color == null) {
      return [0.5, 0.5, 0.5] as Vector3;
    }
    return relevantSegments[0].color;
  };

  getComputeMeshesAdHocMenuItem = (
    groupId: number | null,
    segmentId: number | null = null,
  ): ItemType => {
    this.assertSegmentXORGroupId(groupId, segmentId);
    return {
      key: "computeAdHoc",
      icon: <i className="fas fa-dice-d20 fa-icon" />,
      label: (
        <div
          onClick={() => {
            if (this.props.visibleSegmentationLayer == null) {
              return;
            }
            this.handleLoadMeshesAdHoc(groupId);
            this.getToastForMissingPositions(groupId);
            this.handleDropdownMenuVisibility(groupId != null ? groupId : segmentId, false);
          }}
        >
          Compute Meshes (ad hoc)
        </div>
      ),
    };
  };

  assertSegmentXORGroupId(groupId: number | null, segmentId: number | null) {
    if ((groupId != null && segmentId != null) || (groupId == null && segmentId == null)) {
      Toast.error("Dropdown can either be open for segment or for segment group");
      return false;
    }
    return true;
  }

  getLoadMeshesFromFileMenuItem = (
    groupId: number | null,
    segmentId: number | null = null,
  ): ItemType => {
    this.assertSegmentXORGroupId(groupId, segmentId);
    return {
      key: "loadByFile",
      disabled: this.props.currentMeshFile == null,
      icon: <i className="fas fa-dice-d20 fa-icon" />,
      label: (
        <div
          onClick={() => {
            if (this.props.visibleSegmentationLayer == null) {
              return;
            }
            this.handleLoadMeshesFromFile(groupId);
            this.getToastForMissingPositions(groupId);
            this.handleDropdownMenuVisibility(groupId != null ? groupId : segmentId, false);
          }}
        >
          Load Meshes (precomputed)
        </div>
      ),
    };
  };

  getReloadMenuItem = (groupId: number | null, segmentId: number | null = null): ItemType => {
    return this.state != null && this.doesGroupHaveAnyMeshes(groupId)
      ? {
          key: "reloadMeshes",
          icon: <ReloadOutlined />,
          label: (
            <div
              onClick={() => {
                this.handleRefreshMeshes(groupId);
                this.handleDropdownMenuVisibility(groupId != null ? groupId : segmentId, false);
              }}
            >
              Refresh Meshes
            </div>
          ),
        }
      : null;
  };

  getRemoveMeshesMenuItem = (groupId: number | null, segmentId: number | null = null): ItemType => {
    return this.state != null && this.doesGroupHaveAnyMeshes(groupId)
      ? {
          key: "removeMeshes",
          icon: <DeleteOutlined />,
          label: (
            <div
              onClick={() => {
                this.handleRemoveMeshes(groupId);
                this.handleDropdownMenuVisibility(groupId != null ? groupId : segmentId, false);
              }}
            >
              Remove Meshes
            </div>
          ),
        }
      : null;
  };

  getDownLoadMeshesMenuItem = (
    groupId: number | null,
    segmentId: number | null = null,
  ): ItemType => {
    return this.state != null && this.doesGroupHaveAnyMeshes(groupId)
      ? {
          key: "downloadAllMeshes",
          icon: <DownloadOutlined />,
          label: (
            <div
              onClick={() => {
                this.downloadAllMeshesForGroup(groupId);
                this.handleDropdownMenuVisibility(groupId != null ? groupId : segmentId, false);
              }}
            >
              Download Meshes
            </div>
          ),
        }
      : null;
  };

  getMoveSegmentsHereMenuItem = (groupId: number): ItemType => {
    return this.state.selectedSegmentIds != null
      ? {
          key: "moveHere",
          onClick: () => {
            if (
              this.state.selectedSegmentIds == null ||
              this.props.visibleSegmentationLayer == null
            ) {
              // Satisfy TS
              return;
            }
            this.props.updateSegments(
              this.state.selectedSegmentIds,
              { groupId },
              this.props.visibleSegmentationLayer.name,
              true,
            );
            this.handleDropdownMenuVisibility(groupId, false);
          },
          disabled: !this.props.allowUpdate,
          icon: <ArrowRightOutlined />,
          label: "Move active segment here",
        }
      : null;
  };

  areSelectedSegmentsMeshesVisible = () => {
    // TODO remove me. We assume that there are meshes because of check one level up
    const selectedSegments = this.getSelectedSegments();
    const isosurfaces = this.props.isosurfaces;
    const isSomeSegmentLoadedAndInvisible = selectedSegments.some((segment) => {
      const segmentIsosurface = isosurfaces[segment.id];
      // Only regard loaded, but invisible meshes
      return segmentIsosurface != null && !isosurfaces[segment.id].isVisible;
    });
    // show "Hide meshes" if no isosurface is loaded and invisible
    return !isSomeSegmentLoadedAndInvisible;
  };

  getShowMeshesMenuItem = (groupId: number | null, segmentId: number | null = null): ItemType => {
    let willShowHideMeshesLabel =
      groupId == null
        ? this.areSelectedSegmentsMeshesVisible()
        : this.state.areSegmentsInGroupVisible[groupId]; //toggle between hide and show

    const showHideMeshesLabel = willShowHideMeshesLabel
      ? { icon: <EyeInvisibleOutlined />, text: "Hide" }
      : { icon: <EyeOutlined />, text: "Show" };
    return this.state != null && this.doesGroupHaveAnyMeshes(groupId)
      ? {
          key: "showMeshesOfGroup",
          icon: showHideMeshesLabel.icon,
          label: (
            <div
              onClick={() => {
                if (this.props.visibleSegmentationLayer == null) {
                  // Satisfy TS
                  return;
                }
                this.handleChangeMeshVisibilityInGroup(
                  this.props.visibleSegmentationLayer.name,
                  groupId,
                  !this.state.areSegmentsInGroupVisible[groupId],
                );
                this.handleDropdownMenuVisibility(groupId, false);
              }}
            >
              {showHideMeshesLabel.text} Meshes
            </div>
          ),
        }
      : null;
  };

  setGroupColor(groupId: number | null, color: Vector3 | null) {
    const { visibleSegmentationLayer } = this.props;
    if (visibleSegmentationLayer == null) return;
    const relevantSegments =
      groupId != null ? this.getSegmentsOfGroup(groupId) : this.getSelectedSegments();
    if (relevantSegments == null) return;

    const actions = relevantSegments.map((segment) =>
      updateSegmentAction(segment.id, { color: color }, visibleSegmentationLayer.name),
    );

    Store.dispatch(batchUpdateGroupsAndSegmentsAction(actions));
  }

  handleRefreshMeshes = (groupId: number | null) => {
    const { visibleSegmentationLayer } = this.props;
    if (visibleSegmentationLayer == null) return;

    this.handlePerSegment(groupId, (segment) => {
      if (
        Store.getState().localSegmentationData[visibleSegmentationLayer.name].isosurfaces[
          segment.id
        ] != null
      ) {
        Store.dispatch(refreshIsosurfaceAction(visibleSegmentationLayer.name, segment.id));
      }
    });
  };

  handleRemoveSegmentsFromList = (groupId: number | null) => {
    const { visibleSegmentationLayer } = this.props;
    if (visibleSegmentationLayer == null) return;
    this.handlePerSegment(groupId, (segment) =>
      Store.dispatch(removeSegmentAction(segment.id, visibleSegmentationLayer.name)),
    );
    // manually reset selected segments
    this.setState({
      selectedSegmentIds: [],
    });
  };

  handleRemoveMeshes = (groupId: number | null) => {
    const { visibleSegmentationLayer } = this.props;
    if (visibleSegmentationLayer == null) return;
    this.handlePerSegment(groupId, (segment) => {
      if (
        Store.getState().localSegmentationData[visibleSegmentationLayer.name].isosurfaces[
          segment.id
        ] != null
      ) {
        Store.dispatch(removeIsosurfaceAction(visibleSegmentationLayer.name, segment.id));
      }
    });
  };

  handleChangeMeshVisibilityInGroup = (layerName: string, groupId: number, isVisible: boolean) => {
    this.handlePerSegment(groupId, (segment) => {
      if (Store.getState().localSegmentationData[layerName].isosurfaces[segment.id] != null) {
        Store.dispatch(updateIsosurfaceVisibilityAction(layerName, segment.id, isVisible));
      }
    });
  };

  handleLoadMeshesAdHoc = (groupId: number | null) => {
    this.handlePerSegment(groupId, (segment) => {
      if (segment.somePosition == null) return;
      this.props.loadAdHocMesh(segment.id, segment.somePosition);
    });
  };

  getSegmentsWithMissingPosition = (groupId: number | null): number[] => {
    const relevantSegments =
      groupId != null ? this.getSegmentsOfGroup(groupId) : this.getSelectedSegments();
    if (relevantSegments == null) return [];
    let segmentsWithoutPosition: number[] = relevantSegments
      .filter((segment) => segment.somePosition == null)
      .map((segment) => segment.id);
    return segmentsWithoutPosition.sort();
  };

  getSelectedSegments = (): Segment[] => {
    const allSegments = this.getSegmentsOfGroup(MISSING_GROUP_ID);
    if (allSegments == null) return [];
    const selectedSegmentIds = this.state.selectedSegmentIds;
    return allSegments?.filter((segment) => selectedSegmentIds.includes(segment.id));
  };

  getSegmentIdForKey = (segmentKey: Key) => {
    const segmentKeyAsString = String(segmentKey);
    if (segmentKeyAsString.startsWith("segment-")) {
      const potentialSegmentId = segmentKeyAsString.split("-")[1];
      if (isNumber(parseInt(potentialSegmentId))) {
        console.log(potentialSegmentId);
        return parseInt(potentialSegmentId);
      }
    }
    return segmentKey;
  };

  handlePerSegment(groupId: number | null, callback: (s: Segment) => void) {
    const { visibleSegmentationLayer } = this.props;
    if (visibleSegmentationLayer == null) return;
    if (groupId == null) {
      const selectedSegments = this.getSelectedSegments();
      selectedSegments?.forEach(callback);
      return;
    }
    const segmentGroup = this.getSegmentsOfGroup(groupId);
    if (segmentGroup == null) return;
    segmentGroup.forEach(callback);
  }

  handleLoadMeshesFromFile = (groupId: number | null) => {
    this.handlePerSegment(groupId, (segment: Segment) => {
      if (segment.somePosition == null || this.props.currentMeshFile == null) return;
      this.props.loadPrecomputedMesh(
        segment.id,
        segment.somePosition,
        this.props.currentMeshFile.meshFileName,
      );
    });
  };

  downloadAllMeshesForGroup = (groupId: number | null) => {
    const { visibleSegmentationLayer } = this.props;
    if (visibleSegmentationLayer == null) return;
    const relevantSegments =
      groupId != null ? this.getSegmentsOfGroup(groupId) : this.getSelectedSegments();
    if (relevantSegments == null) return;

    if (visibleSegmentationLayer != null) {
      const segmentsArray = relevantSegments.map((segment) => {
        return {
          segmentName: segment.name ? segment.name : "mesh",
          segmentId: segment.id,
          layerName: visibleSegmentationLayer.name,
        };
      });
      Store.dispatch(triggerIsosurfacesDownloadAction(segmentsArray));
    }
  };

  handleDeleteGroup = (groupId: number) => {
    const { segments, segmentGroups, visibleSegmentationLayer } = this.props;

    if (segments == null || segmentGroups == null || visibleSegmentationLayer == null) {
      return;
    }
    const segmentGroupToDelete = segmentGroups.find((el) => el.groupId === groupId);
    const groupToSegmentsMap = createGroupToSegmentsMap(segments);
    if (
      segmentGroupToDelete &&
      segmentGroupToDelete.children.length === 0 &&
      !groupToSegmentsMap[groupId]
    ) {
      // Group is empty. Delete directly without showing modal.
      this.deleteGroup(groupId);
    } else if (groupId === MISSING_GROUP_ID) {
      // Ask whether all children of root group should be deleted
      // (doesn't need recursive/not-recursive distinction, since
      // the root group itself cannot be removed).
      confirm({
        title: "Do you want to delete all segments and groups?",
        icon: <ExclamationCircleOutlined />,
        okText: "Delete",
        okType: "danger",
        onOk: () => {
          this.deleteGroup(groupId);
        },
      });
    } else {
      // Show modal
      this.setState({
        groupToDelete: groupId,
      });
    }
  };

  hideDeleteGroupsModal = () => {
    this.setState({
      groupToDelete: null,
    });
  };

  deleteGroupAndHideModal(
    groupToDelete: number | null | undefined,
    deleteChildren: boolean = false,
  ) {
    this.hideDeleteGroupsModal();

    if (groupToDelete != null) {
      this.deleteGroup(groupToDelete, deleteChildren);
    }
  }

  deleteGroup(groupId: number, deleteChildren: boolean = false): void {
    const { segments, segmentGroups, visibleSegmentationLayer } = this.props;

    if (segments == null || segmentGroups == null || visibleSegmentationLayer == null) {
      return;
    }
    const layerName = visibleSegmentationLayer.name;

    let newSegmentGroups = _.cloneDeep(segmentGroups);

    const groupToSegmentsMap = createGroupToSegmentsMap(segments);
    let segmentIdsToDelete: number[] = [];

    if (groupId === MISSING_GROUP_ID) {
      // special case: delete Root group and all children (aka everything)
      segmentIdsToDelete = Array.from(segments.values()).map((t) => t.id);
      newSegmentGroups = [];
    }

    const updateSegmentActions: BatchableUpdateSegmentAction[] = [];
    callDeep(newSegmentGroups, groupId, (item, index, parentsChildren, parentGroupId) => {
      const subsegments = groupToSegmentsMap[groupId] != null ? groupToSegmentsMap[groupId] : [];
      // Remove groupremoveSegment
      parentsChildren.splice(index, 1);

      if (!deleteChildren) {
        // Move all subgroups to the parent group
        parentsChildren.push(...item.children);

        // Update all segments
        for (const segment of subsegments.values()) {
          updateSegmentActions.push(
            updateSegmentAction(
              segment.id,
              { groupId: parentGroupId === MISSING_GROUP_ID ? null : parentGroupId },
              layerName,
              // The parameter createsNewUndoState is not passed, since the action
              // is added to a batch and batch updates always crate a new undo state.
            ),
          );
        }

        return;
      }

      // Finds all subsegments of the passed group recursively
      const findChildrenRecursively = (group: SegmentGroup) => {
        const currentSubsegments = groupToSegmentsMap[group.groupId] ?? [];
        // Delete all segments of the current group
        segmentIdsToDelete = segmentIdsToDelete.concat(
          currentSubsegments.map((segment) => segment.id),
        );
        // Also delete the segments of all subgroups
        group.children.forEach((subgroup) => findChildrenRecursively(subgroup));
      };

      findChildrenRecursively(item);
    });

    // Update the store at once
    const removeSegmentActions: BatchableUpdateSegmentAction[] = segmentIdsToDelete.map(
      (segmentId) => removeSegmentAction(segmentId, layerName),
    );
    this.props.onBatchUpdateGroupsAndSegmentsAction(
      updateSegmentActions.concat(removeSegmentActions, [
        setSegmentGroupsAction(newSegmentGroups, layerName),
      ]),
    );
  }

  getSegmentsOfGroup = (groupId: number): Segment[] | null => {
    const { segments, segmentGroups } = this.props;

    if (segments == null || segmentGroups == null) {
      return null;
    }
    const groupToSegmentsMap = createGroupToSegmentsMap(segments);
    return groupToSegmentsMap[groupId] != null ? groupToSegmentsMap[groupId] : [];
  };

  onRenameStart = () => {
    this.setState(({ renamingCounter }) => ({ renamingCounter: renamingCounter + 1 }));
  };

  onRenameEnd = () => {
    this.setState(({ renamingCounter }) => ({ renamingCounter: renamingCounter - 1 }));
  };

  handleSearchSelect = (selectedElement: TreeNode) => {
    if (this.tree?.current == null) {
      return;
    }
    this.tree.current.scrollTo({ key: selectedElement.key });
    const isASegment = "color" in selectedElement;
    if (isASegment) {
      this.onSelectSegment(selectedElement);
    }
  };

  render() {
    const { groupToDelete } = this.state;

    return (
      <div id={segmentsTabId} className="padded-tab-content">
        <DomVisibilityObserver targetId={segmentsTabId}>
          {(isVisibleInDom) => {
            if (!isVisibleInDom) return null;
            const centeredSegmentId = getSegmentIdForPosition(getPosition(this.props.flycam));
            const allSegments = this.props.segments;
            const isSegmentHierarchyEmpty = !(
              allSegments?.size() || this.props.segmentGroups.length
            );
            const mapId = getMapIdFn(this.props.visibleSegmentationLayer);

            if (!this.props.visibleSegmentationLayer) {
              return (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No segmentation layer visible."
                />
              );
            }

            const doSelectedSegmentsHaveAnyMeshes = this.doesGroupHaveAnyMeshes(null);
            const multiSelectMenu = (segmentId: number): MenuProps => {
              return {
                items: [
                  this.getSetGroupColorMenuItem(null, segmentId),
                  this.getResetGroupColorMenuItem(null, segmentId),
                  this.getLoadMeshesFromFileMenuItem(null, segmentId),
                  this.getComputeMeshesAdHocMenuItem(null, segmentId),
                  doSelectedSegmentsHaveAnyMeshes
                    ? this.getShowMeshesMenuItem(null, segmentId)
                    : null,
                  doSelectedSegmentsHaveAnyMeshes ? this.getReloadMenuItem(null, segmentId) : null,
                  doSelectedSegmentsHaveAnyMeshes
                    ? this.getRemoveMeshesMenuItem(null, segmentId)
                    : null,
                  doSelectedSegmentsHaveAnyMeshes
                    ? this.getDownLoadMeshesMenuItem(null, segmentId)
                    : null,
                  this.getRemoveFromSegmentListMenuItem(null, segmentId),
                ],
              };
            };

            const titleRender = (treeItem: TreeNode) => {
              if (treeItem.type === "segment") {
                const segment = treeItem;
                return (
                  <SegmentListItem
                    key={segment.id}
                    mapId={mapId}
                    segment={segment}
                    centeredSegmentId={centeredSegmentId}
                    selectedSegmentIds={this.state.selectedSegmentIds}
                    activeDropdownSegmentId={this.state.activeDropdownSegmentOrGroupId}
                    onSelectSegment={this.onSelectSegment}
                    handleSegmentDropdownMenuVisibility={this.handleDropdownMenuVisibility}
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
                    onRenameStart={this.onRenameStart}
                    onRenameEnd={this.onRenameEnd}
                    multiSelectMenu={multiSelectMenu(segment.id)}
                  />
                );
              } else {
                const { id, name } = treeItem;
                const isEditingDisabled = !this.props.allowUpdate;
                const menu: MenuProps = {
                  items: [
                    {
                      key: "create",
                      onClick: () => {
                        this.createGroup(id);
                        this.handleDropdownMenuVisibility(id, false);
                      },
                      disabled: isEditingDisabled,
                      icon: <PlusOutlined />,
                      label: "Create new group",
                    },
                    {
                      key: "delete",
                      disabled: isEditingDisabled,
                      onClick: () => {
                        this.handleDeleteGroup(id);
                        this.handleDropdownMenuVisibility(id, false);
                      },
                      icon: <DeleteOutlined />,
                      label: "Delete group",
                    },
                    this.getMoveSegmentsHereMenuItem(id),
                    {
                      key: "groupAndMeshActionDivider",
                      label: <Divider style={{ marginBottom: 0, marginTop: 0 }} />,
                      disabled: true,
                    },
                    this.getSetGroupColorMenuItem(id),
                    this.getLoadMeshesFromFileMenuItem(id),
                    this.getComputeMeshesAdHocMenuItem(id),
                    this.getReloadMenuItem(id),
                    this.getRemoveMeshesMenuItem(id),
                    this.getShowMeshesMenuItem(id),
                    this.getDownLoadMeshesMenuItem(id),
                  ],
                };

                // Make sure the displayed name is not empty
                const displayableName = name?.trim() || "<Unnamed Group>";
                return (
                  <div>
                    <Dropdown
                      menu={menu}
                      placement="bottom"
                      // AutoDestroy is used to remove the menu from DOM and keep up the performance.
                      // destroyPopupOnHide should also be an option according to the docs, but
                      // does not work properly. See https://github.com/react-component/trigger/issues/106#issuecomment-948532990
                      // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; overlay: () => Element;... Remove this comment to see the full error message
                      autoDestroy
                      open={this.state.activeDropdownSegmentOrGroupId === id} // explicit visibility handling is required here otherwise the color picker component for "Change Group color" is rendered/positioned incorrectly
                      onOpenChange={(isVisible) => this.handleDropdownMenuVisibility(id, isVisible)}
                      trigger={["contextMenu"]}
                    >
                      <EditableTextLabel
                        value={displayableName}
                        label="Group Name"
                        onChange={(name) => {
                          if (this.props.visibleSegmentationLayer != null) {
                            api.data.renameSegmentGroup(
                              this.props.visibleSegmentationLayer.name,
                              id,
                              name,
                            );
                          }
                        }}
                        margin="0 5px"
                        // The root group must not be removed or renamed
                        disableEditing={!this.props.allowUpdate || id === MISSING_GROUP_ID}
                        onRenameStart={this.onRenameStart}
                        onRenameEnd={this.onRenameEnd}
                      />
                    </Dropdown>
                  </div>
                );
              }
            };

            return (
              <React.Fragment>
                <div style={{ flex: 0 }}>
                  <AdvancedSearchPopover
                    onSelect={this.handleSearchSelect}
                    data={this.state.searchableTreeItemList}
                    searchKey={(item) => item.name ?? `${item.id}` ?? ""}
                    provideShortcut
                    targetId={segmentsTabId}
                  >
                    <ButtonComponent
                      size="small"
                      title="Open the search via CTRL + Shift + F"
                      style={{ marginRight: 8 }}
                    >
                      <SearchOutlined className="without-icon-margin" />
                    </ButtonComponent>
                  </AdvancedSearchPopover>
                  {this.getMeshesHeader()}
                </div>
                <div style={{ flex: 1 }}>
                  {isSegmentHierarchyEmpty ? (
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
                            allowDrop={this.allowDrop}
                            onDrop={this.onDrop}
                            onSelect={this.onSelectTreeItem}
                            defaultExpandAll
                            className="segments-tree"
                            blockNode
                            // Passing an explicit height here, makes the tree virtualized
                            height={height} // without virtualization, pass 0 here and/or virtual={false}
                            draggable={{
                              icon: false,
                              nodeDraggable: () =>
                                // Forbid renaming when segments or groups are being renamed,
                                // since selecting text within the editable input box would not work
                                // otherwise (instead, the item would be dragged).
                                this.state.renamingCounter === 0,
                            }}
                            multiple
                            showLine
                            selectedKeys={this.state.selectedSegmentIds.map(
                              (segmentId) => `segment-${segmentId}`,
                            )}
                            switcherIcon={<DownOutlined />}
                            treeData={this.state.groupTree}
                            titleRender={titleRender}
                            style={{
                              marginTop: 12,
                              flex: "1 1 auto",
                              overflow: "auto", // use hidden when not using virtualization
                            }}
                            ref={this.tree}
                          />
                        </div>
                      )}
                    </AutoSizer>
                  )}
                </div>
                {groupToDelete !== null ? (
                  <DeleteGroupModalView
                    onCancel={this.hideDeleteGroupsModal}
                    onJustDeleteGroup={() => {
                      this.deleteGroupAndHideModal(groupToDelete, false);
                    }}
                    onDeleteGroupAndChildren={() => {
                      this.deleteGroupAndHideModal(groupToDelete, true);
                    }}
                  />
                ) : null}
              </React.Fragment>
            );
          }}
        </DomVisibilityObserver>
      </div>
    );
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

  doesGroupHaveAnyMeshes = (groupId: number | null): boolean => {
    const { visibleSegmentationLayer } = this.props;
    if (visibleSegmentationLayer == null) return false;
    const relevantSegments =
      groupId != null ? this.getSegmentsOfGroup(groupId) : this.getSelectedSegments();
    if (relevantSegments == null) return false;
    const isosurfacesOfLayer =
      Store.getState().localSegmentationData[visibleSegmentationLayer.name].isosurfaces;
    return relevantSegments.some((segment) => isosurfacesOfLayer[segment.id] != null);
  };

  onDrop = (dropInfo: { node: TreeNode | null; dragNode: TreeNode; dropToGap: boolean }) => {
    const { node, dragNode } = dropInfo;

    // Node is the node onto which dragNode is dropped
    if (node == null || this.props.visibleSegmentationLayer == null) {
      return;
    }

    // dropToGap effectively means that the user dragged the item
    // so that it should be dragged to the parent of the target node.
    // However, since a segment cannot be dragged inside of a segment,
    // dropToGap should be ignored when the target node is a segment.
    // Otherwise, the node could be dragged to the wrong location.
    const dropToGap = node.type === "segment" ? false : dropInfo.dropToGap;

    const dropTargetGroupId = node.type === "segment" ? node.groupId : node.id;
    let targetGroupId: number | null | undefined = null;
    if (dropTargetGroupId != null) {
      targetGroupId = dropToGap
        ? findParentIdForGroupId(this.props.segmentGroups, dropTargetGroupId)
        : dropTargetGroupId;
    }
    if (dragNode.type === "segment") {
      // A segment is being dropped onto/next to a segment or group.
      this.props.updateSegments(
        [dragNode.id],
        { groupId: targetGroupId },
        this.props.visibleSegmentationLayer.name,
        true,
      );
    } else {
      // A group is being dropped onto/next to a segment or group.
      api.tracing.moveSegmentGroup(
        dragNode.id,
        targetGroupId,
        this.props.visibleSegmentationLayer.name,
      );
    }
  };

  allowDrop = ({ dropNode, dropPosition }: { dropNode: TreeNode; dropPosition: number }) => {
    // Don't allow to drag a node inside of a segment, but only
    // next to it. If dropPosition is 0, the dragging action targets
    // the child of the hovered element (which should only be allowed
    // for groups).
    return "children" in dropNode || dropPosition !== 0;
  };
}

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(SegmentsView);

import {
  ArrowRightOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  ExpandAltOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  ShrinkOutlined,
} from "@ant-design/icons";
import { getJobs, startComputeMeshFileJob } from "admin/admin_rest_api";
import {
  PricingPlanEnum,
  getFeatureNotAvailableInPlanMessage,
  isFeatureAllowedByPricingPlan,
} from "admin/organization/pricing_plan_utils";
import {
  Button,
  ConfigProvider,
  Divider,
  Empty,
  type MenuProps,
  Modal,
  Popover,
  Select,
} from "antd";
import type { ItemType } from "antd/lib/menu/interface";
import type { DataNode } from "antd/lib/tree";
import { ChangeColorMenuItemContent } from "components/color_picker";
import FastTooltip from "components/fast_tooltip";
import { SimpleRow } from "dashboard/folders/metadata_table";
import Toast from "libs/toast";
import { pluralize } from "libs/utils";
import _, { isNumber, memoize } from "lodash";
import type { Vector3 } from "oxalis/constants";
import { EMPTY_OBJECT, MappingStatusEnum } from "oxalis/constants";
import {
  getMagInfoOfVisibleSegmentationLayer,
  getMappingInfo,
  getMaybeSegmentIndexAvailability,
  getVisibleSegmentationLayer,
} from "oxalis/model/accessors/dataset_accessor";
import { getAdditionalCoordinatesAsString } from "oxalis/model/accessors/flycam_accessor";
import {
  getActiveSegmentationTracing,
  getMeshesForCurrentAdditionalCoordinates,
  getSegmentName,
  getSelectedIds,
  getVisibleSegments,
  hasEditableMapping,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  maybeFetchMeshFilesAction,
  refreshMeshAction,
  removeMeshAction,
  triggerMeshesDownloadAction,
  updateCurrentMeshFileAction,
  updateMeshVisibilityAction,
} from "oxalis/model/actions/annotation_actions";
import { ensureSegmentIndexIsLoadedAction } from "oxalis/model/actions/dataset_actions";
import {
  setAdditionalCoordinatesAction,
  setPositionAction,
} from "oxalis/model/actions/flycam_actions";
import {
  loadAdHocMeshAction,
  loadPrecomputedMeshAction,
} from "oxalis/model/actions/segmentation_actions";
import { updateTemporarySettingAction } from "oxalis/model/actions/settings_actions";
import {
  batchUpdateGroupsAndSegmentsAction,
  deleteSegmentDataAction,
  removeSegmentAction,
  setActiveCellAction,
  setExpandedSegmentGroupsAction,
  setSelectedSegmentsOrGroupAction,
  updateSegmentAction,
} from "oxalis/model/actions/volumetracing_actions";
import type { MagInfo } from "oxalis/model/helpers/mag_info";
import { api } from "oxalis/singletons";
import type {
  ActiveMappingInfo,
  MeshInformation,
  OxalisState,
  Segment,
  SegmentGroup,
  SegmentMap,
  TreeGroup,
  VolumeTracing,
} from "oxalis/store";
import Store from "oxalis/store";
import ButtonComponent from "oxalis/view/components/button_component";
import DomVisibilityObserver from "oxalis/view/components/dom_visibility_observer";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import { InputWithUpdateOnBlur } from "oxalis/view/components/input_with_update_on_blur";
import { getContextMenuPositionFromEvent } from "oxalis/view/context_menu";
import SegmentListItem from "oxalis/view/right-border-tabs/segments_tab/segment_list_item";
import {
  type SegmentHierarchyNode,
  getBaseSegmentationName,
} from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import type RcTree from "rc-tree";
import React, { type Key } from "react";
import { connect, useSelector } from "react-redux";
import AutoSizer from "react-virtualized-auto-sizer";
import type { Dispatch } from "redux";
import type {
  APIDataset,
  APIMeshFile,
  APISegmentationLayer,
  APIUser,
  MetadataEntryProto,
} from "types/api_flow_types";
import { APIJobType, type AdditionalCoordinate } from "types/api_flow_types";
import AdvancedSearchPopover from "../advanced_search_popover";
import DeleteGroupModalView from "../delete_group_modal_view";
import { MetadataEntryTableRows } from "../metadata_table";
import { ResizableSplitPane } from "../resizable_split_pane";
import ScrollableVirtualizedTree from "../scrollable_virtualized_tree";
import { ContextMenuContainer } from "../sidebar_context_menu";
import {
  MISSING_GROUP_ID,
  additionallyExpandGroup,
  createGroupToParentMap,
  createGroupToSegmentsMap,
  findGroup,
  findParentIdForGroupId,
  getExpandedGroups,
  getGroupByIdWithSubgroups,
  getGroupNodeKey,
} from "../trees_tab/tree_hierarchy_view_helpers";
import { SegmentStatisticsModal } from "./segment_statistics_modal";

const SCROLL_DELAY_MS = 50;

const { confirm } = Modal;
const { Option } = Select;
// Interval in ms to check for running mesh file computation jobs for this dataset
const refreshInterval = 5000;

export const stlMeshConstants = {
  meshMarker: [105, 115, 111],
  // ASCII codes for ISO
  segmentIdIndex: 3, // Write cell index after the meshMarker
};
const segmentsTabId = "segment-list";

type StateProps = {
  meshes: Record<number, MeshInformation>;
  dataset: APIDataset;
  mappingInfo: ActiveMappingInfo;
  hasVolumeTracing: boolean | undefined;
  isSegmentIndexAvailable: boolean | undefined;
  segments: SegmentMap | null | undefined;
  segmentGroups: Array<SegmentGroup>;
  selectedIds: { segments: number[]; group: number | null };
  visibleSegmentationLayer: APISegmentationLayer | null | undefined;
  activeVolumeTracing: VolumeTracing | null | undefined;
  allowUpdate: boolean;
  organization: string;
  datasetName: string;
  availableMeshFiles: Array<APIMeshFile> | null | undefined;
  currentMeshFile: APIMeshFile | null | undefined;
  activeUser: APIUser | null | undefined;
  activeCellId: number | null | undefined;
  preferredQualityForMeshPrecomputation: number;
  preferredQualityForMeshAdHocComputation: number;
  magInfoOfVisibleSegmentationLayer: MagInfo;
};

const mapStateToProps = (state: OxalisState): StateProps => {
  const visibleSegmentationLayer = getVisibleSegmentationLayer(state);
  const activeVolumeTracing = getActiveSegmentationTracing(state);
  const mappingInfo = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    visibleSegmentationLayer?.name,
  );

  const { segments, segmentGroups } = getVisibleSegments(state);

  const isVisibleButUneditableSegmentationLayerActive =
    visibleSegmentationLayer != null && visibleSegmentationLayer.tracingId == null;

  const meshesForCurrentAdditionalCoordinates =
    visibleSegmentationLayer != null
      ? getMeshesForCurrentAdditionalCoordinates(state, visibleSegmentationLayer?.name)
      : undefined;

  const isSegmentIndexAvailable = getMaybeSegmentIndexAvailability(
    state.dataset,
    visibleSegmentationLayer?.name,
  );

  return {
    activeCellId: activeVolumeTracing?.activeCellId,
    meshes: meshesForCurrentAdditionalCoordinates || EMPTY_OBJECT, // satisfy ts
    dataset: state.dataset,
    mappingInfo,
    hasVolumeTracing: state.annotation.volumes.length > 0,
    isSegmentIndexAvailable,
    segments,
    segmentGroups,
    selectedIds: getCleanedSelectedSegmentsOrGroup(state),
    visibleSegmentationLayer,
    activeVolumeTracing,
    allowUpdate:
      state.annotation.restrictions.allowUpdate && !isVisibleButUneditableSegmentationLayerActive,
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
    magInfoOfVisibleSegmentationLayer: getMagInfoOfVisibleSegmentationLayer(state),
  };
};

const getCleanedSelectedSegmentsOrGroup = (state: OxalisState) => {
  const [cleanedSelectedIds, maybeUpdateStoreAction] = getSelectedIds(state);
  if (maybeUpdateStoreAction != null) {
    maybeUpdateStoreAction();
  }
  return cleanedSelectedIds;
};

const mapDispatchToProps = (dispatch: Dispatch<any>) => ({
  setHoveredSegmentId(segmentId: number | null | undefined) {
    dispatch(updateTemporarySettingAction("hoveredSegmentId", segmentId || null));
  },

  loadAdHocMesh(
    segmentId: number,
    seedPosition: Vector3,
    additionalCoordinates: AdditionalCoordinate[] | undefined | null,
  ) {
    dispatch(loadAdHocMeshAction(segmentId, seedPosition, additionalCoordinates));
  },

  loadPrecomputedMesh(
    segmentId: number,
    seedPosition: Vector3,
    seedAdditionalCoordinates: AdditionalCoordinate[] | undefined | null,
    meshFileName: string,
  ) {
    dispatch(
      loadPrecomputedMeshAction(segmentId, seedPosition, seedAdditionalCoordinates, meshFileName),
    );
  },

  setActiveCell(
    segmentId: number,
    somePosition?: Vector3,
    someAdditionalCoordinates?: AdditionalCoordinate[] | null,
  ) {
    dispatch(setActiveCellAction(segmentId, somePosition, someAdditionalCoordinates));
  },

  setCurrentMeshFile(layerName: string, fileName: string) {
    dispatch(updateCurrentMeshFileAction(layerName, fileName));
  },

  setPosition(position: Vector3) {
    dispatch(setPositionAction(position));
  },

  setAdditionalCoordinates(additionalCoordinates: AdditionalCoordinate[] | undefined | null) {
    if (
      getAdditionalCoordinatesAsString(Store.getState().flycam.additionalCoordinates) !==
      getAdditionalCoordinatesAsString(additionalCoordinates)
    ) {
      dispatch(setAdditionalCoordinatesAction(additionalCoordinates));
    }
  },

  updateSegments(
    segmentIds: number[],
    segmentShape: Partial<Segment>,
    layerName: string,
    createsNewUndoState: boolean,
  ) {
    const actions = segmentIds.map((segmentId) =>
      updateSegmentAction(segmentId, segmentShape, layerName, undefined, createsNewUndoState),
    );
    Store.dispatch(batchUpdateGroupsAndSegmentsAction(actions));
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

  deleteSegmentData(segmentId: number, layerName: string, callback?: () => void) {
    dispatch(deleteSegmentDataAction(segmentId, layerName, callback));
  },
});

type DispatchProps = ReturnType<typeof mapDispatchToProps>;
type Props = DispatchProps & StateProps;
type State = {
  renamingCounter: number;
  activeMeshJobId: string | null | undefined;
  groupTree: SegmentHierarchyNode[];
  searchableTreeItemList: SegmentHierarchyNode[];
  prevProps: Props | null | undefined;
  groupToDelete: number | null | undefined;
  activeStatisticsModalGroupId: number | null;
  contextMenuPosition: [number, number] | null | undefined;
  menu: MenuProps | null | undefined;
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

function renderEmptyMeshFileSelect() {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="No mesh file found. Click the + icon to compute a mesh file."
    />
  );
}

const getExpandedKeys = (segmentGroups: TreeGroup[]) => {
  return getExpandedGroups(segmentGroups).map((group) => getGroupNodeKey(group.groupId));
};

const getExpandedKeysWithRoot = memoize((segmentGroups: TreeGroup[]) => {
  const expandedGroups = getExpandedKeys(segmentGroups);
  expandedGroups.unshift(getGroupNodeKey(MISSING_GROUP_ID));
  return expandedGroups;
});

function constructTreeData(
  groups: { name: string; groupId: number; children: SegmentGroup[] }[],
  groupToSegmentsMap: Record<number, Segment[]>,
): SegmentHierarchyNode[] {
  // Insert all trees into their respective groups in the group hierarchy and transform groups to tree nodes
  return _.sortBy(groups, "groupId").map((group) => {
    const { groupId } = group;
    const segments = groupToSegmentsMap[groupId] || [];
    const treeNode: SegmentHierarchyNode = {
      ...group,
      title: group.name,
      key: getGroupNodeKey(groupId),
      id: groupId,
      type: "group",
      children: constructTreeData(group.children, groupToSegmentsMap).concat(
        _.sortBy(segments, "id").map(
          (segment): SegmentHierarchyNode => ({
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

const rootGroup = {
  name: "Root",
  groupId: MISSING_GROUP_ID,
  key: getGroupNodeKey(MISSING_GROUP_ID),
  children: [],
  isExpanded: true,
};

class SegmentsView extends React.Component<Props, State> {
  intervalID: ReturnType<typeof setTimeout> | null | undefined;
  state: State = {
    renamingCounter: 0,
    activeMeshJobId: null,
    groupTree: [],
    searchableTreeItemList: [],
    prevProps: null,
    groupToDelete: null,
    activeStatisticsModalGroupId: null,
    contextMenuPosition: null,
    menu: null,
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

    if (
      this.props.dataset.dataStore.jobsEnabled &&
      this.props.dataset.dataStore.jobsSupportedByAvailableWorkers.includes(
        APIJobType.COMPUTE_MESH_FILE,
      )
    ) {
      this.pollJobData();
    }

    Store.dispatch(ensureSegmentIndexIsLoadedAction(this.props.visibleSegmentationLayer?.name));
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.visibleSegmentationLayer !== this.props.visibleSegmentationLayer) {
      Store.dispatch(
        maybeFetchMeshFilesAction(this.props.visibleSegmentationLayer, this.props.dataset, false),
      );
    }

    // Scroll to selected segment.
    // The selection of the newly added segment, that wasn't in the segment list before,
    // triggers this function. Technically the segment is now present in the tree due
    // to the design in the volumetracing_saga, and it can also be found while debugging
    // this class. But in the scrollTo function, the new segment isn't found right away
    // in the tree data, thus the timeout is used as a work-around.

    setTimeout(() => {
      if (this.tree?.current == null) {
        return;
      }
      if (
        this.props.selectedIds.segments.length === 1 &&
        prevProps.selectedIds.segments[0] !== this.props.selectedIds.segments[0]
      ) {
        const selectedId = this.props.selectedIds.segments[0];
        this.tree.current.scrollTo({ key: `segment-${selectedId}` });
      }
    }, 100);
  }

  componentWillUnmount() {
    if (this.intervalID != null) {
      clearTimeout(this.intervalID);
    }
  }

  getExpandedGroupKeys = () => getExpandedKeysWithRoot(this.props.segmentGroups);

  getKeysOfSubGroups = (groupId: number) => {
    if (groupId !== MISSING_GROUP_ID) {
      return getGroupByIdWithSubgroups(this.props.segmentGroups, groupId)
        .filter((group) => group !== groupId)
        .map((group) => getGroupNodeKey(group));
    }
    const allSegmentGroups = this.props.segmentGroups.flatMap((group) =>
      getGroupByIdWithSubgroups(this.props.segmentGroups, group.groupId),
    );
    return allSegmentGroups.map((group) => getGroupNodeKey(group));
  };

  setExpandedGroupsFromArray = (expandedGroupsArray: Key[]) => {
    if (this.props.visibleSegmentationLayer == null) return;
    const expandedGroupSet = new Set(expandedGroupsArray as string[]);
    Store.dispatch(
      setExpandedSegmentGroupsAction(expandedGroupSet, this.props.visibleSegmentationLayer?.name),
    );
  };

  setExpandedGroupsFromSet = (expandedGroupsSet: Set<string>) => {
    if (this.props.visibleSegmentationLayer == null) return;
    Store.dispatch(
      setExpandedSegmentGroupsAction(expandedGroupsSet, this.props.visibleSegmentationLayer?.name),
    );
  };

  collapseGroups = (groupsToCollapse: string[]) => {
    if (this.props.visibleSegmentationLayer == null) return;
    const newExpandedGroups = _.difference(this.getExpandedGroupKeys(), groupsToCollapse);
    const expandedGroupSet = new Set(newExpandedGroups);
    Store.dispatch(
      setExpandedSegmentGroupsAction(expandedGroupSet, this.props.visibleSegmentationLayer.name),
    );
  };

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

    let newSelectedKeys: string[];
    if (ctrlPick) {
      newSelectedKeys = keys as string[];
    } else {
      newSelectedKeys = [key as string];
    }
    const selectedIdsForCaseDistinction = this.getSegmentOrGroupIdsForKeys(keys as string[]);
    const selectedIdsForState = this.getSegmentOrGroupIdsForKeys(newSelectedKeys);
    const visibleSegmentationLayer = this.props.visibleSegmentationLayer;
    if (visibleSegmentationLayer == null) return;
    if (
      selectedIdsForCaseDistinction.group != null &&
      selectedIdsForCaseDistinction.segments.length > 0
    ) {
      if (selectedIdsForCaseDistinction.segments.length > 1) {
        Modal.confirm({
          title: "Do you really want to select this group?",
          content: `You have ${selectedIdsForCaseDistinction.segments.length} selected segments. Do you really want to select this group?
        This will deselect all selected segments.`,
          onOk: () => {
            Store.dispatch(
              setSelectedSegmentsOrGroupAction(
                [],
                selectedIdsForState.group,
                visibleSegmentationLayer.name,
              ),
            );
          },
          onCancel() {},
        });
      } else {
        // If only one segment is selected, select group without warning (and vice-versa) even though ctrl is pressed.
        // This behaviour is imitated from the skeleton tab.
        const selectedIds = this.getSegmentOrGroupIdsForKeys([key]);
        Store.dispatch(
          setSelectedSegmentsOrGroupAction(
            selectedIds.segments,
            selectedIds.group,
            visibleSegmentationLayer.name,
          ),
        );
      }
      return;
    }
    Store.dispatch(
      setSelectedSegmentsOrGroupAction(
        selectedIdsForState.segments,
        selectedIdsForState.group,
        visibleSegmentationLayer?.name,
      ),
    );
  };

  static getDerivedStateFromProps(nextProps: Props, prevState: State) {
    const { segments, segmentGroups } = nextProps;
    if (segments == null) {
      return { prevProps: nextProps };
    }
    let updateStateObject: Partial<State> | null = null;
    const groupToSegmentsMap = createGroupToSegmentsMap(segments);
    const rootGroupWithChildren = {
      ...rootGroup,
      children: segmentGroups,
    };
    if (
      prevState.prevProps?.segments !== segments ||
      prevState.prevProps?.segmentGroups !== segmentGroups
    ) {
      // Insert the segments into the corresponding groups and create a
      // groupTree object that can be rendered using the antd Tree component
      const generatedGroupTree = constructTreeData([rootGroupWithChildren], groupToSegmentsMap);

      // Traverse the tree hierarchy so that we get a list of segments and groups
      // that is in the same order as the rendered tree. That way, cycling through
      // the search results will not jump "randomly".
      const searchableTreeItemList: SegmentHierarchyNode[] = [];
      function visitAllItems(
        nodes: Array<SegmentHierarchyNode>,
        callback: (group: SegmentHierarchyNode) => void,
      ) {
        for (const node of nodes) {
          callback(node);
          if ("children" in node) {
            visitAllItems(node.children, callback);
          }
        }
      }
      visitAllItems(generatedGroupTree, (item: SegmentHierarchyNode) => {
        searchableTreeItemList.push(item);
      });
      updateStateObject = {
        groupTree: generatedGroupTree,
        searchableTreeItemList,
        prevProps: nextProps,
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

    if (
      !this.props.dataset.dataStore.jobsSupportedByAvailableWorkers.includes(
        APIJobType.COMPUTE_MESH_FILE,
      )
    ) {
      title = "Mesh computation jobs are not enabled for this WEBKNOSSOS instance.";
    } else if (this.props.activeUser == null) {
      title = "Please log in to precompute the meshes of this dataset.";
    } else if (!this.props.dataset.dataStore.jobsEnabled) {
      title =
        "Meshes Computation is not supported for datasets that are not natively hosted on the server. Upload your dataset directly to webknossos.org to use this feature.";
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
    const visibleSegmentationLayer = this.props.visibleSegmentationLayer;
    if (visibleSegmentationLayer == null) {
      Toast.info(
        <React.Fragment>
          Cannot select segment, because there is no visible segmentation layer.
        </React.Fragment>,
      );
      return;
    }
    Store.dispatch(
      setSelectedSegmentsOrGroupAction([segment.id], null, visibleSegmentationLayer.name),
    );

    if (!segment.somePosition) {
      Toast.info(
        <React.Fragment>
          Cannot go to this segment, because its position is unknown.
        </React.Fragment>,
      );
      return;
    }
    this.props.setPosition(segment.somePosition);
    const segmentAdditionalCoordinates = segment.someAdditionalCoordinates;
    if (segmentAdditionalCoordinates != null) {
      this.props.setAdditionalCoordinates(segmentAdditionalCoordinates);
    }
  };

  startComputingMeshfile = async () => {
    const {
      mappingInfo,
      preferredQualityForMeshPrecomputation,
      magInfoOfVisibleSegmentationLayer,
    } = this.props;
    const defaultOrHigherIndex = magInfoOfVisibleSegmentationLayer.getIndexOrClosestHigherIndex(
      preferredQualityForMeshPrecomputation,
    );
    const meshfileMagIndex =
      defaultOrHigherIndex != null
        ? defaultOrHigherIndex
        : magInfoOfVisibleSegmentationLayer.getClosestExistingIndex(
            preferredQualityForMeshPrecomputation,
          );
    const meshfileMag = magInfoOfVisibleSegmentationLayer.getMagByIndexWithFallback(
      meshfileMagIndex,
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
        this.props.dataset.id,
        getBaseSegmentationName(this.props.visibleSegmentationLayer),
        meshfileMag,
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

  handleQualityChangeForPrecomputation = (magIndex: number) =>
    Store.dispatch(updateTemporarySettingAction("preferredQualityForMeshPrecomputation", magIndex));

  handleQualityChangeForAdHocGeneration = (magIndex: number) =>
    Store.dispatch(
      updateTemporarySettingAction("preferredQualityForMeshAdHocComputation", magIndex),
    );

  getAdHocMeshSettings = () => {
    const { preferredQualityForMeshAdHocComputation, magInfoOfVisibleSegmentationLayer: magInfo } =
      this.props;
    return (
      <div>
        <FastTooltip title="The higher the quality, the more computational resources are required">
          <div>Quality for Ad-Hoc Mesh Computation:</div>
        </FastTooltip>
        <Select
          size="small"
          style={{
            width: 220,
          }}
          value={magInfo.getClosestExistingIndex(preferredQualityForMeshAdHocComputation)}
          onChange={this.handleQualityChangeForAdHocGeneration}
        >
          {magInfo
            .getMagsWithIndices()
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
    const { preferredQualityForMeshPrecomputation, magInfoOfVisibleSegmentationLayer: magInfo } =
      this.props;
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
            <FastTooltip title="The higher the quality, the more computational resources are required">
              Quality for Mesh Precomputation:
            </FastTooltip>
          </div>

          <Select
            size="small"
            style={{
              width: 220,
            }}
            value={magInfo.getClosestExistingIndex(preferredQualityForMeshPrecomputation)}
            onChange={this.handleQualityChangeForPrecomputation}
          >
            {magInfo
              .getMagsWithIndices()
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
          <FastTooltip title={title}>
            <Button
              size="large"
              loading={this.state.activeMeshJobId != null}
              type="primary"
              disabled={disabled}
              onClick={this.startComputingMeshfile}
            >
              Precompute Meshes
            </Button>
          </FastTooltip>
        </div>
      </div>
    );
  };

  getMeshesHeader = () => (
    <>
      <FastTooltip title="Select a mesh file from which precomputed meshes will be loaded.">
        <ConfigProvider
          renderEmpty={renderEmptyMeshFileSelect}
          theme={{ cssVar: { key: "antd-app-theme" } }}
        >
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
            popupMatchSelectWidth={false}
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
      </FastTooltip>
      <FastTooltip title="Refresh list of available Mesh files">
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
          className="icon-margin-right"
        >
          Reload from Server
        </ReloadOutlined>
      </FastTooltip>
      <FastTooltip title="Add a precomputed mesh file">
        <Popover content={this.getPreComputeMeshesPopover} trigger="click" placement="bottom">
          <PlusOutlined className="icon-margin-right" />
        </Popover>
      </FastTooltip>
      {this.state.activeMeshJobId != null ? (
        <FastTooltip title='A mesh file is currently being computed. See "Processing Jobs" for more information.'>
          <LoadingOutlined className="icon-margin-right" />
        </FastTooltip>
      ) : null}
      <FastTooltip title="Configure ad-hoc mesh computation">
        <Popover content={this.getAdHocMeshSettings} trigger="click" placement="bottom">
          <SettingOutlined />
        </Popover>
      </FastTooltip>
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

  getSetGroupColorMenuItem = (groupId: number | null): ItemType => {
    return {
      key: "changeGroupColor",
      icon: <i className="fas fa-eye-dropper fa-sm fa-icon fa-fw" />,
      label: (
        <ChangeColorMenuItemContent
          title="Change Segment Color"
          isDisabled={false}
          onSetColor={(color) => {
            if (getVisibleSegmentationLayer == null) {
              return;
            }
            this.setGroupColor(groupId, color);
          }}
          rgb={this.getColorOfFirstSegmentOrGrey(groupId)}
        />
      ),
    };
  };

  getResetGroupColorMenuItem = (groupId: number | null): ItemType => {
    const title = "Reset Segment Color";
    return {
      key: "resetGroupColor",
      icon: <i className="fas fa-undo" />,
      label: (
        <div
          title={title}
          onClick={() => {
            if (getVisibleSegmentationLayer == null) {
              return;
            }
            this.setGroupColor(groupId, null);
            this.hideContextMenu();
          }}
        >
          Reset Segment Color
        </div>
      ),
    };
  };

  getRemoveFromSegmentListMenuItem = (groupId: number | null): ItemType => {
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
            this.hideContextMenu();
          }}
        >
          Remove Segments From List
        </div>
      ),
    };
  };

  getColorOfFirstSegmentOrGrey = (groupId: number | null) => {
    const relevantSegments =
      groupId != null ? this.getSegmentsOfGroupRecursively(groupId) : this.getSelectedSegments();
    if (relevantSegments[0]?.color == null) {
      return [0.5, 0.5, 0.5] as Vector3;
    }
    return relevantSegments[0].color;
  };

  getComputeMeshesAdHocMenuItem = (groupId: number | null): ItemType => {
    return {
      key: "computeAdHoc",
      icon: <i className="fas fa-dice-d20 fa-fw fa-icon" />,
      label: (
        <div
          onClick={() => {
            if (this.props.visibleSegmentationLayer == null) {
              return;
            }
            this.handleLoadMeshesAdHoc(groupId);
            this.getToastForMissingPositions(groupId);
            this.hideContextMenu();
          }}
        >
          Compute Meshes (ad hoc)
        </div>
      ),
    };
  };

  getShowSegmentStatistics = (id: number): ItemType => {
    if (!this.props.isSegmentIndexAvailable) return null;
    return {
      key: "segmentStatistics",
      label: (
        <>
          <div
            onClick={() => {
              this.setState({ activeStatisticsModalGroupId: id });
              this.hideContextMenu();
            }}
          >
            Show Segment Statistics
          </div>
        </>
      ),
      icon: <i className="fas fa-ruler fa-fw fa-icon" />,
    };
  };

  getLoadMeshesFromFileMenuItem = (groupId: number | null): ItemType => {
    return {
      key: "loadByFile",
      disabled: this.props.currentMeshFile == null,
      icon: <i className="fas fa-dice-d20 fa-icon fa-fw" />,
      label: (
        <div
          onClick={() => {
            if (this.props.visibleSegmentationLayer == null) {
              return;
            }
            this.handleLoadMeshesFromFile(groupId);
            this.getToastForMissingPositions(groupId);
            this.hideContextMenu();
          }}
        >
          Load Meshes (precomputed)
        </div>
      ),
    };
  };

  getReloadMenuItem = (groupId: number | null): ItemType => {
    return this.state != null && this.doesGroupHaveAnyMeshes(groupId)
      ? {
          key: "reloadMeshes",
          icon: <ReloadOutlined />,
          label: (
            <div
              onClick={() => {
                this.handleRefreshMeshes(groupId);
                this.hideContextMenu();
              }}
            >
              Refresh Meshes
            </div>
          ),
        }
      : null;
  };

  getRemoveMeshesMenuItem = (groupId: number | null): ItemType => {
    return this.state != null && this.doesGroupHaveAnyMeshes(groupId)
      ? {
          key: "removeMeshes",
          icon: <DeleteOutlined />,
          label: (
            <div
              onClick={() => {
                this.handleRemoveMeshes(groupId);
                this.hideContextMenu();
              }}
            >
              Remove Meshes
            </div>
          ),
        }
      : null;
  };

  getDownLoadMeshesMenuItem = (groupId: number | null): ItemType => {
    return this.state != null && this.doesGroupHaveAnyMeshes(groupId)
      ? {
          key: "downloadAllMeshes",
          icon: <DownloadOutlined />,
          label: (
            <div
              onClick={() => {
                this.downloadAllMeshesForGroup(groupId);
                this.hideContextMenu();
              }}
            >
              Download Meshes
            </div>
          ),
        }
      : null;
  };

  getMoveSegmentsHereMenuItem = (groupId: number): ItemType => {
    return this.props.selectedIds != null
      ? {
          key: "moveHere",
          onClick: () => {
            if (this.props.visibleSegmentationLayer == null) {
              // Satisfy TS
              return;
            }
            this.props.updateSegments(
              this.props.selectedIds.segments,
              { groupId },
              this.props.visibleSegmentationLayer.name,
              true,
            );
            this.hideContextMenu();
          },
          disabled: !this.props.allowUpdate,
          icon: <ArrowRightOutlined />,
          label: `Move active ${pluralize("segment", this.props.selectedIds.segments.length)} here`,
        }
      : null;
  };

  getMeshVisibilityStateForSegments = (
    groupId: number | null,
  ): { areSomeMeshesVisible: boolean; areSomeMeshesInvisible: boolean } => {
    const selectedSegments =
      groupId == null ? this.getSelectedSegments() : this.getSegmentsOfGroupRecursively(groupId);

    const meshes = this.props.meshes;
    const areSomeMeshesInvisible = selectedSegments.some((segment) => {
      const segmentMesh = meshes[segment.id];
      return segmentMesh != null && !meshes[segment.id].isVisible;
    });
    const areSomeMeshesVisible = selectedSegments.some((segment) => {
      const segmentMesh = meshes[segment.id];
      return segmentMesh != null && meshes[segment.id].isVisible;
    });
    return { areSomeMeshesInvisible, areSomeMeshesVisible };
  };

  maybeGetShowOrHideMeshesMenuItems = (groupId: number | null): ItemType[] => {
    if (!this.doesGroupHaveAnyMeshes(groupId)) {
      return [];
    }
    const { areSomeMeshesInvisible, areSomeMeshesVisible } =
      this.getMeshVisibilityStateForSegments(groupId);
    const menuOptions: ItemType[] = [];
    const changeVisibility = (isVisible: boolean) => {
      if (this.props.visibleSegmentationLayer == null) {
        // Satisfy TS
        return;
      }
      this.handleChangeMeshVisibilityInGroup(
        this.props.visibleSegmentationLayer.name,
        groupId,
        isVisible,
      );
      this.hideContextMenu();
    };
    if (areSomeMeshesInvisible) {
      menuOptions.push({
        key: "showMeshes",
        icon: <EyeOutlined />,
        label: <div onClick={() => changeVisibility(true)}>Show Meshes</div>,
      });
    }
    if (areSomeMeshesVisible) {
      menuOptions.push({
        key: "hideMeshes",
        icon: <EyeInvisibleOutlined />,
        label: <div onClick={() => changeVisibility(false)}>Hide Meshes</div>,
      });
    }
    return menuOptions;
  };

  setGroupColor(groupId: number | null, color: Vector3 | null) {
    const { visibleSegmentationLayer } = this.props;
    if (visibleSegmentationLayer == null) return;
    const relevantSegments =
      groupId != null ? this.getSegmentsOfGroupRecursively(groupId) : this.getSelectedSegments();
    if (relevantSegments == null) return;

    const actions = relevantSegments.map((segment) =>
      updateSegmentAction(segment.id, { color: color }, visibleSegmentationLayer.name),
    );

    Store.dispatch(batchUpdateGroupsAndSegmentsAction(actions));
  }

  handleRefreshMeshes = (groupId: number | null) => {
    const { visibleSegmentationLayer, meshes } = this.props;
    if (visibleSegmentationLayer == null) return;

    this.handlePerSegment(groupId, (segment) => {
      if (meshes[segment.id] != null) {
        Store.dispatch(refreshMeshAction(visibleSegmentationLayer.name, segment.id));
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
    Store.dispatch(setSelectedSegmentsOrGroupAction([], null, visibleSegmentationLayer.name));
  };

  handleRemoveMeshes = (groupId: number | null) => {
    const { visibleSegmentationLayer, meshes } = this.props;
    if (visibleSegmentationLayer == null) return;
    this.handlePerSegment(groupId, (segment) => {
      if (meshes[segment.id] != null) {
        Store.dispatch(removeMeshAction(visibleSegmentationLayer.name, segment.id));
      }
    });
  };

  handleChangeMeshVisibilityInGroup = (
    layerName: string,
    groupId: number | null,
    isVisible: boolean,
  ) => {
    const { flycam } = Store.getState();
    const { meshes } = this.props;
    const additionalCoordinates = flycam.additionalCoordinates;
    this.handlePerSegment(groupId, (segment) => {
      if (meshes[segment.id] != null) {
        Store.dispatch(
          updateMeshVisibilityAction(layerName, segment.id, isVisible, additionalCoordinates),
        );
      }
    });
  };

  handleLoadMeshesAdHoc = (groupId: number | null) => {
    const { flycam } = Store.getState();

    this.handlePerSegment(groupId, (segment) => {
      if (segment.somePosition == null) return;
      this.props.loadAdHocMesh(segment.id, segment.somePosition, flycam.additionalCoordinates);
    });
  };

  getSegmentsWithMissingPosition = (groupId: number | null): number[] => {
    const relevantSegments =
      groupId != null ? this.getSegmentsOfGroupRecursively(groupId) : this.getSelectedSegments();
    if (relevantSegments == null) return [];
    const segmentsWithoutPosition = relevantSegments
      .filter((segment) => segment.somePosition == null)
      .map((segment) => segment.id);
    return segmentsWithoutPosition.sort();
  };

  getSelectedSegments = (): Segment[] => {
    const allSegments = this.props.segments;
    if (allSegments == null) return [];
    return this.props.selectedIds.segments.map((segmentId) => allSegments.getOrThrow(segmentId));
  };

  getSelectedItemKeys = () => {
    const mappedIdsToKeys = this.props.selectedIds.segments.map(
      (segmentId) => `segment-${segmentId}`,
    );
    if (this.props.selectedIds.group != null) {
      return mappedIdsToKeys.concat(getGroupNodeKey(this.props.selectedIds.group));
    }
    return mappedIdsToKeys;
  };

  getSegmentOrGroupIdsForKeys = (segmentOrGroupKeys: string[]) => {
    const selectedIds: { segments: number[]; group: number | null } = { segments: [], group: null };
    const groupPrefix = "Group-";
    segmentOrGroupKeys.forEach((key) => {
      if (key.startsWith(groupPrefix)) {
        // Note that negative ids can be found here, which is why Group- is used as a splitter
        const idWithSign = key.split(groupPrefix)[1];
        if (isNumber(Number.parseInt(idWithSign))) {
          selectedIds.group = Number.parseInt(idWithSign);
        }
      } else if (key.startsWith("segment-")) {
        // there should be no negative segment IDs
        const regexSplit = key.split("-");
        if (isNumber(Number.parseInt(regexSplit[1]))) {
          selectedIds.segments.push(Number.parseInt(regexSplit[1]));
        }
      }
    });
    return selectedIds;
  };

  handlePerSegment(groupId: number | null, callback: (s: Segment) => void) {
    const { visibleSegmentationLayer } = this.props;
    if (visibleSegmentationLayer == null) return;
    const relevantSegments =
      groupId != null ? this.getSegmentsOfGroupRecursively(groupId) : this.getSelectedSegments();
    relevantSegments?.forEach(callback);
  }

  handleLoadMeshesFromFile = (groupId: number | null) => {
    this.handlePerSegment(groupId, (segment: Segment) => {
      if (segment.somePosition == null || this.props.currentMeshFile == null) return;
      this.props.loadPrecomputedMesh(
        segment.id,
        segment.somePosition,
        segment.someAdditionalCoordinates,
        this.props.currentMeshFile.meshFileName,
      );
    });
  };

  downloadAllMeshesForGroup = (groupId: number | null) => {
    const { visibleSegmentationLayer } = this.props;
    if (visibleSegmentationLayer == null) return;
    const relevantSegments =
      groupId != null ? this.getSegmentsOfGroupRecursively(groupId) : this.getSelectedSegments();
    if (relevantSegments == null) return;

    const segmentsArray = relevantSegments.map((segment) => {
      return {
        segmentName: segment.name ? segment.name : "mesh",
        segmentId: segment.id,
        layerName: visibleSegmentationLayer.name,
      };
    });
    Store.dispatch(triggerMeshesDownloadAction(segmentsArray));
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
    const { visibleSegmentationLayer } = this.props;
    if (visibleSegmentationLayer) {
      api.tracing.deleteSegmentGroup(groupId, deleteChildren, visibleSegmentationLayer.name);
    }
  }

  getSegmentsOfGroupRecursively = (groupId: number): Segment[] => {
    const { segments, segmentGroups } = this.props;

    if (segments == null || segmentGroups == null) {
      return [];
    }
    if (groupId === MISSING_GROUP_ID) {
      return Array.from(segments.values());
    }
    const groupToSegmentsMap = createGroupToSegmentsMap(segments);
    const relevantGroupIds = getGroupByIdWithSubgroups(segmentGroups, groupId);
    const segmentIdsNested = relevantGroupIds
      .map((groupId) => (groupToSegmentsMap[groupId] != null ? groupToSegmentsMap[groupId] : null))
      .filter((x) => x != null);
    return segmentIdsNested.flat() as Segment[];
  };

  onRenameStart = () => {
    this.setState(({ renamingCounter }) => ({ renamingCounter: renamingCounter + 1 }));
  };

  onRenameEnd = () => {
    this.setState(({ renamingCounter }) => ({ renamingCounter: renamingCounter - 1 }));
  };

  maybeExpandParentGroup = (selectedElement: SegmentHierarchyNode) => {
    if (this.tree?.current == null) {
      return;
    }
    const groupToExpand =
      selectedElement.type === "segment"
        ? selectedElement.groupId
        : createGroupToParentMap(this.props.segmentGroups)[selectedElement.id];
    const expandedGroups = additionallyExpandGroup(
      this.props.segmentGroups,
      groupToExpand,
      getGroupNodeKey,
    );
    if (expandedGroups) {
      this.setExpandedGroupsFromSet(expandedGroups);
    }
  };

  handleSearchSelect = (selectedElement: SegmentHierarchyNode) => {
    this.maybeExpandParentGroup(selectedElement);
    // As parent groups might still need to expand, we need to wait for this to finish.
    setTimeout(() => {
      if (this.tree.current) this.tree.current.scrollTo({ key: selectedElement.key });
    }, SCROLL_DELAY_MS);
    const isASegment = "color" in selectedElement;
    if (isASegment) {
      this.onSelectSegment(selectedElement);
    } else {
      if (this.props.visibleSegmentationLayer == null) return;
      Store.dispatch(
        setSelectedSegmentsOrGroupAction(
          [],
          selectedElement.id,
          this.props.visibleSegmentationLayer?.name,
        ),
      );
    }
  };

  handleSelectAllMatchingSegments = (allMatches: SegmentHierarchyNode[]) => {
    if (this.props.visibleSegmentationLayer == null) return;
    const allMatchingSegmentIds = allMatches.map((match) => {
      this.maybeExpandParentGroup(match);
      return match.id;
    });
    Store.dispatch(
      setSelectedSegmentsOrGroupAction(
        allMatchingSegmentIds,
        null,
        this.props.visibleSegmentationLayer.name,
      ),
    );
    setTimeout(() => {
      this.tree.current?.scrollTo({ key: allMatches[0].key });
    }, SCROLL_DELAY_MS);
  };

  getSegmentStatisticsModal = (groupId: number) => {
    const visibleSegmentationLayer = this.props.visibleSegmentationLayer;
    if (visibleSegmentationLayer == null) {
      return null;
    }
    if (this.state.activeStatisticsModalGroupId !== groupId) {
      return null;
    }
    const segments = this.getSegmentsOfGroupRecursively(groupId);
    if (segments.length === 0) {
      return null;
    }
    return (
      <SegmentStatisticsModal
        onCancel={() => {
          this.setState({ activeStatisticsModalGroupId: null });
        }}
        visibleSegmentationLayer={visibleSegmentationLayer}
        tracingId={this.props.activeVolumeTracing?.tracingId}
        relevantSegments={segments}
        parentGroup={groupId}
        groupTree={this.state.searchableTreeItemList}
      />
    );
  };

  showContextMenuAt = (xPos: number, yPos: number, menu: MenuProps) => {
    // On Windows the right click to open the context menu is also triggered for the overlay
    // of the context menu. This causes the context menu to instantly close after opening.
    // Therefore delay the state update to delay that the context menu is rendered. Thus
    // the context overlay does not get the right click as an event and therefore does not close.
    setTimeout(
      () =>
        this.setState({
          contextMenuPosition: [xPos, yPos],
          menu,
        }),
      0,
    );
  };

  hideContextMenu = () => {
    this.setState({ contextMenuPosition: null, menu: null });
  };

  getMultiSelectMenu = (): MenuProps => {
    const doSelectedSegmentsHaveAnyMeshes = this.doesGroupHaveAnyMeshes(null);
    return {
      items: _.flatten([
        this.getLoadMeshesFromFileMenuItem(null),
        this.getComputeMeshesAdHocMenuItem(null),
        doSelectedSegmentsHaveAnyMeshes ? this.maybeGetShowOrHideMeshesMenuItems(null) : null,
        doSelectedSegmentsHaveAnyMeshes ? this.getReloadMenuItem(null) : null,
        doSelectedSegmentsHaveAnyMeshes ? this.getRemoveMeshesMenuItem(null) : null,
        doSelectedSegmentsHaveAnyMeshes ? this.getDownLoadMeshesMenuItem(null) : null,
        this.getSetGroupColorMenuItem(null),
        this.getResetGroupColorMenuItem(null),
        this.getRemoveFromSegmentListMenuItem(null),
      ]),
    };
  };

  render() {
    const { groupToDelete } = this.state;

    return (
      <div id={segmentsTabId} className="padded-tab-content">
        <ContextMenuContainer
          hideContextMenu={this.hideContextMenu}
          contextMenuPosition={this.state.contextMenuPosition}
          menu={this.state.menu}
          className="segment-list-context-menu-overlay"
        />
        <DomVisibilityObserver targetId={segmentsTabId}>
          {(isVisibleInDom) => {
            if (!isVisibleInDom) return null;
            const allSegments = this.props.segments;
            const isSegmentHierarchyEmpty = !(
              allSegments?.size() || this.props.segmentGroups.length
            );

            if (!this.props.visibleSegmentationLayer) {
              return (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No segmentation layer visible."
                />
              );
            }

            const titleRender = (treeItem: SegmentHierarchyNode) => {
              if (treeItem.type === "segment") {
                const segment = treeItem;
                return (
                  <SegmentListItem
                    showContextMenuAt={this.showContextMenuAt}
                    hideContextMenu={this.hideContextMenu}
                    key={segment.id}
                    segment={segment}
                    selectedSegmentIds={this.props.selectedIds.segments}
                    onSelectSegment={this.onSelectSegment}
                    mesh={this.props.meshes[segment.id]}
                    mappingInfo={this.props.mappingInfo}
                    activeCellId={this.props.activeCellId}
                    setHoveredSegmentId={this.props.setHoveredSegmentId}
                    allowUpdate={this.props.allowUpdate}
                    updateSegment={this.props.updateSegment}
                    removeSegment={this.props.removeSegment}
                    deleteSegmentData={this.props.deleteSegmentData}
                    visibleSegmentationLayer={this.props.visibleSegmentationLayer}
                    loadAdHocMesh={this.props.loadAdHocMesh}
                    loadPrecomputedMesh={this.props.loadPrecomputedMesh}
                    setActiveCell={this.props.setActiveCell}
                    setPosition={this.props.setPosition}
                    setAdditionalCoordinates={this.props.setAdditionalCoordinates}
                    currentMeshFile={this.props.currentMeshFile}
                    onRenameStart={this.onRenameStart}
                    onRenameEnd={this.onRenameEnd}
                    getMultiSelectMenu={this.getMultiSelectMenu}
                    activeVolumeTracing={this.props.activeVolumeTracing}
                  />
                );
              } else {
                const { id, name } = treeItem;
                const isEditingDisabled = !this.props.allowUpdate;
                const onOpenContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
                  event.preventDefault();
                  const getMenu = (): MenuProps => ({
                    items: _.flatten([
                      {
                        key: "create",
                        onClick: () => {
                          this.createGroup(id);
                          this.hideContextMenu();
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
                          this.hideContextMenu();
                        },
                        icon: <DeleteOutlined />,
                        label: "Delete group",
                      },
                      this.getExpandSubgroupsItem(id),
                      this.getCollapseSubgroupsItem(id),
                      this.getMoveSegmentsHereMenuItem(id),
                      {
                        key: "groupAndMeshActionDivider",
                        label: <Divider style={{ marginBottom: 0, marginTop: 0 }} />,
                        disabled: true,
                      },
                      this.getSetGroupColorMenuItem(id),
                      this.getShowSegmentStatistics(id),
                      this.getLoadMeshesFromFileMenuItem(id),
                      this.getComputeMeshesAdHocMenuItem(id),
                      this.getReloadMenuItem(id),
                      this.getRemoveMeshesMenuItem(id),
                      this.maybeGetShowOrHideMeshesMenuItems(id),
                      this.getDownLoadMeshesMenuItem(id),
                    ]),
                  });

                  const [x, y] = getContextMenuPositionFromEvent(
                    event,
                    "segment-list-context-menu-overlay",
                  );
                  this.showContextMenuAt(x, y, getMenu());
                };

                // Make sure the displayed name is not empty
                const displayableName = name?.trim() || "<Unnamed Group>";

                return (
                  <div onContextMenu={onOpenContextMenu}>
                    <EditableTextLabel
                      value={displayableName}
                      label="Group Name"
                      onChange={(name) => {
                        if (this.props.visibleSegmentationLayer != null) {
                          api.tracing.renameSegmentGroup(
                            id,
                            name,
                            this.props.visibleSegmentationLayer.name,
                          );
                        }
                      }}
                      margin="0 5px"
                      // The root group must not be removed or renamed
                      disableEditing={!this.props.allowUpdate || id === MISSING_GROUP_ID}
                      onRenameStart={this.onRenameStart}
                      onRenameEnd={this.onRenameEnd}
                    />
                    {this.getSegmentStatisticsModal(id)}
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
                    searchKey={(item) => getSegmentName(item)}
                    provideShortcut
                    targetId={segmentsTabId}
                    onSelectAllMatches={this.handleSelectAllMatchingSegments}
                  >
                    <ButtonComponent
                      size="small"
                      title="Open the search via CTRL + Shift + F"
                      style={{ marginRight: 8 }}
                    >
                      <SearchOutlined />
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
                    <ResizableSplitPane
                      firstChild={
                        <AutoSizer
                          // Without the default height, height will be 0 on the first render, leading
                          // to tree virtualization being disabled. This has a major performance impact.
                          defaultHeight={500}
                        >
                          {({ height, width }) => (
                            <div
                              style={{
                                height,
                                width,
                                overflow: "hidden",
                              }}
                            >
                              <ScrollableVirtualizedTree
                                allowDrop={this.allowDrop}
                                onDrop={this.onDrop}
                                onSelect={this.onSelectTreeItem}
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
                                    this.state.renamingCounter === 0 && this.props.allowUpdate,
                                }}
                                multiple
                                showLine
                                selectedKeys={this.getSelectedItemKeys()}
                                switcherIcon={<DownOutlined />}
                                treeData={this.state.groupTree}
                                titleRender={titleRender}
                                style={{
                                  marginTop: 12,
                                  marginLeft: -26, // hide switcherIcon for root group
                                  flex: "1 1 auto",
                                  overflow: "auto", // use hidden when not using virtualization
                                }}
                                ref={this.tree}
                                onExpand={this.setExpandedGroupsFromArray}
                                expandedKeys={this.getExpandedGroupKeys()}
                              />
                            </div>
                          )}
                        </AutoSizer>
                      }
                      secondChild={this.renderDetailsForSelection()}
                    />
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

  renameActiveSegment = (newName: string) => {
    if (this.props.visibleSegmentationLayer == null) {
      return;
    }
    const { segments } = this.props.selectedIds;
    if (segments.length !== 1) {
      return;
    }
    const segment = this.props.segments?.getNullable(segments[0]);
    if (segment == null) {
      return;
    }

    this.props.updateSegment(
      segment.id,
      { name: newName },
      this.props.visibleSegmentationLayer.name,
      true,
    );
  };

  renderDetailsForSelection() {
    const { segments: selectedSegmentIds, group: selectedGroupId } = this.props.selectedIds;
    if (selectedSegmentIds.length === 1) {
      const readOnly = !this.props.allowUpdate;
      const segment = this.props.segments?.getNullable(selectedSegmentIds[0]);
      if (segment == null) {
        return <>Cannot find details for selected segment.</>;
      }
      return (
        <table className="metadata-table">
          <thead>
            <SimpleRow isTableHead label="ID" value={segment.id} />
          </thead>
          <tbody>
            <SimpleRow
              label="Name"
              value={
                <InputWithUpdateOnBlur
                  value={segment.name || ""}
                  onChange={this.renameActiveSegment}
                />
              }
            />
            <MetadataEntryTableRows
              item={segment}
              setMetadata={this.setMetadata}
              readOnly={readOnly}
            />
          </tbody>
        </table>
      );
    } else if (selectedGroupId != null) {
      const { segmentGroups } = this.props;
      const activeGroup = findGroup(this.props.segmentGroups, selectedGroupId);
      if (!activeGroup || this.props.segments == null) {
        return null;
      }

      const groupToSegmentsMap = createGroupToSegmentsMap(this.props.segments);
      const groupWithSubgroups = getGroupByIdWithSubgroups(segmentGroups, selectedGroupId);

      return (
        <table className="metadata-table">
          <thead>
            <SimpleRow isTableHead label="ID" value={activeGroup.groupId} />
          </thead>
          <tbody>
            <SimpleRow
              label="Name"
              value={
                <InputWithUpdateOnBlur
                  value={activeGroup.name || ""}
                  onChange={(newName) => {
                    if (this.props.visibleSegmentationLayer == null) {
                      return;
                    }
                    api.tracing.renameSegmentGroup(
                      activeGroup.groupId,
                      newName,
                      this.props.visibleSegmentationLayer.name,
                    );
                  }}
                />
              }
            />

            {groupWithSubgroups.length === 1 ? (
              <SimpleRow
                label="Segment Count"
                value={groupToSegmentsMap[selectedGroupId]?.length ?? 0}
              />
            ) : (
              <>
                <SimpleRow
                  label="Segment Count (direct children)"
                  value={groupToSegmentsMap[selectedGroupId]?.length ?? 0}
                />
                <SimpleRow
                  label="Segment Count (all children)"
                  value={_.sum(
                    groupWithSubgroups.map((groupId) => groupToSegmentsMap[groupId]?.length ?? 0),
                  )}
                />
              </>
            )}
          </tbody>
        </table>
      );
    }
    return null;
  }

  setMetadata = (segment: Segment, newProperties: MetadataEntryProto[]) => {
    if (this.props.visibleSegmentationLayer == null) {
      return;
    }
    this.props.updateSegment(
      segment.id,
      {
        metadata: newProperties,
      },
      this.props.visibleSegmentationLayer.name,
      true,
    );
  };

  getExpandSubgroupsItem(groupId: number) {
    const children = this.getKeysOfSubGroups(groupId);
    const expandedGroupsSet = new Set(this.getExpandedGroupKeys());
    const areAllChildrenExpanded = children.every((childNode) => expandedGroupsSet.has(childNode));
    const isGroupItselfExpanded = expandedGroupsSet.has(getGroupNodeKey(groupId));
    if (areAllChildrenExpanded && isGroupItselfExpanded) {
      return null;
    }
    return {
      key: "expandAll",
      onClick: () => {
        const allExpandedGroups = children.concat(this.getExpandedGroupKeys());
        if (!isGroupItselfExpanded) allExpandedGroups.push(getGroupNodeKey(groupId));
        this.setExpandedGroupsFromArray(allExpandedGroups);
        this.hideContextMenu();
      },
      icon: <ExpandAltOutlined />,
      label: "Expand all subgroups",
    };
  }

  getCollapseSubgroupsItem(groupId: number) {
    const children = this.getKeysOfSubGroups(groupId);
    const expandedKeySet = new Set(this.getExpandedGroupKeys());
    const areAllChildrenCollapsed = children.every((childNode) => !expandedKeySet.has(childNode));
    const isGroupItselfCollapsed = !expandedKeySet.has(getGroupNodeKey(groupId));
    if (areAllChildrenCollapsed || isGroupItselfCollapsed) {
      return null;
    }
    return {
      key: "collapseAll",
      onClick: () => {
        this.collapseGroups(children);
        this.hideContextMenu();
      },
      icon: <ShrinkOutlined />,
      label: "Collapse all subgroups",
    };
  }

  createGroup(parentGroupId: number): void {
    if (!this.props.visibleSegmentationLayer) {
      return;
    }

    api.tracing.createSegmentGroup(null, parentGroupId, this.props.visibleSegmentationLayer.name);
  }

  doesGroupHaveAnyMeshes = (groupId: number | null): boolean => {
    const { visibleSegmentationLayer } = this.props;
    if (visibleSegmentationLayer == null) return false;
    const relevantSegments =
      groupId != null ? this.getSegmentsOfGroupRecursively(groupId) : this.getSelectedSegments();
    if (relevantSegments.length === 0) return false;
    const meshesOfLayer = this.props.meshes;
    return relevantSegments.some((segment) => meshesOfLayer[segment.id] != null);
  };

  onDrop = (dropInfo: {
    node: SegmentHierarchyNode | null;
    dragNode: SegmentHierarchyNode;
    dropToGap: boolean;
  }) => {
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
      // Segment(s) were dragged onto/next to a segment or group.
      // It is possible to drag a segment that was not selected. In that case, the selected segments are moved as well.
      const selectedSegmentIds = this.props.selectedIds.segments;
      this.props.updateSegments(
        [dragNode.id, ...selectedSegmentIds],
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

  allowDrop = ({
    dropNode,
    dropPosition,
  }: {
    dropNode: SegmentHierarchyNode;
    dropPosition: number;
  }) => {
    // Don't allow to drag a node inside of a segment, but only
    // next to it. If dropPosition is 0, the dragging action targets
    // the child of the hovered element (which should only be allowed
    // for groups).
    return "children" in dropNode || dropPosition !== 0;
  };
}

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(SegmentsView);

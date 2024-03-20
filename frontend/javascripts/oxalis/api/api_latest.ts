import PriorityQueue from "js-priority-queue";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'twee... Remove this comment to see the full error message
import TWEEN from "tween.js";
import _ from "lodash";
import type { Bucket, DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import { getConstructorForElementClass } from "oxalis/model/bucket_data_handling/bucket";
import { APICompoundType, APICompoundTypeEnum, ElementClass } from "types/api_flow_types";
import { InputKeyboardNoLoop } from "libs/input";
import { M4x4, Matrix4x4, V3, Vector16 } from "libs/mjs";
import type { Versions } from "oxalis/view/version_view";
import {
  addTreesAndGroupsAction,
  setActiveNodeAction,
  createCommentAction,
  deleteNodeAction,
  centerActiveNodeAction,
  deleteTreeAction,
  resetSkeletonTracingAction,
  setNodeRadiusAction,
  setTreeNameAction,
  setActiveTreeAction,
  setActiveTreeGroupAction,
  setActiveTreeByNameAction,
  setTreeColorIndexAction,
  setTreeVisibilityAction,
  setTreeGroupAction,
  setTreeGroupsAction,
  setTreeEdgeVisibilityAction,
} from "oxalis/model/actions/skeletontracing_actions";
import {
  bucketPositionToGlobalAddress,
  globalPositionToBucketPosition,
  scaleGlobalPositionWithResolution,
  zoomedAddressToZoomedPosition,
} from "oxalis/model/helpers/position_converter";
import {
  callDeep,
  createGroupToSegmentsMap,
  MISSING_GROUP_ID,
  moveGroupsHelper,
} from "oxalis/view/right-border-tabs/tree_hierarchy_view_helpers";
import { centerTDViewAction } from "oxalis/model/actions/view_mode_actions";
import { discardSaveQueuesAction } from "oxalis/model/actions/save_actions";
import {
  doWithToken,
  finishAnnotation,
  getMappingsForDatasetLayer,
  requestTask,
  downsampleSegmentation,
  sendAnalyticsEvent,
} from "admin/admin_rest_api";
import {
  findTreeByNodeId,
  getNodeAndTree,
  getNodeAndTreeOrNull,
  getActiveNode,
  getActiveTree,
  getActiveTreeGroup,
  getTree,
  getFlatTreeGroups,
  getTreeGroupsMap,
  mapGroups,
  getNodePosition,
} from "oxalis/model/accessors/skeletontracing_accessor";
import {
  getActiveCellId,
  getActiveSegmentationTracing,
  getNameOfRequestedOrVisibleSegmentationLayer,
  getRequestedOrDefaultSegmentationTracingLayer,
  getRequestedOrVisibleSegmentationLayer,
  getRequestedOrVisibleSegmentationLayerEnforced,
  getSegmentColorAsRGBA,
  getSegmentsForLayer,
  getVolumeDescriptors,
  getVolumeTracingById,
  getVolumeTracingByLayerName,
  getVolumeTracings,
  hasVolumeTracings,
} from "oxalis/model/accessors/volumetracing_accessor";
import { getHalfViewportExtentsFromState } from "oxalis/model/sagas/saga_selectors";
import {
  getLayerBoundingBox,
  getLayerByName,
  getResolutionInfo,
  getVisibleSegmentationLayer,
  getMappingInfo,
  flatToNestedMatrix,
} from "oxalis/model/accessors/dataset_accessor";
import {
  getPosition,
  getActiveMagIndexForLayer,
  getRotation,
} from "oxalis/model/accessors/flycam_accessor";
import {
  loadAdHocMeshAction,
  loadPrecomputedMeshAction,
} from "oxalis/model/actions/segmentation_actions";
import { loadAgglomerateSkeletonForSegmentId } from "oxalis/controller/combinations/segmentation_handlers";
import { overwriteAction } from "oxalis/model/helpers/overwrite_action_middleware";
import { parseNml } from "oxalis/model/helpers/nml_helpers";
import { rotate3DViewTo } from "oxalis/controller/camera_controller";
import {
  BatchableUpdateSegmentAction,
  batchUpdateGroupsAndSegmentsAction,
  clickSegmentAction,
  removeSegmentAction,
  setActiveCellAction,
  setSegmentGroupsAction,
  updateSegmentAction,
} from "oxalis/model/actions/volumetracing_actions";
import { setPositionAction, setRotationAction } from "oxalis/model/actions/flycam_actions";
import { setToolAction } from "oxalis/model/actions/ui_actions";
import {
  updateCurrentMeshFileAction,
  refreshMeshesAction,
  updateMeshVisibilityAction,
  removeMeshAction,
  dispatchMaybeFetchMeshFilesAsync,
} from "oxalis/model/actions/annotation_actions";
import {
  updateUserSettingAction,
  updateDatasetSettingAction,
  updateLayerSettingAction,
  setMappingAction,
  setMappingEnabledAction,
} from "oxalis/model/actions/settings_actions";
import { wkReadyAction, restartSagaAction } from "oxalis/model/actions/actions";
import type {
  BoundingBoxType,
  ControlMode,
  OrthoView,
  Vector3,
  Vector4,
  AnnotationTool,
  TypedArray,
  BucketAddress,
} from "oxalis/constants";
import Constants, {
  ControlModeEnum,
  OrthoViews,
  AnnotationToolEnum,
  TDViewDisplayModeEnum,
  MappingStatusEnum,
  EMPTY_OBJECT,
} from "oxalis/constants";
import DataLayer from "oxalis/model/data_layer";
import type { OxalisModel } from "oxalis/model";
import { Model } from "oxalis/singletons";
import Request from "libs/request";
import type {
  MappingType,
  DatasetConfiguration,
  Mapping,
  Node,
  SkeletonTracing,
  Tracing,
  TreeGroupTypeFlat,
  TreeMap,
  UserConfiguration,
  VolumeTracing,
  OxalisState,
  SegmentGroup,
  Segment,
  MutableNode,
} from "oxalis/store";
import Store from "oxalis/store";
import type { ToastStyle } from "libs/toast";
import Toast from "libs/toast";
import UrlManager from "oxalis/controller/url_manager";
import UserLocalStorage from "libs/user_local_storage";
import * as Utils from "libs/utils";
import dimensions from "oxalis/model/dimensions";
import messages from "messages";
import window, { location } from "libs/window";
import { coalesce } from "libs/utils";
import { setLayerTransformsAction } from "oxalis/model/actions/dataset_actions";
import { ResolutionInfo } from "oxalis/model/helpers/resolution_info";
import { type AdditionalCoordinate } from "types/api_flow_types";
import { getMaximumGroupId } from "oxalis/model/reducers/skeletontracing_reducer_helpers";

type TransformSpec =
  | { type: "scale"; args: [Vector3, Vector3] }
  | { type: "rotate"; args: [number, Vector3] }
  | { type: "translate"; args: Vector3 };

type OutdatedDatasetConfigurationKeys = "segmentationOpacity" | "isSegmentationDisabled";
export function assertExists<T>(value: any, message: string): asserts value is NonNullable<T> {
  if (value == null) {
    throw new Error(message);
  }
}
export function assertSkeleton(tracing: Tracing): SkeletonTracing {
  if (tracing.skeleton == null) {
    throw new Error("This api function should only be called in a skeleton annotation.");
  }

  return tracing.skeleton;
}
export function assertVolume(state: OxalisState): VolumeTracing {
  if (state.tracing.volumes.length === 0) {
    throw new Error(
      "This api function should only be called when a volume annotation layer exists.",
    );
  }

  const tracing = getRequestedOrDefaultSegmentationTracingLayer(state, null);

  if (tracing == null) {
    throw new Error(
      "This api function should only be called when a volume annotation layer is visible.",
    );
  }

  return tracing;
}
/**
 * All tracing related API methods. This is the newest version of the API (version 3).
 * @version 3
 * @class
 * @example
 * window.webknossos.apiReady(3).then(api => {
 *   api.tracing.getActiveNodeId();
 *   api.tracing.getActiveTreeId();
 *   ...
 * }
 */

class TracingApi {
  model: OxalisModel;

  /**
   * @private
   */
  isFinishing: boolean = false;

  /**
   * @private
   */
  constructor(model: OxalisModel) {
    this.model = model;
  }

  //  SKELETONTRACING API

  /**
   * Returns the id of the current active node.
   */
  getActiveNodeId(): number | null | undefined {
    const tracing = assertSkeleton(Store.getState().tracing);
    return getActiveNode(tracing)
      .map((node) => node.id)
      .getOrElse(null);
  }

  /**
   * Returns the id of the current active tree.
   */
  getActiveTreeId(): number | null | undefined {
    const tracing = assertSkeleton(Store.getState().tracing);
    return getActiveTree(tracing)
      .map((tree) => tree.treeId)
      .getOrElse(null);
  }

  /**
   * Returns the id of the current active group.
   */
  getActiveTreeGroupId(): number | null | undefined {
    const tracing = assertSkeleton(Store.getState().tracing);
    return getActiveTreeGroup(tracing)
      .map((group) => group.groupId)
      .getOrElse(null);
  }

  /**
   * Deprecated! Use getActiveTreeGroupId instead.
   */
  getActiveGroupId(): number | null | undefined {
    return this.getActiveTreeGroupId();
  }

  /**
   * Sets the active node given a node id.
   */
  setActiveNode(id: number) {
    assertSkeleton(Store.getState().tracing);
    assertExists(id, "Node id is missing.");
    Store.dispatch(setActiveNodeAction(id));
  }

  /**
   * Returns all nodes belonging to a tracing.
   */
  getAllNodes(): Array<Node> {
    const skeletonTracing = assertSkeleton(Store.getState().tracing);
    return _.flatMap(skeletonTracing.trees, (tree) => Array.from(tree.nodes.values()));
  }

  /**
   * Returns all trees belonging to a tracing.
   */
  getAllTrees(): TreeMap {
    const skeletonTracing = assertSkeleton(Store.getState().tracing);
    return skeletonTracing.trees;
  }

  /**
   * Deletes the node with nodeId in the tree with treeId
   */
  deleteNode(nodeId: number, treeId: number) {
    assertSkeleton(Store.getState().tracing);
    Store.dispatch(deleteNodeAction(nodeId, treeId));
  }

  /**
   * Centers the active node.
   */
  centerActiveNode() {
    assertSkeleton(Store.getState().tracing);
    Store.dispatch(centerActiveNodeAction());
  }

  /**
   * Deletes the tree with the given treeId.
   */
  deleteTree(treeId: number) {
    assertSkeleton(Store.getState().tracing);
    Store.dispatch(deleteTreeAction(treeId));
  }

  /**
   * Completely resets the skeleton tracing.
   */
  resetSkeletonTracing() {
    assertSkeleton(Store.getState().tracing);
    Store.dispatch(resetSkeletonTracingAction());
  }

  /**
   * Sets the comment for a node.
   *
   * @example
   * const activeNodeId = api.tracing.getActiveNodeId();
   * api.tracing.setCommentForNode("This is a branch point", activeNodeId);
   */
  setCommentForNode(commentText: string, nodeId: number, treeId?: number): void {
    const skeletonTracing = assertSkeleton(Store.getState().tracing);
    assertExists(commentText, "Comment text is missing.");

    // Convert nodeId to node
    if (_.isNumber(nodeId)) {
      const tree =
        treeId != null
          ? skeletonTracing.trees[treeId]
          : findTreeByNodeId(skeletonTracing.trees, nodeId);
      assertExists(tree, `Couldn't find node ${nodeId}.`);
      Store.dispatch(createCommentAction(commentText, nodeId, tree.treeId));
    } else {
      throw new Error("Node id is missing.");
    }
  }

  /**
   * Returns the comment for a given node and tree (optional).
   * @param treeId - Supplying the tree id will provide a performance boost for looking up a comment.
   *
   * @example
   * const comment = api.tracing.getCommentForNode(23);
   *
   * @example // Provide a tree for lookup speed boost
   * const comment = api.tracing.getCommentForNode(23, api.getActiveTreeid());
   */
  getCommentForNode(nodeId: number, treeId?: number): string | null | undefined {
    const skeletonTracing = assertSkeleton(Store.getState().tracing);
    assertExists(nodeId, "Node id is missing.");
    // Convert treeId to tree
    let tree = null;

    if (treeId != null) {
      tree = skeletonTracing.trees[treeId];
      assertExists(tree, `Couldn't find tree ${treeId}.`);
      assertExists(tree.nodes.get(nodeId), `Couldn't find node ${nodeId} in tree ${treeId}.`);
    } else {
      tree = _.values(skeletonTracing.trees).find((__) => __.nodes.has(nodeId));
      assertExists(tree, `Couldn't find node ${nodeId}.`);
    }

    const comment = tree.comments.find((__) => __.nodeId === nodeId);
    return comment != null ? comment.content : null;
  }

  /**
   * Sets the name for a tree. If no tree id is given, the active tree is used.
   *
   * @example
   * api.tracing.setTreeName("Special tree", 1);
   */
  setTreeName(name: string, treeId: number | null | undefined) {
    const skeletonTracing = assertSkeleton(Store.getState().tracing);

    if (treeId == null) {
      treeId = skeletonTracing.activeTreeId;
    }

    Store.dispatch(setTreeNameAction(name, treeId));
  }

  /**
   * Sets the visibility of the edges for a tree. If no tree id is given, the active tree is used.
   *
   * @example
   * api.tracing.setTreeEdgeVisibility(false, 1);
   */
  setTreeEdgeVisibility(edgesAreVisible: boolean, treeId: number | null | undefined) {
    const skeletonTracing = assertSkeleton(Store.getState().tracing);

    if (treeId == null) {
      treeId = skeletonTracing.activeTreeId;
    }

    Store.dispatch(setTreeEdgeVisibilityAction(treeId, edgesAreVisible));
  }

  /**
   * Makes the specified tree active. Within the tree, the node with the highest ID will be activated.
   *
   * @example
   * api.tracing.setActiveTree(3);
   */
  setActiveTree(treeId: number) {
    const { tracing } = Store.getState();
    assertSkeleton(tracing);
    Store.dispatch(setActiveTreeAction(treeId));
  }

  /**
   * Makes the tree specified by name active. Within the tree, the node with the highest ID will be activated.
   *
   * @example
   * api.tracing.setActiveTree("tree_1");
   */
  setActiveTreeByName(treeName: string) {
    const { tracing } = Store.getState();
    assertSkeleton(tracing);
    Store.dispatch(setActiveTreeByNameAction(treeName));
  }

  /**
   * Makes the specified group active. Nodes cannot be added through the UI when a group is active.
   *
   * @example
   * api.tracing.setActiveTreeGroup(3);
   */
  setActiveTreeGroup(groupId: number) {
    const { tracing } = Store.getState();
    assertSkeleton(tracing);
    Store.dispatch(setActiveTreeGroupAction(groupId));
  }

  /**
   * Deprecated! Use renameSkeletonGroup instead.
   */
  setActiveGroup(groupId: number) {
    this.setActiveTreeGroup(groupId);
  }

  /**
   * Changes the color of the referenced tree. Internally, a pre-defined array of colors is used which is
   * why this function uses a colorIndex (between 0 and 500) instead of a proper color.
   *
   * @example
   * api.tracing.setTreeColorIndex(3, 10);
   */
  setTreeColorIndex(treeId: number | null | undefined, colorIndex: number) {
    const { tracing } = Store.getState();
    assertSkeleton(tracing);
    Store.dispatch(setTreeColorIndexAction(treeId, colorIndex));
  }

  /**
   * Changes the visibility of the referenced tree.
   *
   * @example
   * api.tracing.setTreeVisibility(3, false);
   */
  setTreeVisibility(treeId: number | null | undefined, isVisible: boolean) {
    const { tracing } = Store.getState();
    assertSkeleton(tracing);
    Store.dispatch(setTreeVisibilityAction(treeId, isVisible));
  }

  /**
   * Gets a list of tree groups
   *
   * @example
   * api.tracing.getTreeGroups();
   */
  getTreeGroups(): Array<TreeGroupTypeFlat> {
    const { tracing } = Store.getState();
    return getFlatTreeGroups(assertSkeleton(tracing));
  }

  /**
   * Sets the parent group of the referenced tree.
   *
   * @example
   * api.tracing.setTreeGroup(
   *   3,
   *   api.tracing.getTreeGroups.find(({ name }) => name === "My Tree Group").id,
   * );
   */
  setTreeGroup(treeId?: number, groupId?: number) {
    const { tracing } = Store.getState();
    const skeletonTracing = assertSkeleton(tracing);
    const treeGroupMap = getTreeGroupsMap(skeletonTracing);

    if (groupId != null && treeGroupMap[groupId] == null) {
      throw new Error("Provided group ID does not exist");
    }

    Store.dispatch(setTreeGroupAction(groupId, treeId));
  }

  async importNmlAsString(nmlString: string) {
    const { treeGroups, trees } = await parseNml(nmlString);
    Store.dispatch(addTreesAndGroupsAction(trees, treeGroups));
  }

  /**
   * Renames the group referenced by the provided id.
   *
   * @example
   * api.tracing.renameSkeletonGroup(
   *   3,
   *   "New group name",
   * );
   */
  renameSkeletonGroup(groupId: number, newName: string) {
    const { tracing } = Store.getState();
    const skeletonTracing = assertSkeleton(tracing);

    const newTreeGroups = _.cloneDeep(skeletonTracing.treeGroups);

    callDeep(newTreeGroups, groupId, (item) => {
      // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'name' because it is a read-only ... Remove this comment to see the full error message
      item.name = newName;
    });
    Store.dispatch(setTreeGroupsAction(newTreeGroups));
  }

  /**
   * Moves one skeleton group to another one (or to the root node when providing null as the second parameter).
   *
   * @example
   * api.tracing.moveSkeletonGroup(
   *   3,
   *   null, // moves group with id 0 to the root node
   * );
   */
  moveSkeletonGroup(groupId: number, targetGroupId: number | null) {
    const skeleton = Store.getState().tracing.skeleton;
    if (!skeleton) {
      throw new Error("No skeleton tracing found.");
    }
    const newTreeGroups = moveGroupsHelper(skeleton.treeGroups, groupId, targetGroupId);
    Store.dispatch(setTreeGroupsAction(newTreeGroups));
  }

  /**
   * Adds a segment to the segment list.
   *
   * @example
   * api.tracing.registerSegment(
   *   3,
   *   "volume-layer-id"
   *   [1, 2, 3],
   * );
   */
  registerSegment(
    segmentId: number,
    somePosition: Vector3,
    someAdditionalCoordinates: AdditionalCoordinate[] | undefined = undefined,
    layerName?: string,
  ) {
    Store.dispatch(
      clickSegmentAction(segmentId, somePosition, someAdditionalCoordinates, layerName),
    );
  }

  /**
   * Gets a segment object within the referenced volume layer. Note that this object
   * does not support any modifications made to it.
   *
   * @example
   * const segment = api.tracing.getSegment(
   *   3,
   *   "volume-layer-id"
   * );
   * console.log(segment.groupId)
   */
  getSegment(segmentId: number, layerName: string): Segment {
    const segment = getSegmentsForLayer(Store.getState(), layerName).get(segmentId);
    // Return a copy to avoid mutations by third-party code.
    return { ...segment };
  }

  /**
   * Updates a segment. The segment parameter can contain all properties of a Segment
   * (except for the id) or less.
   *
   * @example
   * api.tracing.updateSegment(
   *   3,
   *   {
   *     name: "A name",
   *     somePosition: [1, 2, 3],
   *     someAdditionalCoordinates: [],
   *     color: [1, 2, 3],
   *     groupId: 1,
   *   },
   *   "volume-layer-id"
   * );
   */
  updateSegment(segmentId: number, segment: Partial<Segment>, layerName: string) {
    Store.dispatch(updateSegmentAction(segmentId, { ...segment, id: segmentId }, layerName));
  }

  /**
   * Removes a segment from the segment list. This does *not* mutate the actual voxel data.
   *
   * @example
   * api.tracing.removeSegment(
   *   3,
   *   "volume-layer-id"
   * );
   */
  removeSegment(segmentId: number, layerName: string) {
    Store.dispatch(removeSegmentAction(segmentId, layerName));
  }

  /**
   * Moves one segment group to another one (or to the root node when providing null as the second parameter).
   *
   * @example
   * api.tracing.moveSegmentGroup(
   *   3,
   *   null, // moves group with id 0 to the root node
   *   "volume-layer-id"
   * );
   */
  moveSegmentGroup(groupId: number, targetGroupId: number | undefined | null, layerName: string) {
    const { segmentGroups } = getVolumeTracingById(Store.getState().tracing, layerName);
    const newSegmentGroups = moveGroupsHelper(segmentGroups, groupId, targetGroupId);
    Store.dispatch(setSegmentGroupsAction(newSegmentGroups, layerName));
  }

  /**
   * Creates a new segment group and returns its id.
   *
   * @example
   * api.tracing.createSegmentGroup(
   *   "Group name",    // optional
   *   parentGroupId,   // optional. use -1 for the root group
   *   volumeLayerName, // see getSegmentationLayerNames
   * );
   */
  createSegmentGroup(
    name: string | null = null,
    parentGroupId: number = MISSING_GROUP_ID,
    volumeLayerName?: string,
  ): number {
    if (parentGroupId == null) {
      // Guard against explicitly passed null or undefined.
      parentGroupId = MISSING_GROUP_ID;
    }
    const volumeTracing = volumeLayerName
      ? getVolumeTracingByLayerName(Store.getState().tracing, volumeLayerName)
      : getActiveSegmentationTracing(Store.getState());
    if (volumeTracing == null) {
      throw new Error(`Could not find volume tracing layer with name ${volumeLayerName}`);
    }
    const { segmentGroups } = volumeTracing;

    const newSegmentGroups = _.cloneDeep(segmentGroups);
    const newGroupId = getMaximumGroupId(newSegmentGroups) + 1;
    const newGroup = {
      name: name || `Group ${newGroupId}`,
      groupId: newGroupId,
      children: [],
    };

    if (parentGroupId === MISSING_GROUP_ID) {
      newSegmentGroups.push(newGroup);
    } else {
      callDeep(newSegmentGroups, parentGroupId, (item) => {
        item.children.push(newGroup);
      });
    }

    Store.dispatch(setSegmentGroupsAction(newSegmentGroups, volumeTracing.tracingId));

    return newGroupId;
  }

  /**
   * Renames the segment group referenced by the provided id.
   *
   * @example
   * api.tracing.renameSegmentGroup(
   *   3,
   *   "New group name",
   *   volumeLayerName, // see getSegmentationLayerNames
   * );
   */
  renameSegmentGroup(groupId: number, newName: string, volumeLayerName?: string) {
    const volumeTracing = volumeLayerName
      ? getVolumeTracingByLayerName(Store.getState().tracing, volumeLayerName)
      : getActiveSegmentationTracing(Store.getState());
    if (volumeTracing == null) {
      throw new Error(`Could not find volume tracing layer with name ${volumeLayerName}`);
    }
    const { segmentGroups } = volumeTracing;

    const newSegmentGroups = mapGroups(segmentGroups, (group) => {
      if (group.groupId === groupId) {
        return {
          ...group,
          name: newName,
        };
      } else {
        return group;
      }
    });

    Store.dispatch(setSegmentGroupsAction(newSegmentGroups, volumeTracing.tracingId));
  }

  /**
   * Deletes the segment group referenced by the provided id. If deleteChildren is
   * true, the deletion is recursive.
   *
   * @example
   * api.tracing.deleteSegmentGroup(
   *   3,
   *   true,
   *   volumeLayerName, // see getSegmentationLayerNames
   * );
   */
  deleteSegmentGroup(groupId: number, deleteChildren: boolean = false, volumeLayerName?: string) {
    const volumeTracing = volumeLayerName
      ? getVolumeTracingByLayerName(Store.getState().tracing, volumeLayerName)
      : getActiveSegmentationTracing(Store.getState());
    if (volumeTracing == null) {
      throw new Error(`Could not find volume tracing layer with name ${volumeLayerName}`);
    }
    const { segments, segmentGroups } = volumeTracing;

    if (segments == null || segmentGroups == null) {
      return;
    }

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
      // Remove group
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
              volumeTracing.tracingId,
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
      (segmentId) => removeSegmentAction(segmentId, volumeTracing.tracingId),
    );
    Store.dispatch(
      batchUpdateGroupsAndSegmentsAction(
        updateSegmentActions.concat(removeSegmentActions, [
          setSegmentGroupsAction(newSegmentGroups, volumeTracing.tracingId),
        ]),
      ),
    );
  }

  /**
   * Deprecated! Use renameSkeletonGroup instead.
   */
  renameGroup(groupId: number, newName: string) {
    this.renameSkeletonGroup(groupId, newName);
  }

  /**
   * Returns the name for a given tree id. If none is given, the name of the active tree is returned.
   *
   * @example
   * api.tracing.getTreeName();
   */
  getTreeName(treeId?: number) {
    const tracing = assertSkeleton(Store.getState().tracing);
    return getTree(tracing, treeId)
      .map((activeTree) => activeTree.name)
      .get();
  }

  /**
   * Loads the agglomerate skeleton for the given segment id. Only possible if
   * a segmentation layer is visible for which an agglomerate mapping is enabled.
   *
   * @example
   * api.tracing.loadAgglomerateSkeletonForSegmentId(3);
   */
  loadAgglomerateSkeletonForSegmentId(segmentId: number) {
    loadAgglomerateSkeletonForSegmentId(segmentId);
  }

  /**
   * Saves the tracing and returns a promise (which you can call `then` on or use await with).
   *
   * @example
   * api.tracing.save().then(() => ... );
   *
   * @example
   * await api.tracing.save();
   */
  async save() {
    await Model.ensureSavedState();
  }

  /**
   * Finishes the task and gets the next one. It returns a promise (which you can call `then` on or use await with).
   * Don't assume that code after the finishAndGetNextTask call will be executed.
   * It can happen that there is no further task, in which case the user will be redirected to the dashboard.
   * Or the the page can be reloaded (e.g., if the dataset changed), which also means that no further JS code will
   * be executed in this site context.
   *
   * @example
   * api.tracing.finishAndGetNextTask().then(() => ... );
   *
   * @example
   * await api.tracing.finishAndGetNextTask();
   */
  async finishAndGetNextTask() {
    if (this.isFinishing) return;
    this.isFinishing = true;
    const state = Store.getState();
    const { annotationType, annotationId } = state.tracing;
    const { task } = state;

    if (task == null) {
      // Satisfy typescript
      throw new Error("Cannot find task to finish.");
    }

    await Model.ensureSavedState();
    await finishAnnotation(annotationId, annotationType);
    UserLocalStorage.setItem(
      "lastFinishedTask",
      JSON.stringify({
        annotationId,
        finishedTime: Date.now(),
      }),
    );

    try {
      const annotation = await requestTask();
      const isDifferentDataset = state.dataset.name !== annotation.dataSetName;
      const isDifferentTaskType = annotation.task.type.id !== task.type.id;
      const involvesVolumeTask =
        state.tracing.volumes.length > 0 || getVolumeDescriptors(annotation).length > 0;
      const currentScript = task.script != null ? task.script.gist : null;
      const nextScript = annotation.task.script != null ? annotation.task.script.gist : null;
      // A hot-swap of the task is not possible, currently, when a script is involved.
      const needsReloadDueToScript = currentScript != null || nextScript != null;
      const newTaskUrl = `/annotations/${annotation.typ}/${annotation.id}`;

      // In some cases the page needs to be reloaded, in others the tracing can be hot-swapped
      if (
        isDifferentDataset ||
        isDifferentTaskType ||
        needsReloadDueToScript ||
        involvesVolumeTask
      ) {
        location.href = newTaskUrl;
      } else {
        await this.restart(null, annotation.id, ControlModeEnum.TRACE);
      }
    } catch (err) {
      console.error(err);
      await Utils.sleep(2000);
      location.href = "/dashboard";
    } finally {
      this.isFinishing = false;
    }
  }

  /**
   * Restart webKnossos without refreshing the page. Please prefer finishAndGetNextTask for user scripts
   * since it does extra validation of the requested change and makes sure everything is saved etc.
   *
   * @example
   * api.tracing.restart("Explorational", "5909b5aa3e0000d4009d4d15", "TRACE")
   *
   */
  async restart(
    // Earlier versions used newAnnotationType here.
    newMaybeCompoundType: APICompoundType | null,
    newAnnotationId: string,
    newControlMode: ControlMode,
    versions?: Versions,
    keepUrlState: boolean = false,
  ) {
    if (newControlMode === ControlModeEnum.VIEW)
      throw new Error("Restarting with view option is not supported");
    Store.dispatch(restartSagaAction());
    UrlManager.reset(keepUrlState);

    newMaybeCompoundType =
      newMaybeCompoundType != null ? coalesce(APICompoundTypeEnum, newMaybeCompoundType) : null;

    await Model.fetch(
      newMaybeCompoundType,
      {
        annotationId: newAnnotationId,
        // @ts-ignore
        type: newControlMode,
      },
      false,
      versions,
    );
    Store.dispatch(discardSaveQueuesAction());
    Store.dispatch(wkReadyAction());
    UrlManager.updateUnthrottled();
  }

  /**
   * Reload tracing by reloading the entire page.
   *
   * @example
   * api.tracing.hardReload()
   */
  async hardReload() {
    await Model.ensureSavedState();
    location.reload();
  }

  //  SKELETONTRACING API

  /**
   * Increases the node radius of the given node by multiplying it with 1.05^delta.
   * If no nodeId and/or treeId are provided, it defaults to the current tree and current node.
   *
   * @example
   * api.tracing.setNodeRadius(1)
   */
  setNodeRadius(delta: number, nodeId?: number, treeId?: number): void {
    const skeletonTracing = assertSkeleton(Store.getState().tracing);
    getNodeAndTree(skeletonTracing, nodeId, treeId).map(([, node]) =>
      Store.dispatch(setNodeRadiusAction(node.radius * Math.pow(1.05, delta), nodeId, treeId)),
    );
  }

  /**
   * Centers the given node. If no node is provided, the active node is centered.
   *
   * @example
   * api.tracing.centerNode()
   */
  centerNode = (nodeId?: number): void => {
    const skeletonTracing = assertSkeleton(Store.getState().tracing);
    getNodeAndTree(skeletonTracing, nodeId).map(([, node]) => {
      return Store.dispatch(setPositionAction(getNodePosition(node, Store.getState())));
    });
  };

  /**
   * Centers the 3D view.
   *
   * @example
   * api.tracing.centerTDView()
   */
  centerTDView = (): void => {
    Store.dispatch(centerTDViewAction());
  };

  rotate3DViewToXY = (): void => rotate3DViewTo(OrthoViews.PLANE_XY);
  rotate3DViewToYZ = (): void => rotate3DViewTo(OrthoViews.PLANE_YZ);
  rotate3DViewToXZ = (): void => rotate3DViewTo(OrthoViews.PLANE_XZ);
  rotate3DViewToDiagonal = (animate: boolean = true): void => {
    rotate3DViewTo(OrthoViews.TDView, animate);
  };

  getShortestRotation(curRotation: Vector3, newRotation: Vector3): Vector3 {
    // TODO
    // interpolating Euler angles does not lead to the shortest rotation
    // interpolate the Quaternion representation instead
    // https://theory.org/software/qfa/writeup/node12.html
    const result = [newRotation[0], newRotation[1], newRotation[2]];

    for (let i = 0; i <= 2; i++) {
      // a rotation about more than 180° is shorter when rotating the other direction
      if (newRotation[i] - curRotation[i] > 180) {
        result[i] = newRotation[i] - 360;
      } else if (newRotation[i] - curRotation[i] < -180) {
        result[i] = newRotation[i] + 360;
      }
    }

    // @ts-expect-error ts-migrate(2322) FIXME: Type 'number[]' is not assignable to type 'Vector3... Remove this comment to see the full error message
    return result;
  }

  /**
   * Measures the length of the given tree and returns the length in nanometer and in voxels.
   */
  measureTreeLength(treeId: number): [number, number] {
    const state = Store.getState();
    const skeletonTracing = assertSkeleton(state.tracing);
    const tree = skeletonTracing.trees[treeId];

    if (!tree) {
      throw new Error(`Tree with id ${treeId} not found.`);
    }

    const datasetScale = state.dataset.dataSource.scale;
    // Pre-allocate vectors
    let lengthNmAcc = 0;
    let lengthVxAcc = 0;

    const getPos = (node: Readonly<MutableNode>) => getNodePosition(node, state);

    for (const edge of tree.edges.all()) {
      const sourceNode = tree.nodes.get(edge.source);
      const targetNode = tree.nodes.get(edge.target);
      lengthNmAcc += V3.scaledDist(getPos(sourceNode), getPos(targetNode), datasetScale);
      lengthVxAcc += V3.length(V3.sub(getPos(sourceNode), getPos(targetNode)));
    }

    return [lengthNmAcc, lengthVxAcc];
  }

  /**
   * Measures the length of all trees and returns the length in nanometer and in voxels.
   */
  measureAllTrees(): [number, number] {
    const skeletonTracing = assertSkeleton(Store.getState().tracing);
    let totalLengthNm = 0;
    let totalLengthVx = 0;

    _.values(skeletonTracing.trees).forEach((currentTree) => {
      const [lengthNm, lengthVx] = this.measureTreeLength(currentTree.treeId);
      totalLengthNm += lengthNm;
      totalLengthVx += lengthVx;
    });

    return [totalLengthNm, totalLengthVx];
  }

  /**
   * Returns the shortest path between two nodes in nanometer and voxels as well as
   * an array of the node IDs in the shortest path.
   */
  findShortestPathBetweenNodes(
    sourceNodeId: number,
    targetNodeId: number,
  ): {
    lengthNm: number;
    lengthVx: number;
    shortestPath: number[];
  } {
    const skeletonTracing = assertSkeleton(Store.getState().tracing);
    const { node: sourceNode, tree: sourceTree } = getNodeAndTreeOrNull(
      skeletonTracing,
      sourceNodeId,
    );
    const { node: targetNode, tree: targetTree } = getNodeAndTreeOrNull(
      skeletonTracing,
      targetNodeId,
    );

    if (sourceNode == null || targetNode == null) {
      throw new Error(`The node with id ${sourceNodeId} or ${targetNodeId} does not exist.`);
    }

    if (sourceTree == null || sourceTree !== targetTree) {
      throw new Error("The nodes are not within the same tree.");
    }

    const datasetScale = Store.getState().dataset.dataSource.scale;
    // We use the Dijkstra algorithm to get the shortest path between the nodes.
    const distanceMap: Record<number, number> = {};
    // The distance map is also maintained in voxel space. This information is only
    // used when returning the final distance. The actual path finding is only done in
    // the physical space (nm-based).
    const distanceMapVx: Record<number, number> = {};
    // We keep track of each nodes parent node ID in order to reconstruct an array of
    // node IDs for the shortest path.
    const parentMap: Record<number, number> = {};
    parentMap[sourceNode.id] = -1;

    const getDistance = (nodeId: number) =>
      distanceMap[nodeId] != null ? distanceMap[nodeId] : Number.POSITIVE_INFINITY;

    distanceMap[sourceNode.id] = 0;
    distanceMapVx[sourceNode.id] = 0;
    // The priority queue saves node id and distance tuples.
    const priorityQueue = new PriorityQueue<[number, number]>({
      comparator: ([_first, firstDistance], [_second, secondDistance]) =>
        firstDistance <= secondDistance ? -1 : 1,
    });
    priorityQueue.queue([sourceNodeId, 0]);

    const state = Store.getState();
    const getPos = (node: Readonly<MutableNode>) => getNodePosition(node, state);

    while (priorityQueue.length > 0) {
      const [nextNodeId, distance] = priorityQueue.dequeue();
      const nextNodePosition = getPos(sourceTree.nodes.get(nextNodeId));

      // Calculate the distance to all neighbours and update the distances.
      for (const { source, target } of sourceTree.edges.getEdgesForNode(nextNodeId)) {
        const neighbourNodeId = source === nextNodeId ? target : source;
        const neighbourPosition = getPos(sourceTree.nodes.get(neighbourNodeId));
        const neighbourDistance =
          distance + V3.scaledDist(nextNodePosition, neighbourPosition, datasetScale);

        if (neighbourDistance < getDistance(neighbourNodeId)) {
          distanceMap[neighbourNodeId] = neighbourDistance;
          parentMap[neighbourNodeId] = source === nextNodeId ? source : target;
          const neighbourDistanceVx = V3.length(V3.sub(nextNodePosition, neighbourPosition));
          distanceMapVx[neighbourNodeId] = neighbourDistanceVx;
          priorityQueue.queue([neighbourNodeId, neighbourDistance]);
        }
      }
    }

    // Retrace the shortest path from the target node.
    let nodeId = targetNodeId;
    const shortestPath = [targetNodeId];
    while (parentMap[nodeId] !== -1) {
      nodeId = parentMap[nodeId];
      shortestPath.unshift(nodeId);
    }

    return {
      lengthNm: distanceMap[targetNodeId],
      lengthVx: distanceMapVx[targetNodeId],
      shortestPath,
    };
  }

  /**
   * Returns the length of the shortest path between two nodes in nanometer and in voxels.
   */
  measurePathLengthBetweenNodes(sourceNodeId: number, targetNodeId: number): [number, number] {
    const { lengthNm, lengthVx } = this.findShortestPathBetweenNodes(sourceNodeId, targetNodeId);
    return [lengthNm, lengthVx];
  }

  /**
   * Starts an animation to center the given position. See setCameraPosition for a non-animated version of this function.
   *
   * @param position - Vector3
   * @param skipDimensions - Boolean which decides whether the third dimension shall also be animated (defaults to true)
   * @param rotation - Vector3 (optional) - Will only be noticeable in flight or oblique mode.
   * @example
   * api.tracing.centerPositionAnimated([0, 0, 0])
   */
  centerPositionAnimated(
    position: Vector3,
    skipDimensions: boolean = true,
    rotation?: Vector3,
  ): void {
    // Let the user still manipulate the "third dimension" during animation
    const { activeViewport } = Store.getState().viewModeData.plane;
    const dimensionToSkip =
      skipDimensions && activeViewport !== OrthoViews.TDView
        ? dimensions.thirdDimensionForPlane(activeViewport)
        : null;
    const curPosition = getPosition(Store.getState().flycam);
    const curRotation = getRotation(Store.getState().flycam);
    if (!Array.isArray(rotation)) rotation = curRotation;
    rotation = this.getShortestRotation(curRotation, rotation);

    type Tweener = {
      positionX: number;
      positionY: number;
      positionZ: number;
      rotationX: number;
      rotationY: number;
      rotationZ: number;
    };
    const tween = new TWEEN.Tween({
      positionX: curPosition[0],
      positionY: curPosition[1],
      positionZ: curPosition[2],
      rotationX: curRotation[0],
      rotationY: curRotation[1],
      rotationZ: curRotation[2],
    });
    tween
      .to(
        {
          positionX: position[0],
          positionY: position[1],
          positionZ: position[2],
          rotationX: rotation[0],
          rotationY: rotation[1],
          rotationZ: rotation[2],
        },
        200,
      )
      .onUpdate(function (this: Tweener) {
        // needs to be a normal (non-bound) function
        Store.dispatch(
          setPositionAction([this.positionX, this.positionY, this.positionZ], dimensionToSkip),
        );
        Store.dispatch(setRotationAction([this.rotationX, this.rotationY, this.rotationZ]));
      })
      .start();
  }

  /**
   * Returns the current camera position.
   *
   * @example
   * const currentPosition = api.tracing.getCameraPosition()
   */
  getCameraPosition(): Vector3 {
    return getPosition(Store.getState().flycam);
  }

  /**
   * Sets the current camera position. See centerPositionAnimated for an animated version of this function.
   *
   * @example
   * api.tracing.setCameraPosition([100, 100, 100])
   */
  setCameraPosition(position: Vector3) {
    Store.dispatch(setPositionAction(position));
  }

  //  VOLUMETRACING API

  /**
   * Returns the id of the current active segment.
   * _Volume tracing only!_
   */
  getActiveCellId(): number | null | undefined {
    const tracing = assertVolume(Store.getState());
    return getActiveCellId(tracing);
  }

  /**
   * Sets the active segment given a segment id.
   * If a segment with the given id doesn't exist, it is created.
   * _Volume tracing only!_
   */
  setActiveCell(id: number) {
    assertVolume(Store.getState());
    assertExists(id, "Segment id is missing.");
    Store.dispatch(setActiveCellAction(id));
  }

  /**
   * Returns the active tool which is either
   * "MOVE", "SKELETON", "TRACE", "BRUSH", "FILL_CELL" or "PICK_CELL"
   */
  getAnnotationTool(): AnnotationTool {
    return Store.getState().uiInformation.activeTool;
  }

  /**
   * Sets the active tool which should be either
   * "MOVE", "SKELETON", "TRACE", "BRUSH", "FILL_CELL" or "PICK_CELL"
   * _Volume tracing only!_
   */
  setAnnotationTool(tool: AnnotationTool) {
    if (AnnotationToolEnum[tool] == null) {
      throw new Error(
        `Annotation tool has to be one of: "${Object.keys(AnnotationToolEnum).join('", "')}".`,
      );
    }

    Store.dispatch(setToolAction(tool));
  }

  /**
   * Deprecated! Use getAnnotationTool instead.
   */
  getVolumeTool(): AnnotationTool {
    return this.getAnnotationTool();
  }

  /**
   * Deprecated! Use setAnnotationTool instead.
   */
  setVolumeTool(tool: AnnotationTool) {
    this.setAnnotationTool(tool);
  }

  /**
   * Use this method to create a complete resolution pyramid by downsampling the lowest present mag (e.g., mag 1).
     This method will save the current changes and then reload the page after the downsampling
     has finished.
     This function can only be used for non-tasks.
      Note that this invoking this method will not block the UI. Thus, user actions can be performed during the
     downsampling. The caller should prohibit this (e.g., by showing a not-closable modal during the process).
   */
  async downsampleSegmentation(volumeTracingId: string) {
    const state = Store.getState();
    const { annotationId, annotationType } = state.tracing;

    if (state.task != null) {
      throw new Error("Cannot downsample segmentation for a task.");
    }

    await this.save();
    await downsampleSegmentation(annotationId, annotationType, volumeTracingId);
    await this.hardReload();
  }
}
/**
 * All binary data / layer related API methods.
 * @example
 * window.webknossos.apiReady(3).then(api => {
 *   api.data.getLayerNames();
 *   api.data.reloadBuckets(...);
 *   ...
 * }
 */

class DataApi {
  model: OxalisModel;

  constructor(model: OxalisModel) {
    this.model = model;
  }

  /**
   * Returns the names of all available layers of the current tracing.
   */
  getLayerNames(): Array<string> {
    return _.map(this.model.dataLayers, "name");
  }

  /**
   * DEPRECATED! Use getSegmentationLayerNames, getVisibleSegmentationLayer or getVolumeTracingLayerIds instead.
   *
   * Returns the name of the volume tracing layer (only exists for a volume annotation) or the visible
   * segmentation layer.
   */
  getVolumeTracingLayerName(): string {
    const segmentationLayer = this.model.getActiveSegmentationTracingLayer();

    if (segmentationLayer != null) {
      return segmentationLayer.name;
    }

    const visibleLayer = getVisibleSegmentationLayer(Store.getState());
    console.warn(
      "getVolumeTracingLayerName is deprecated. Please use getVolumeTracingLayerIds instead.",
    );

    if (visibleLayer != null) {
      console.warn(
        "getVolumeTracingLayerName was called, but there is no volume tracing. Falling back to the visible segmentation layer. Please use getSegmentationLayerNames instead.",
      );
      return visibleLayer.name;
    }

    throw new Error(
      "getVolumeTracingLayerName was called, but there is no volume tracing and also no visible segmentation layer.",
    );
  }

  /*
   * Returns the name of the visible segmentation layer (if it exists). Note that
   * if the visible layer is a volume tracing layer, the name will be an ID
   * (and not the name which the user can specify in the UI).
   */
  getVisibleSegmentationLayerName(): string | null | undefined {
    const visibleLayer = getVisibleSegmentationLayer(Store.getState());

    if (visibleLayer != null) {
      return visibleLayer.name;
    }

    return null;
  }

  /*
   * Returns the ids of the existing volume tracing layers.
   */
  getVolumeTracingLayerIds(): Array<string> {
    return getVolumeTracings(Store.getState().tracing).map((tracing) => tracing.tracingId);
  }

  /**
   * Return a list of segmentation layer names. Note for volume tracing layers,
   * the name will be an ID (and not the name which the user can specify in the UI).
   */
  getSegmentationLayerNames(): Array<string> {
    return this.model.getSegmentationLayers().map((layer) => layer.name);
  }

  /**
   * Invalidates all downloaded buckets of the given layer so that they are reloaded.
   * If an additional predicate is passed, each bucket is checked to see whether
   * it should be reloaded. Note that buckets that are in a REQUESTED state (i.e.,
   * currently being queued or downloaded) will always be reloaded by cancelling and rescheduling
   * the request.
   */
  async reloadBuckets(
    layerName: string,
    predicateFn?: (bucket: DataBucket) => boolean,
  ): Promise<void> {
    await Promise.all(
      Utils.values(this.model.dataLayers).map(async (dataLayer: DataLayer) => {
        if (dataLayer.name === layerName) {
          if (dataLayer.cube.isSegmentation) {
            await Model.ensureSavedState();
          }

          dataLayer.cube.collectBucketsIf(predicateFn || (() => true));
          dataLayer.layerRenderingManager.refresh();
        }
      }),
    );
  }

  /**
   * Invalidates all downloaded buckets so that they are reloaded.
   */
  async reloadAllBuckets(): Promise<void> {
    if (hasVolumeTracings(Store.getState().tracing)) {
      await Model.ensureSavedState();
    }

    Utils.values(this.model.dataLayers).forEach((dataLayer: DataLayer) => {
      dataLayer.cube.collectAllBuckets();
      dataLayer.layerRenderingManager.refresh();
    });
  }

  /**
   * Sets a mapping for a given layer.
   *
   * @example
   * const position = [123, 123, 123];
   * const segmentationLayerName = "segmentation";
   * const segmentId = await api.data.getDataValue(segmentationLayerName, position);
   * const treeId = api.tracing.getActiveTreeId();
   * const mapping = {[segmentId]: treeId}
   *
   * api.data.setMapping(segmentationLayerName, mapping);
   */
  setMapping(
    layerName: string,
    mapping: Mapping,
    options: {
      colors?: Array<number>;
      hideUnmappedIds?: boolean;
      showLoadingIndicator?: boolean;
    } = {},
  ) {
    const layer = this.model.getLayerByName(layerName);

    if (!layer.isSegmentation) {
      throw new Error(messages["mapping.unsupported_layer"]);
    }

    const { colors: mappingColors, hideUnmappedIds, showLoadingIndicator } = options;
    if (mappingColors != null) {
      // Consider removing custom color support if this event is rarely used
      // (see `mappingColors` handling in mapping_saga.ts)
      sendAnalyticsEvent("setMapping called with custom colors");
    }
    const mappingProperties = {
      mapping: _.clone(mapping),
      // Object.keys is sorted for numerical keys according to the spec:
      // http://www.ecma-international.org/ecma-262/6.0/#sec-ordinary-object-internal-methods-and-internal-slots-ownpropertykeys
      mappingKeys: Object.keys(mapping).map((x) => parseInt(x, 10)),
      mappingColors,
      hideUnmappedIds,
      showLoadingIndicator,
    };
    Store.dispatch(setMappingAction(layerName, "<custom mapping>", "JSON", mappingProperties));
  }

  /**
   * Enables/Disables the active mapping. If layerName is not passed,
   * the currently visible segmentation layer will be used.
   */
  setMappingEnabled(isEnabled: boolean, layerName?: string) {
    const effectiveLayerName = getRequestedOrVisibleSegmentationLayerEnforced(
      Store.getState(),
      layerName,
    ).name;
    Store.dispatch(setMappingEnabledAction(effectiveLayerName, isEnabled));
  }

  /**
   * Gets all available mapping names for a given layer. If the layerName
   * is not passed, the currently visible segmentation layer will be used.
   *
   */
  async getMappingNames(layerName?: string): Promise<Array<string>> {
    const { dataset } = Store.getState();
    const segmentationLayer = getRequestedOrVisibleSegmentationLayerEnforced(
      Store.getState(),
      layerName,
    );
    return getMappingsForDatasetLayer(dataset.dataStore.url, dataset, segmentationLayer.name);
  }

  /**
   * Gets the active mapping for a given layer. If layerName is not
   * passed, the currently visible segmentation layer will be used.
   *
   */
  getActiveMapping(layerName?: string): string | null | undefined {
    const effectiveLayerName = getNameOfRequestedOrVisibleSegmentationLayer(
      Store.getState(),
      layerName,
    );

    if (!effectiveLayerName) {
      return null;
    }

    return getMappingInfo(
      Store.getState().temporaryConfiguration.activeMappingByLayer,
      effectiveLayerName,
    ).mappingName;
  }

  /**
   * Sets the active mapping for a given layer. If layerName is not passed,
   * the currently visible segmentation layer will be used.
   *
   */
  activateMapping(
    mappingName?: string,
    mappingType: MappingType = "JSON",
    layerName?: string,
  ): void {
    const effectiveLayerName = getNameOfRequestedOrVisibleSegmentationLayer(
      Store.getState(),
      layerName,
    );

    if (!effectiveLayerName) {
      throw new Error(messages["mapping.unsupported_layer"]);
    }

    Store.dispatch(setMappingAction(effectiveLayerName, mappingName, mappingType));
  }

  /**
   * Returns whether a mapping is currently enabled. If layerName is not passed,
   * the currently visible segmentation layer will be used.
   */
  isMappingEnabled(layerName?: string): boolean {
    const effectiveLayerName = getNameOfRequestedOrVisibleSegmentationLayer(
      Store.getState(),
      layerName,
    );

    if (!effectiveLayerName) {
      return false;
    }

    return (
      getMappingInfo(
        Store.getState().temporaryConfiguration.activeMappingByLayer,
        effectiveLayerName,
      ).mappingStatus === MappingStatusEnum.ENABLED
    );
  }

  refreshMeshes() {
    Store.dispatch(refreshMeshesAction());
  }

  /**
   * Returns the bounding box for a given layer name.
   */
  getBoundingBox(layerName: string): [Vector3, Vector3] {
    const { min, max } = getLayerBoundingBox(Store.getState().dataset, layerName);
    return [min, max];
  }

  /**
   * Returns raw binary data for a given layer, position and zoom level. If the zoom
   * level is not provided, the first resolution will be used. If this
   * resolution does not exist, the next existing resolution will be used.
   * If the zoom level is provided and points to a not existent resolution,
   * 0 will be returned.
   *
   * @example // Return the greyscale value for a bucket
   * const position = [123, 123, 123];
   * api.data.getDataValue("binary", position).then((greyscaleColor) => ...);
   *
   * @example // Using the await keyword instead of the promise syntax
   * const greyscaleColor = await api.data.getDataValue("binary", position);
   *
   * @example // Get the segmentation id for the first volume tracing layer
   * const segmentId = await api.data.getDataValue(api.data.getVolumeTracingLayerIds()[0], position);
   */
  async getDataValue(
    layerName: string,
    position: Vector3,
    _zoomStep: number | null | undefined = null,
    additionalCoordinates: AdditionalCoordinate[] | null = null,
  ): Promise<number> {
    let zoomStep;

    if (_zoomStep != null) {
      zoomStep = _zoomStep;
    } else {
      const layer = getLayerByName(Store.getState().dataset, layerName);
      const resolutionInfo = getResolutionInfo(layer.resolutions);
      zoomStep = resolutionInfo.getFinestResolutionIndex();
    }

    const cube = this.model.getCubeByLayerName(layerName);
    additionalCoordinates = additionalCoordinates || Store.getState().flycam.additionalCoordinates;
    const bucketAddress = cube.positionToZoomedAddress(position, additionalCoordinates, zoomStep);
    await this.getLoadedBucket(layerName, bucketAddress);
    // Bucket has been loaded by now or was loaded already
    const dataValue = cube.getDataValue(position, additionalCoordinates, null, zoomStep);
    return dataValue;
  }

  /**
   * Returns the magnification that is _currently_ rendered at the given position.
   */
  getRenderedZoomStepAtPosition(layerName: string, position: Vector3 | null | undefined): number {
    return this.model.getCurrentlyRenderedZoomStepAtPosition(layerName, position);
  }

  /**
   * Returns the maginfication that will _ultimately_ be rendered at the given position, once
   * all respective buckets are loaded.
   */
  getUltimatelyRenderedZoomStepAtPosition(layerName: string, position: Vector3): Promise<number> {
    return this.model.getUltimatelyRenderedZoomStepAtPosition(layerName, position);
  }

  async getLoadedBucket(layerName: string, bucketAddress: BucketAddress): Promise<Bucket> {
    const cube = this.model.getCubeByLayerName(layerName);
    const bucket = await cube.getLoadedBucket(bucketAddress);
    return bucket;
  }

  /*
   * Deprecated! Use getDataForBoundingBox instead whose name describes its interface correctly.
   */
  async getDataFor2DBoundingBox(
    layerName: string,
    bbox: BoundingBoxType,
    _zoomStep: number | null | undefined = null,
  ) {
    return this.getDataForBoundingBox(layerName, bbox, _zoomStep);
  }

  /*
   * For the provided layer name and bounding box, an array is constructed with the actual data.
   * By default, the finest existent quality is chosen, but the quality can be adapted via the
   * zoomStep parameter.
   */
  async getDataForBoundingBox(
    layerName: string,
    mag1Bbox: BoundingBoxType,
    _zoomStep: number | null | undefined = null,
    additionalCoordinates: AdditionalCoordinate[] | null = null,
  ) {
    const layer = getLayerByName(Store.getState().dataset, layerName);
    const resolutionInfo = getResolutionInfo(layer.resolutions);
    let zoomStep;

    if (_zoomStep != null) {
      zoomStep = _zoomStep;
    } else {
      zoomStep = resolutionInfo.getFinestResolutionIndex();
    }

    const resolutions = resolutionInfo.getDenseResolutions();
    const bucketAddresses = this.getBucketAddressesInCuboid(
      mag1Bbox,
      resolutions,
      zoomStep,
      additionalCoordinates,
    );

    if (bucketAddresses.length > 15000) {
      console.warn(
        "More than 15000 buckets need to be requested for the given bounding box. Consider passing a smaller bounding box or using another resolution.",
      );
    }

    const buckets = await Promise.all(
      bucketAddresses.map((addr) => this.getLoadedBucket(layerName, addr)),
    );
    const { elementClass } = getLayerByName(Store.getState().dataset, layerName);
    return this.cutOutCuboid(buckets, mag1Bbox, elementClass, resolutions, zoomStep);
  }

  async getViewportData(
    viewport: OrthoView,
    layerName: string,
    maybeResolutionIndex: number | null | undefined,
    additionalCoordinates: AdditionalCoordinate[] | null,
  ) {
    const state = Store.getState();
    const [curU, curV, curW] = dimensions.transDim(
      dimensions.roundCoordinate(getPosition(state.flycam)),
      viewport,
    );
    const [halfViewportExtentU, halfViewportExtentV] = getHalfViewportExtentsFromState(
      state,
      viewport,
    );
    const layer = getLayerByName(state.dataset, layerName);
    const resolutionInfo = getResolutionInfo(layer.resolutions);
    if (maybeResolutionIndex == null) {
      maybeResolutionIndex = getActiveMagIndexForLayer(state, layerName);
    }
    const zoomStep = resolutionInfo.getClosestExistingIndex(maybeResolutionIndex);

    const min = dimensions.transDim(
      V3.sub([curU, curV, curW], [halfViewportExtentU, halfViewportExtentV, 0]),
      viewport,
    );
    const max = dimensions.transDim(
      V3.add([curU, curV, curW], [halfViewportExtentU, halfViewportExtentV, 1]),
      viewport,
    );

    const resolution = resolutionInfo.getResolutionByIndexOrThrow(zoomStep);
    const resolutionUVX = dimensions.transDim(resolution, viewport);
    const widthInVoxel = Math.ceil(halfViewportExtentU / resolutionUVX[0]);
    const heightInVoxel = Math.ceil(halfViewportExtentV / resolutionUVX[1]);
    if (widthInVoxel * heightInVoxel > 1024 ** 2) {
      throw new Error(
        "Requested data for viewport cannot be loaded, since the amount of data is too large for the available resolution. Please zoom in further or ensure that coarser magnifications are available.",
      );
    }

    const cuboid = await this.getDataForBoundingBox(
      layerName,
      {
        min,
        max,
      },
      zoomStep,
      additionalCoordinates,
    );
    return cuboid;
  }

  getBucketAddressesInCuboid(
    bbox: BoundingBoxType,
    resolutions: Array<Vector3>,
    zoomStep: number,
    additionalCoordinates: AdditionalCoordinate[] | null,
  ): Array<BucketAddress> {
    const buckets = [];
    const bottomRight = bbox.max;
    const minBucket = globalPositionToBucketPosition(
      bbox.min,
      resolutions,
      zoomStep,
      additionalCoordinates,
    );

    const topLeft = (bucketAddress: BucketAddress) =>
      bucketPositionToGlobalAddress(bucketAddress, new ResolutionInfo(resolutions));

    const nextBucketInDim = (bucket: BucketAddress, dim: 0 | 1 | 2) => {
      const copy = bucket.slice() as BucketAddress;
      copy[dim]++;
      return copy;
    };

    let bucket = minBucket;

    while (topLeft(bucket)[0] < bottomRight[0]) {
      const prevX = bucket.slice() as Vector4;

      while (topLeft(bucket)[1] < bottomRight[1]) {
        const prevY = bucket.slice() as Vector4;

        while (topLeft(bucket)[2] < bottomRight[2]) {
          buckets.push(bucket);
          bucket = nextBucketInDim(bucket, 2);
        }

        bucket = nextBucketInDim(prevY, 1);
      }

      bucket = nextBucketInDim(prevX, 0);
    }

    return buckets;
  }

  cutOutCuboid(
    buckets: Array<Bucket>,
    bbox: BoundingBoxType,
    elementClass: ElementClass,
    resolutions: Array<Vector3>,
    zoomStep: number,
  ): TypedArray {
    const resolution = resolutions[zoomStep];
    // All calculations in this method are in zoomStep-space, so in global coordinates which are divided
    // by the resolution
    const topLeft = scaleGlobalPositionWithResolution(bbox.min, resolution);
    // Ceil the bounding box bottom right instead of flooring, because it is exclusive
    const bottomRight = scaleGlobalPositionWithResolution(bbox.max, resolution, true);
    const extent: Vector3 = V3.sub(bottomRight, topLeft);
    const [TypedArrayClass, channelCount] = getConstructorForElementClass(elementClass);
    const result = new TypedArrayClass(channelCount * extent[0] * extent[1] * extent[2]);
    const bucketWidth = Constants.BUCKET_WIDTH;
    buckets.reverse();

    for (const bucket of buckets) {
      if (bucket.type === "null") {
        continue;
      }

      const bucketTopLeft = zoomedAddressToZoomedPosition(bucket.zoomedAddress);
      const x = Math.max(topLeft[0], bucketTopLeft[0]);
      let y = Math.max(topLeft[1], bucketTopLeft[1]);
      let z = Math.max(topLeft[2], bucketTopLeft[2]);
      const xMax = Math.min(bucketTopLeft[0] + bucketWidth, bottomRight[0]);
      const yMax = Math.min(bucketTopLeft[1] + bucketWidth, bottomRight[1]);
      const zMax = Math.min(bucketTopLeft[2] + bucketWidth, bottomRight[2]);

      while (z < zMax) {
        y = Math.max(topLeft[1], bucketTopLeft[1]);

        while (y < yMax) {
          const dataOffset =
            channelCount *
            ((x % bucketWidth) +
              (y % bucketWidth) * bucketWidth +
              (z % bucketWidth) * bucketWidth * bucketWidth);
          const rx = x - topLeft[0];
          const ry = y - topLeft[1];
          const rz = z - topLeft[2];
          const resultOffset = channelCount * (rx + ry * extent[0] + rz * extent[0] * extent[1]);
          // Checking for bucket.type !== "null" is not enough, since the bucket
          // could also be MISSING.
          const data = bucket.hasData()
            ? bucket.getData()
            : new TypedArrayClass(Constants.BUCKET_SIZE);
          const length = channelCount * (xMax - x);
          // The `set` operation is not problematic, since the BucketDataArray types
          // won't be mixed (either, they are BigInt or they aren't)
          // @ts-ignore
          result.set(data.slice(dataOffset, dataOffset + length), resultOffset);
          y += 1;
        }

        z += 1;
      }
    }

    return result;
  }

  /**
   * Helper method to build the download URL for a raw data cuboid.
   *
   * @ignore
   */
  _getDownloadUrlForRawDataCuboid(
    layerName: string,
    topLeft: Vector3,
    bottomRight: Vector3,
    token: string,
    resolution?: Vector3,
  ): string {
    const { dataset } = Store.getState();
    const resolutionInfo = getResolutionInfo(getLayerByName(dataset, layerName, true).resolutions);
    resolution = resolution || resolutionInfo.getFinestResolution();

    const magString = resolution.join("-");
    return (
      `${dataset.dataStore.url}/data/datasets/${dataset.owningOrganization}/${dataset.name}/layers/${layerName}/data?mag=${magString}&` +
      `token=${token}&` +
      `x=${Math.floor(topLeft[0])}&` +
      `y=${Math.floor(topLeft[1])}&` +
      `z=${Math.floor(topLeft[2])}&` +
      `width=${Math.floor(bottomRight[0] - topLeft[0])}&` +
      `height=${Math.floor(bottomRight[1] - topLeft[1])}&` +
      `depth=${Math.floor(bottomRight[2] - topLeft[2])}`
    );
  }

  /**
   * Downloads a cuboid of raw data from a dataset (not tracing) layer. A new window is opened for the download -
   * if that is not the case, please check your pop-up blocker.
   *
   * @example // Download a cuboid (from (0, 0, 0) to (100, 200, 100)) of raw data from the "segmentation" layer.
   * api.data.downloadRawDataCuboid("segmentation", [0,0,0], [100,200,100]);
   */
  downloadRawDataCuboid(layerName: string, topLeft: Vector3, bottomRight: Vector3): Promise<void> {
    return doWithToken((token) => {
      const downloadUrl = this._getDownloadUrlForRawDataCuboid(
        layerName,
        topLeft,
        bottomRight,
        token,
      );
      window.open(downloadUrl);
      // Theoretically the window.open call could fail if the token is expired, but that would be hard to check
      return Promise.resolve();
    });
  }

  getRawDataCuboid(
    layerName: string,
    topLeft: Vector3,
    bottomRight: Vector3,
    resolution?: Vector3,
  ): Promise<ArrayBuffer> {
    return doWithToken((token) => {
      const downloadUrl = this._getDownloadUrlForRawDataCuboid(
        layerName,
        topLeft,
        bottomRight,
        token,
        resolution,
      );
      return Request.receiveArraybuffer(downloadUrl);
    });
  }

  /**
   * Label voxels with the supplied value. Note that this method does not mutate
   * the data immediately, but instead returns a promise (since the data might
   * have to be downloaded first).
   *
   * _Volume tracing only!_
   *
   * @example // Set the segmentation id for some voxels to 1337
   * await api.data.labelVoxels([[1,1,1], [1,2,1], [2,1,1], [2,2,1]], 1337);
   */
  async labelVoxels(
    voxels: Array<Vector3>,
    label: number,
    additionalCoordinates: AdditionalCoordinate[] | null = null,
  ): Promise<void> {
    assertVolume(Store.getState());
    const segmentationLayer = this.model.getEnforcedSegmentationTracingLayer();
    await Promise.all(
      voxels.map((voxel) =>
        segmentationLayer.cube._labelVoxelInAllResolutions_DEPRECATED(
          voxel,
          additionalCoordinates,
          label,
        ),
      ),
    );
    segmentationLayer.cube.pushQueue.push();
  }

  /**
   * Returns the dataset's setting for the tracing view.
   * @param key - One of the following keys:
     - segmentationOpacity
     - fourBit
     - interpolation
     - layers
     - quality
     - segmentationPatternOpacity
     - renderMissingDataBlack
   *
   * @example
   * const segmentationOpacity = api.data.getConfiguration("segmentationOpacity");
   */
  getConfiguration(key: keyof DatasetConfiguration | OutdatedDatasetConfigurationKeys) {
    const printDeprecationWarning = () =>
      console.warn(`The properties segmentationOpacity and isSegmentationDisabled are no longer directly part of the data configuration.
      Instead, they are part of the segmentation layer configuration and can be accessed as follows:
      "const layerSettings = api.data.getConfiguration('layers');
      const segmentationOpacity = layerSettings[<segmentationLayerName>].alpha;
      const isSegmentationDisabled = layerSettings[<segmentationLayerName>].isDisabled;"`);

    switch (key) {
      case "segmentationOpacity": {
        printDeprecationWarning();
        const segmentationLayer = Model.getVisibleSegmentationLayer();
        return segmentationLayer
          ? Store.getState().datasetConfiguration.layers[segmentationLayer.name].alpha
          : undefined;
      }

      case "isSegmentationDisabled": {
        printDeprecationWarning();
        const segmentationLayer = Model.getVisibleSegmentationLayer();
        return segmentationLayer
          ? Store.getState().datasetConfiguration.layers[segmentationLayer.name].isDisabled
          : undefined;
      }

      default: {
        return Store.getState().datasetConfiguration[key];
      }
    }
  }

  /**
   * Set the dataset's setting for the tracing view.
   * @param key - Same keys as for getConfiguration()
   *
   * @example
   * api.data.setConfiguration("segmentationOpacity", 20);
   */
  setConfiguration(key: keyof DatasetConfiguration | OutdatedDatasetConfigurationKeys, value: any) {
    const printDeprecationWarning = () =>
      console.warn(`The properties segmentationOpacity and isSegmentationDisabled are no longer directly part of the data configuration.
      Instead, they are part of the segmentation layer configuration and can be set as follows:
      "const layerSettings = api.data.getConfiguration('layers');
      const copyOfLayerSettings = _.cloneDeep(layerSettings);
      copyOfLayerSettings[<segmentationLayerName>].alpha = 40;
      copyOfLayerSettings[<segmentationLayerName>].isDisabled = false;
      api.data.setConfiguration('layers', copyOfLayerSettings);"`);

    switch (key) {
      case "segmentationOpacity": {
        printDeprecationWarning();
        const segmentationLayer = Model.getVisibleSegmentationLayer();
        const segmentationLayerName = segmentationLayer != null ? segmentationLayer.name : null;

        if (segmentationLayerName) {
          Store.dispatch(updateLayerSettingAction(segmentationLayerName, "alpha", value));
        }

        break;
      }

      case "isSegmentationDisabled": {
        printDeprecationWarning();
        const segmentationLayer = Model.getVisibleSegmentationLayer();
        const segmentationLayerName = segmentationLayer != null ? segmentationLayer.name : null;

        if (segmentationLayerName) {
          Store.dispatch(updateLayerSettingAction(segmentationLayerName, "isDisabled", value));
        }

        break;
      }

      default: {
        Store.dispatch(updateDatasetSettingAction(key, value));
      }
    }
  }

  /**
   * Retrieve a list of available precomputed mesh files. If layerName is not passed,
   * the currently visible segmentation layer will be used.
   *
   * @example
   * const availableMeshFileNames = api.data.getAvailableMeshFiles();
   */
  async getAvailableMeshFiles(layerName?: string): Promise<Array<string>> {
    const effectiveLayer = getRequestedOrVisibleSegmentationLayer(Store.getState(), layerName);

    if (!effectiveLayer) {
      return Promise.resolve([]);
    }

    const state = Store.getState();
    const { dataset } = state;
    const meshFiles = await dispatchMaybeFetchMeshFilesAsync(
      Store.dispatch,
      effectiveLayer,
      dataset,
      true,
      false,
    );
    return meshFiles.map((meshFile) => meshFile.meshFileName);
  }

  /**
   * Get currently active mesh file (might be null). If layerName is not passed,
   * the currently visible segmentation layer will be used.
   *
   * @example
   * const activeMeshFile = api.data.getActiveMeshFile();
   */
  getActiveMeshFile(layerName?: string): string | null | undefined {
    const effectiveLayer = getRequestedOrVisibleSegmentationLayer(Store.getState(), layerName);

    if (!effectiveLayer) {
      return null;
    }

    const { currentMeshFile } = Store.getState().localSegmentationData[effectiveLayer.name];
    return currentMeshFile != null ? currentMeshFile.meshFileName : null;
  }

  /**
   * Set currently active mesh file (can be set to null). If layerName is not passed,
   * the currently visible segmentation layer will be used.
   *
   * @example
   * const availableMeshFileNames = api.data.getAvailableMeshFiles();
   * if (availableMeshFileNames.length > 0) {
   *   api.data.setActiveMeshFile(availableMeshFileNames[0]);
   * }
   */
  setActiveMeshFile(meshFileName: string | null | undefined, layerName?: string) {
    const effectiveLayerName = getNameOfRequestedOrVisibleSegmentationLayer(
      Store.getState(),
      layerName,
    );

    if (!effectiveLayerName) {
      return;
    }

    if (meshFileName == null) {
      Store.dispatch(updateCurrentMeshFileAction(effectiveLayerName, meshFileName));
      return;
    }

    const state = Store.getState();

    if (
      state.localSegmentationData[effectiveLayerName].availableMeshFiles == null ||
      // @ts-expect-error ts-migrate(2533) FIXME: Object is possibly 'null' or 'undefined'.
      !state.localSegmentationData[effectiveLayerName].availableMeshFiles.find(
        (el) => el.meshFileName === meshFileName,
      )
    ) {
      throw new Error(
        `The provided mesh file (${meshFileName}) is not available for this dataset. Available mesh files are: ${(
          state.localSegmentationData[effectiveLayerName].availableMeshFiles || []
        ).join(", ")}`,
      );
    }

    Store.dispatch(updateCurrentMeshFileAction(effectiveLayerName, meshFileName));
  }

  /**
   * If a mesh file is active, loadPrecomputedMesh can be used to load a mesh for a given segment at a given seed position for
   * a specified segmentation layer. If layerName is not passed, the currently visible segmentation layer will be used.
   * If there is no mesh file for the dataset's segmentation layer available, you can use api.data.computeMeshOnDemand instead.
   *
   * @example
   * const currentPosition = api.tracing.getCameraPosition();
   * const segmentId = await api.data.getDataValue("segmentation", currentPosition);
   * const availableMeshFiles = await api.data.getAvailableMeshFiles();
   * api.data.setActiveMeshFile(availableMeshFiles[0]);
   *
   * api.data.loadPrecomputedMesh(segmentId, currentPosition);
   */
  loadPrecomputedMesh(
    segmentId: number,
    seedPosition: Vector3,
    layerName: string | null | undefined,
    seedAdditionalCoordinates?: AdditionalCoordinate[],
  ) {
    const state = Store.getState();
    const effectiveLayerName = getNameOfRequestedOrVisibleSegmentationLayer(state, layerName);

    if (!effectiveLayerName) {
      return;
    }

    const { dataset } = state;
    const currentMeshFile = state.localSegmentationData[effectiveLayerName].currentMeshFile;

    if (currentMeshFile == null) {
      throw new Error(
        "No mesh file was activated. Please call `api.data.setActiveMeshFile` first (use `api.data.getAvailableMeshFiles` to retrieve candidates).",
      );
    }

    const segmentationLayer = getLayerByName(dataset, effectiveLayerName);

    if (!segmentationLayer) {
      throw new Error("No segmentation layer was found.");
    }

    const { mappingName, meshFileName } = currentMeshFile;

    if (mappingName != null) {
      const activeMapping = this.getActiveMapping(effectiveLayerName);

      if (mappingName !== activeMapping) {
        const activeMappingWarning =
          activeMapping != null
            ? `the currently active mapping is ${activeMapping}`
            : "currently no mapping is active";
        console.warn(
          `The active mesh file ${meshFileName} was computed for mapping ${mappingName} but ${activeMappingWarning}.`,
        );
      }
    }

    Store.dispatch(
      loadPrecomputedMeshAction(
        segmentId,
        seedPosition,
        seedAdditionalCoordinates,
        meshFileName,
        effectiveLayerName,
      ),
    );
  }

  /**
   * Load a mesh for a given segment id and a seed position by computing it ad-hoc.
   *
   * @example
   * const currentPosition = api.tracing.getCameraPosition();
   * const segmentId = await api.data.getDataValue("segmentation", currentPosition);
   * api.data.computeMeshOnDemand(segmentId, currentPosition);
   */
  computeMeshOnDemand(
    segmentId: number,
    seedPosition: Vector3,
    seedAdditionalCoordinates?: AdditionalCoordinate[],
  ) {
    Store.dispatch(loadAdHocMeshAction(segmentId, seedPosition, seedAdditionalCoordinates));
  }

  /**
   * Set the visibility for a loaded mesh by providing the corresponding segment id.
   * If layerName is not passed, the currently visible segmentation layer will be used.
   *
   * @example
   * api.data.setMeshVisibility(segmentId, false);
   */
  setMeshVisibility(segmentId: number, isVisible: boolean, layerName?: string) {
    const effectiveLayerName = getRequestedOrVisibleSegmentationLayerEnforced(
      Store.getState(),
      layerName,
    ).name;

    if (Store.getState().localSegmentationData[effectiveLayerName].meshes?.[segmentId] != null) {
      Store.dispatch(updateMeshVisibilityAction(effectiveLayerName, segmentId, isVisible));
    } else {
      throw new Error(
        `Mesh for segment ${segmentId} was not found in State.localSegmentationData.`,
      );
    }
  }

  /**
   * Remove the mesh for a given segment and segmentation layer. If layerName is not passed,
   * the currently visible segmentation layer will be used.
   *
   * @example
   * api.data.removeMesh(segmentId, layerName);
   */
  removeMesh(segmentId: number, layerName?: string): void {
    const effectiveLayerName = getRequestedOrVisibleSegmentationLayerEnforced(
      Store.getState(),
      layerName,
    ).name;

    if (Store.getState().localSegmentationData[effectiveLayerName].meshes?.[segmentId] != null) {
      Store.dispatch(removeMeshAction(effectiveLayerName, segmentId));
    } else {
      throw new Error(
        `Mesh for segment ${segmentId} was not found in State.localSegmentationData.`,
      );
    }
  }

  /**
   * Removes all meshes from the scene for a given segmentation layer. If layerName is not passed,
   * the currently visible segmentation layer will be used.
   *
   * @example
   * api.data.resetMeshes();
   */
  resetMeshes(layerName?: string) {
    const effectiveLayerName = getRequestedOrVisibleSegmentationLayerEnforced(
      Store.getState(),
      layerName,
    ).name;
    const segmentIds = Object.keys(
      Store.getState().localSegmentationData[effectiveLayerName].meshes || EMPTY_OBJECT,
    );

    for (const segmentId of segmentIds) {
      Store.dispatch(removeMeshAction(effectiveLayerName, Number(segmentId)));
    }
  }

  /*
   * _Experimental_ API for applying a transformation matrix to a given layer. Note
   * that the transformation is only ephemeral for now. If you want to have persistent
   * transformations, store these in the settings JSON of the dataset.
   *
   * @example
   *
   * api.data._setAffineLayerTransforms(
   *   "C555_DIAMOND_2f",
   *   new Float32Array([
   *     0.03901274364025348, -0.08498337289603758, 0.00782446404039791, 555.7948181512004,
   *     0.18572293729076042, -0.029232702290255888, 0.059312326666574045, 135.9381974119121,
   *     0.0348291535208472, 0.005388247300907645, -0.06501029448614315, 561.0668326314798,
   *     0.0, 0.0, 0.0, 1.0,
   *   ]),
   * );
   */
  _setAffineLayerTransforms(layerName: string, transforms: Matrix4x4) {
    const coordinateTransforms = [
      {
        type: "affine" as const,
        matrix: flatToNestedMatrix(Array.from(transforms) as Vector16),
      },
    ];

    Store.dispatch(setLayerTransformsAction(layerName, coordinateTransforms));
  }

  /*
   * _Experimental_ API for creating transformation matrices based on an array of TransformerSpecs.
   * Can be used in combination with _setLayerTransforms.
   *
   * A TransformerSpec can be one of the following
   *  - { type: "scale"; args: [[scaleX, scaleY, scaleZ], [anchorX, anchorY, anchorZ]] }
   *  - { type: "rotate"; args: [thetaInRadAlongZAxis, [anchorX, anchorY, anchorZ]] }
   *  - { type: "translate"; args: [offsetX, offsetY, offsetZ] };
   *
   * @example
   * api.data._setLayerTransforms(
   *  "color",
   *   api.data._createTransformsFromSpecs([
   *     {type: "rotate", args: [1, [3473, 3383, 1024]]},
   *     {type: "translate", args: [0, 10, 0]}]
   *   ),
   * );
   */
  _createTransformsFromSpecs(specs: Array<TransformSpec>) {
    const makeTranslation = (x: number, y: number, z: number): Matrix4x4 =>
      new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
    const makeScale = (scale: Vector3, anchor: Vector3) =>
      M4x4.mul(
        M4x4.scale(scale, makeTranslation(anchor[0], anchor[1], anchor[2])),
        makeTranslation(-anchor[0], -anchor[1], -anchor[2]),
      );
    const makeRotation = (thetaInRad: number, pos: Vector3) =>
      M4x4.mul(
        M4x4.mul(
          makeTranslation(pos[0], pos[1], pos[2]),
          // biome-ignore format: don't format array
          new Float32Array([
            Math.cos(thetaInRad), Math.sin(thetaInRad), 0, 0,
            -Math.sin(thetaInRad), Math.cos(thetaInRad), 0, 0,
            0, 0, 1, 0, 0, 0, 0, 1,
          ]),
        ),
        makeTranslation(-pos[0], -pos[1], -pos[2]),
      );

    let matrix = makeTranslation(0, 0, 0);

    for (const spec of specs) {
      let argMatrix;

      if (spec.type === "scale") {
        argMatrix = makeScale(...spec.args);
      } else if (spec.type === "rotate") {
        argMatrix = makeRotation(...spec.args);
      } else if (spec.type === "translate") {
        argMatrix = makeTranslation(...spec.args);
      } else {
        throw new Error("Unknown transformation spec type");
      }

      matrix = M4x4.mul(argMatrix, matrix);
    }
    return M4x4.transpose(matrix);
  }

  /**
   * Get the RGB color of a segment (and its mesh) for a given segmentation layer. If layerName is not passed,
   * the currently visible segmentation layer will be used.
   *
   * @example
   * api.data.getSegmentColor(3);
   */
  getSegmentColor(segmentId: number, layerName?: string): Vector3 {
    const effectiveLayerName = getRequestedOrVisibleSegmentationLayerEnforced(
      Store.getState(),
      layerName,
    ).name;

    const [r, g, b] = getSegmentColorAsRGBA(Store.getState(), segmentId, effectiveLayerName);
    return [r, g, b];
  }

  /**
   * Set the RGB color of a segment (and its mesh) for a given segmentation layer. If layerName is not passed,
   * the currently visible segmentation layer will be used.
   *
   * @example
   * api.data.setSegmentColor(3, [0, 1, 1]);
   */
  setSegmentColor(segmentId: number, rgbColor: Vector3, layerName?: string) {
    const effectiveLayerName = getRequestedOrVisibleSegmentationLayerEnforced(
      Store.getState(),
      layerName,
    ).name;

    Store.dispatch(
      updateSegmentAction(
        segmentId,
        {
          color: rgbColor,
        },
        effectiveLayerName,
        undefined,
        true,
      ),
    );
  }
}
/**
 * All user configuration related API methods.
 * @example
 * window.webknossos.apiReady(3).then(api => {
 *   api.user.getConfiguration(...);
 *   api.user.setConfiguration(...);
 *   ...
 * }
 */

class UserApi {
  model: OxalisModel;

  constructor(model: OxalisModel) {
    this.model = model;
  }

  /**
  * Returns the user's setting for the tracing view.
  * @param key - One of the following keys:
    - moveValue
    - moveValue3d
    - rotateValue
    - crosshairSize
    - mouseRotateValue
    - clippingDistance
    - clippingDistanceArbitrary
    - dynamicSpaceDirection
    - displayCrosshair
    - displayScalebars
    - scale
    - tdViewDisplayPlanes
    - tdViewDisplayDatasetBorders
    - tdViewDisplayLayerBorders
    - newNodeNewTree
    - centerNewNode
    - highlightCommentedNodes
    - keyboardDelay
    - particleSize
    - overrideNodeRadius
    - sortTreesByName
    - sortCommentsAsc
    - sphericalCapRadius
    - hideTreeRemovalWarning
  *
  * @example
  * const keyboardDelay = api.user.getConfiguration("keyboardDelay");
  */
  getConfiguration(key: keyof UserConfiguration) {
    const value = Store.getState().userConfiguration[key];

    // Backwards compatibility
    if (key === "tdViewDisplayPlanes") {
      return value === TDViewDisplayModeEnum.DATA;
    }

    return value;
  }

  /**
   * Set the user's setting for the tracing view.
   * @param key - Same keys as for getConfiguration()
   *
   * @example
   * api.user.setConfiguration("keyboardDelay", 20);
   */
  setConfiguration(key: keyof UserConfiguration, value: any) {
    // Backwards compatibility
    if (key === "tdViewDisplayPlanes") {
      value = value ? TDViewDisplayModeEnum.DATA : TDViewDisplayModeEnum.WIREFRAME;
    }

    Store.dispatch(updateUserSettingAction(key, value));
  }
}

export type UnregisterHandler = {
  unregister(): void;
};
/**
 * Utility API methods to control wK.
 * @example
 * window.webknossos.apiReady(3).then(api => {
 *   api.utils.sleep(...);
 *   api.utils.showToast(...);
 *   ...
 * }
 */

class UtilsApi {
  model: OxalisModel;

  constructor(model: OxalisModel) {
    this.model = model;
  }

  /**
   * Wait for some milliseconds before continuing the control flow.
   *
   * @example // Wait for 5 seconds
   * await api.utils.sleep(5000);
   */
  sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }

  /**
   * Show a toast to the user. Returns a function which can be used to remove the toast again.
   *
   * @param {string} type - Can be one of the following: "info", "warning", "success" or "error"
   * @param {string} message - The message string you want to show
   * @param {number} timeout - Time period in milliseconds after which the toast will be hidden. Time is measured as soon as the user moves the mouse. A value of 0 means that the toast will only hide by clicking on it's X button.
   * @example // Show a toast for 5 seconds
   * const removeToast = api.utils.showToast("info", "You just got toasted", false, 5000);
   * // ... optionally:
   * // removeToast();
   */
  showToast(
    type: ToastStyle,
    message: string,
    timeout?: number,
  ): ((...args: Array<any>) => any) | null | undefined {
    Toast.message(type, message, {
      sticky: timeout === 0,
      timeout,
    });
    return () => Toast.close(message);
  }

  /**
   * Overwrite existing wK actions. wK uses [Redux](http://redux.js.org/) actions to trigger any changes to the application state.
   * @param {function(store, next, originalAction)} overwriteFunction - Your new implementation for the method in question. Receives the central wK store, a callback to fire the next/original action and the original action.
   * @param {string} actionName - The name of the action you wish to override:
   *   - CREATE_NODE
   *   - DELETE_NODE
   *   - SET_ACTIVE_NODE
   *   - SET_NODE_RADIUS
   *   - CREATE_BRANCHPOINT
   *   - DELETE_BRANCHPOINT
   *   - CREATE_TREE
   *   - DELETE_TREE
   *   - SET_ACTIVE_TREE
   *   - SET_ACTIVE_GROUP
   *   - SET_TREE_NAME
   *   - MERGE_TREES
   *   - SELECT_NEXT_TREE
   *   - SHUFFLE_TREE_COLOR
   *   - SHUFFLE_ALL_TREE_COLORS
   *   - CREATE_COMMENT
   *   - DELETE_COMMENT
   * @returns {function()} - A function used to unregister the overwriteFunction
   *
   *
   * @example
   * api.utils.registerOverwrite("MERGE_TREES", (store, next, originalAction) => {
   *   // ... do stuff before the original function...
   *   next(originalAction);
   *   // ... do something after the original function ...
   * });
   */
  registerOverwrite<S, A>(
    actionName: string,
    overwriteFunction: (store: S, next: (action: A) => void, originalAction: A) => A | Promise<A>,
  ) {
    return overwriteAction(actionName, overwriteFunction);
  }

  /**
   * Sets a custom handler function for a keyboard shortcut.
   */
  registerKeyHandler(key: string, handler: () => void): UnregisterHandler {
    const keyboard = new InputKeyboardNoLoop({
      [key]: handler,
    });
    return {
      unregister: keyboard.destroy.bind(keyboard),
    };
  }
}

export type ApiInterface = {
  tracing: TracingApi;
  data: DataApi;
  user: UserApi;
  utils: UtilsApi;
};
export default function createApiInterface(model: OxalisModel): ApiInterface {
  return {
    tracing: new TracingApi(model),
    data: new DataApi(model),
    user: new UserApi(model),
    utils: new UtilsApi(model),
  };
}

import {
  ArrowsAltOutlined,
  BackwardOutlined,
  CodeSandboxOutlined,
  CodepenOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  NumberOutlined,
  PictureOutlined,
  PlusOutlined,
  RocketOutlined,
  ShrinkOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { Avatar, Button, List } from "antd";
import _ from "lodash";
import * as React from "react";

import classNames from "classnames";
import FormattedDate from "components/formatted_date";
import { useWkSelector } from "libs/react_hooks";
import { formatUserName, getContributorById } from "viewer/model/accessors/user_accessor";
import { getReadableNameByVolumeTracingId } from "viewer/model/accessors/volumetracing_accessor";
import type {
  AddLayerToAnnotationUpdateAction,
  AddSegmentIndexUpdateAction,
  AddUserBoundingBoxInSkeletonTracingAction,
  AddUserBoundingBoxInVolumeTracingAction,
  AsServerAction,
  CreateEdgeUpdateAction,
  CreateNodeUpdateAction,
  CreateSegmentUpdateAction,
  DeleteAnnotationLayerUpdateAction,
  DeleteEdgeUpdateAction,
  DeleteNodeUpdateAction,
  DeleteSegmentDataUpdateAction,
  DeleteSegmentUpdateAction,
  DeleteTreeUpdateAction,
  DeleteUserBoundingBoxInSkeletonTracingAction,
  DeleteUserBoundingBoxInVolumeTracingAction,
  LEGACY_MergeTreeUpdateAction,
  LEGACY_UpdateUserBoundingBoxesInSkeletonTracingUpdateAction,
  LEGACY_UpdateUserBoundingBoxesInVolumeTracingUpdateAction,
  MergeAgglomerateUpdateAction,
  MoveTreeComponentUpdateAction,
  RevertToVersionUpdateAction,
  ServerUpdateAction,
  SplitAgglomerateUpdateAction,
  UpdateActiveNodeUpdateAction,
  UpdateActiveSegmentIdUpdateAction,
  UpdateAnnotationLayerNameUpdateAction,
  UpdateBucketUpdateAction,
  UpdateCameraAnnotationAction,
  UpdateLargestSegmentIdVolumeAction,
  UpdateMappingNameUpdateAction,
  UpdateMetadataOfAnnotationUpdateAction,
  UpdateNodeUpdateAction,
  UpdateSegmentGroupVisibilityVolumeAction,
  UpdateSegmentGroupsExpandedStateUpdateAction,
  UpdateSegmentGroupsUpdateAction,
  UpdateSegmentUpdateAction,
  UpdateSegmentVisibilityVolumeAction,
  UpdateTreeEdgesVisibilityUpdateAction,
  UpdateTreeGroupVisibilityUpdateAction,
  UpdateTreeGroupsExpandedStateAction,
  UpdateTreeUpdateAction,
  UpdateTreeVisibilityUpdateAction,
  UpdateUserBoundingBoxInSkeletonTracingAction,
  UpdateUserBoundingBoxInVolumeTracingAction,
  UpdateUserBoundingBoxVisibilityInSkeletonTracingAction,
  UpdateUserBoundingBoxVisibilityInVolumeTracingAction,
} from "viewer/model/sagas/volume/update_actions";
import type { StoreAnnotation } from "viewer/store";
import { MISSING_GROUP_ID } from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
type Description = {
  description: string;
  icon: React.ReactNode;
};
const updateTracingDescription = {
  description: "Modified the annotation.",
  icon: <EditOutlined />,
};
// The order in which the update actions are added to this object,
// determines the order in which update actions are checked
// to describe an update action batch. See also the comment
// of the `getDescriptionForBatch` function.
const descriptionFns: Record<
  ServerUpdateAction["name"],
  (
    firstAction: AsServerAction<any>,
    actionCount: number,
    annotation: StoreAnnotation,
  ) => Description
> = {
  importVolumeTracing: (): Description => ({
    description: "Imported a volume tracing.",
    icon: <PlusOutlined />,
  }),
  createTracing: (): Description => ({
    description: "Created the annotation.",
    icon: <RocketOutlined />,
  }),
  updateUserBoundingBoxesInSkeletonTracing: (
    firstAction: AsServerAction<LEGACY_UpdateUserBoundingBoxesInSkeletonTracingUpdateAction>,
  ): Description => ({
    description: `Updated bounding boxes ${firstAction.value.boundingBoxes.map((bbox) => bbox.id).join(", ")}.`,
    icon: <CodepenOutlined />,
  }),
  updateUserBoundingBoxesInVolumeTracing: (
    firstAction: AsServerAction<LEGACY_UpdateUserBoundingBoxesInVolumeTracingUpdateAction>,
  ): Description => ({
    description: `Updated bounding boxes ${firstAction.value.boundingBoxes.map((bbox) => bbox.id).join(", ")}.`,
    icon: <CodepenOutlined />,
  }),
  addUserBoundingBoxInSkeletonTracing: (
    firstAction: AsServerAction<AddUserBoundingBoxInSkeletonTracingAction>,
  ): Description => ({
    description: `Created bounding box ${firstAction.value.boundingBox.id}.`,
    icon: <PlusOutlined />,
  }),
  addUserBoundingBoxInVolumeTracing: (
    firstAction: AsServerAction<AddUserBoundingBoxInVolumeTracingAction>,
  ): Description => ({
    description: `Created bounding box ${firstAction.value.boundingBox.id}.`,
    icon: <PlusOutlined />,
  }),
  deleteUserBoundingBoxInSkeletonTracing: (
    firstAction: AsServerAction<DeleteUserBoundingBoxInSkeletonTracingAction>,
  ): Description => ({
    description: `Deleted bounding box ${firstAction.value.boundingBoxId}.`,
    icon: <DeleteOutlined />,
  }),
  deleteUserBoundingBoxInVolumeTracing: (
    firstAction: AsServerAction<DeleteUserBoundingBoxInVolumeTracingAction>,
  ): Description => ({
    description: `Deleted bounding box ${firstAction.value.boundingBoxId}.`,
    icon: <DeleteOutlined />,
  }),
  updateUserBoundingBoxInSkeletonTracing: (
    firstAction: AsServerAction<UpdateUserBoundingBoxInSkeletonTracingAction>,
  ): Description => ({
    description: `Updated bounding box ${firstAction.value.boundingBoxId}.`,
    icon: <EditOutlined />,
  }),
  updateUserBoundingBoxInVolumeTracing: (
    firstAction: AsServerAction<UpdateUserBoundingBoxInVolumeTracingAction>,
  ): Description => ({
    description: `Updated bounding box ${firstAction.value.boundingBoxId}.`,
    icon: <EditOutlined />,
  }),
  removeFallbackLayer: (): Description => ({
    description: "Removed the segmentation fallback layer.",
    icon: <DeleteOutlined />,
  }),
  updateMappingName: (action: AsServerAction<UpdateMappingNameUpdateAction>): Description => ({
    description:
      action.value.mappingName != null
        ? `Activated mapping ${action.value.mappingName}.`
        : "Deactivated the active mapping.",
    icon: <EyeOutlined />,
  }),
  splitAgglomerate: (action: AsServerAction<SplitAgglomerateUpdateAction>): Description => {
    const segment1Description =
      action.value.segmentPosition1 != null
        ? `at position ${action.value.segmentPosition1}`
        : (action.value.segmentId1 ?? "unknown");
    const segment2Description =
      action.value.segmentPosition2 ?? action.value.segmentId1 ?? "unknown";
    const description = `Split agglomerate ${action.value.agglomerateId} by separating the segments ${segment1Description} and ${segment2Description}.`;
    return {
      description,
      icon: <DeleteOutlined />,
    };
  },
  mergeAgglomerate: (action: AsServerAction<MergeAgglomerateUpdateAction>): Description => {
    const segment1Description =
      action.value.segmentPosition1 != null
        ? `at position ${action.value.segmentPosition1}`
        : (action.value.segmentId1 ?? "unknown");
    const segment2Description =
      action.value.segmentPosition2 ?? action.value.segmentId1 ?? "unknown";
    const description = `Merged agglomerates ${action.value.agglomerateId1} and ${action.value.agglomerateId2} by combining the segments  ${segment1Description} and ${segment2Description}.`;
    return {
      description,
      icon: <PlusOutlined />,
    };
  },
  deleteTree: (action: AsServerAction<DeleteTreeUpdateAction>, count: number): Description => ({
    description:
      count > 1 ? `Deleted ${count} trees.` : `Deleted the tree with id ${action.value.id}.`,
    icon: <DeleteOutlined />,
  }),
  deleteNode: (action: AsServerAction<DeleteNodeUpdateAction>, count: number): Description => ({
    description:
      count > 1 ? `Deleted ${count} nodes.` : `Deleted the node with id ${action.value.nodeId}.`,
    icon: <DeleteOutlined />,
  }),
  revertToVersion: (action: AsServerAction<RevertToVersionUpdateAction>): Description => ({
    description: `Reverted to version ${action.value.sourceVersion}.`,
    icon: <BackwardOutlined />,
  }),
  createNode: (action: AsServerAction<CreateNodeUpdateAction>): Description => ({
    description: `Created the node with id ${action.value.id}.`,
    icon: <PlusOutlined />,
  }),
  createTree: (action: AsServerAction<UpdateTreeUpdateAction>): Description => ({
    description: `Created the tree with id ${action.value.id}.`,
    icon: <PlusOutlined />,
  }),
  updateTreeGroups: (): Description => ({
    description: "Updated the tree groups.",
    icon: <EditOutlined />,
  }),
  updateTree: (action: AsServerAction<UpdateTreeUpdateAction>): Description => ({
    description: `Updated the tree with id ${action.value.id}.`,
    icon: <EditOutlined />,
  }),
  updateBucket: (
    firstAction: AsServerAction<UpdateBucketUpdateAction>,
    _actionCount: number,
    annotation: StoreAnnotation,
  ): Description => {
    const layerName = maybeGetReadableVolumeTracingName(
      annotation,
      firstAction.value.actionTracingId,
    );
    return {
      description: `Updated the segmentation of layer ${layerName}.`,
      icon: <PictureOutlined />,
    };
  },
  updateSegmentGroups: (
    firstAction: AsServerAction<UpdateSegmentGroupsUpdateAction>,
    _actionCount: number,
    annotation: StoreAnnotation,
  ): Description => {
    const layerName = maybeGetReadableVolumeTracingName(
      annotation,
      firstAction.value.actionTracingId,
    );
    return {
      description: `Updated the segment groups of layer ${layerName}.`,
      icon: <EditOutlined />,
    };
  },
  updateSegmentVisibility: (
    firstAction: AsServerAction<UpdateSegmentVisibilityVolumeAction>,
    _actionCount: number,
    annotation: StoreAnnotation,
  ): Description => {
    const layerName = maybeGetReadableVolumeTracingName(
      annotation,
      firstAction.value.actionTracingId,
    );
    return {
      description: `Updated the visibility of segments of layer ${layerName}.`,
      icon: <EyeOutlined />,
    };
  },
  updateSegmentGroupVisibility: (
    firstAction: AsServerAction<UpdateSegmentGroupVisibilityVolumeAction>,
    _actionCount: number,
    annotation: StoreAnnotation,
  ): Description => {
    const layerName = maybeGetReadableVolumeTracingName(
      annotation,
      firstAction.value.actionTracingId,
    );
    return {
      description: `Updated the visibility of segment groups of layer ${layerName}.`,
      icon: <EyeOutlined />,
    };
  },
  updateNode: (action: AsServerAction<UpdateNodeUpdateAction>): Description => ({
    description: `Updated the node with id ${action.value.id}.`,
    icon: <EditOutlined />,
  }),
  updateTreeVisibility: (
    action: AsServerAction<UpdateTreeVisibilityUpdateAction>,
  ): Description => ({
    description: `Updated the visibility of the tree with id ${action.value.treeId}.`,
    icon: <EyeOutlined />,
  }),
  updateTreeEdgesVisibility: (
    action: AsServerAction<UpdateTreeEdgesVisibilityUpdateAction>,
  ): Description => ({
    description: `Updated the visibility of the edges of the tree with id ${action.value.treeId}.`,
    icon: <img src="/assets/images/hide-skeleton-edges-icon.svg" alt="Hide Tree Edges Icon" />,
  }),
  updateTreeGroupVisibility: (
    action: AsServerAction<UpdateTreeGroupVisibilityUpdateAction>,
  ): Description => ({
    description: `Updated the visibility of the group with id ${
      action.value.treeGroupId != null ? action.value.treeGroupId : MISSING_GROUP_ID
    }.`,
    icon: <EyeOutlined />,
  }),
  createEdge: (action: AsServerAction<CreateEdgeUpdateAction>): Description => ({
    description: `Created the edge between node ${action.value.source} and node ${action.value.target}.`,
    icon: <PlusOutlined />,
  }),
  deleteEdge: (action: AsServerAction<DeleteEdgeUpdateAction>): Description => ({
    description: `Deleted the edge between node ${action.value.source} and node ${action.value.target}.`,
    icon: <DeleteOutlined />,
  }),
  updateTdCamera: (): Description => ({
    description: "Updated the 3D view.",
    icon: <CodeSandboxOutlined />,
  }),
  createSegment: (
    firstAction: AsServerAction<CreateSegmentUpdateAction>,
    _actionCount: number,
    annotation: StoreAnnotation,
  ): Description => {
    const layerName = maybeGetReadableVolumeTracingName(
      annotation,
      firstAction.value.actionTracingId,
    );
    return {
      description: `Added the segment with id ${firstAction.value.id} to the segments list of layer ${layerName}.`,
      icon: <PlusOutlined />,
    };
  },
  updateSegment: (
    firstAction: AsServerAction<UpdateSegmentUpdateAction>,
    _actionCount: number,
    annotation: StoreAnnotation,
  ): Description => {
    const layerName = maybeGetReadableVolumeTracingName(
      annotation,
      firstAction.value.actionTracingId,
    );
    return {
      description: `Updated the segment with id ${firstAction.value.id} in the segments list  of layer ${layerName}.`,
      icon: <EditOutlined />,
    };
  },
  deleteSegment: (
    firstAction: AsServerAction<DeleteSegmentUpdateAction>,
    _actionCount: number,
    annotation: StoreAnnotation,
  ): Description => {
    const layerName = maybeGetReadableVolumeTracingName(
      annotation,
      firstAction.value.actionTracingId,
    );
    return {
      description: `Deleted the segment with id ${firstAction.value.id} from the segments list of layer ${layerName}.`,
      icon: <DeleteOutlined />,
    };
  },
  deleteSegmentData: (
    firstAction: AsServerAction<DeleteSegmentDataUpdateAction>,
    _actionCount: number,
    annotation: StoreAnnotation,
  ): Description => {
    const layerName = maybeGetReadableVolumeTracingName(
      annotation,
      firstAction.value.actionTracingId,
    );
    return {
      description: `Deleted the data of segment ${firstAction.value.id} of layer ${layerName}. All voxels with that id were overwritten with 0.`,
      icon: <DeleteOutlined />,
    };
  },
  addSegmentIndex: (
    firstAction: AsServerAction<AddSegmentIndexUpdateAction>,
    _actionCount: number,
    annotation: StoreAnnotation,
  ): Description => {
    const layerName = maybeGetReadableVolumeTracingName(
      annotation,
      firstAction.value.actionTracingId,
    );
    return {
      description: `Added segment index to layer ${layerName} to enable segment statistics.`,
      icon: <EditOutlined />,
    };
  },
  // This should never be shown since currently this update action can only be triggered
  // by merging or splitting trees which is recognized separately, before this description
  // is accessed.
  moveTreeComponent: (action: AsServerAction<MoveTreeComponentUpdateAction>): Description => ({
    description: `Moved ${action.value.nodeIds.length} nodes from tree with id ${action.value.sourceId} to tree with id ${action.value.targetId}.`,
    icon: <EditOutlined />,
  }),
  // This should never be shown since currently this update action is never dispatched.
  mergeTree: (action: AsServerAction<LEGACY_MergeTreeUpdateAction>): Description => ({
    description: `Merged the trees with id ${action.value.sourceId} and ${action.value.targetId}.`,
    icon: <EditOutlined />,
  }),
  updateSkeletonTracing: (): Description => updateTracingDescription,
  updateVolumeTracing: (): Description => updateTracingDescription,
  updateActiveSegmentId: (
    action: AsServerAction<UpdateActiveSegmentIdUpdateAction>,
  ): Description => {
    return {
      description: `Activated segment id ${action.value.activeSegmentId}`,
      icon: <EditOutlined />,
    };
  },
  addLayerToAnnotation: (
    action: AsServerAction<AddLayerToAnnotationUpdateAction>,
  ): Description => ({
    description: `Added the layer ${action.value.layerParameters.name} to the annotation.`,
    icon: <PlusOutlined />,
  }),
  deleteLayerFromAnnotation: (
    action: AsServerAction<DeleteAnnotationLayerUpdateAction>,
  ): Description => ({
    description: `Deleted the layer with id ${action.value.layerName} (${action.value.tracingId}) from the annotation.`,
    icon: <DeleteOutlined />,
  }),
  updateLayerMetadata: (
    action: AsServerAction<UpdateAnnotationLayerNameUpdateAction>,
  ): Description => ({
    description: `Updated the name of the layer with id ${action.value.tracingId} to ${action.value.layerName}.`,
    icon: <EditOutlined />,
  }),
  updateMetadataOfAnnotation: (
    action: AsServerAction<UpdateMetadataOfAnnotationUpdateAction>,
  ): Description => {
    return {
      description: `Updated the description of the annotation to: ${action.value.description.slice(0, 100) || ""}`,
      icon: <EditOutlined />,
    };
  },
  updateActiveNode: (action: AsServerAction<UpdateActiveNodeUpdateAction>): Description => {
    return {
      description: `Updated the active node id to ${action.value.activeNode}`,
      icon: <EditOutlined />,
    };
  },
  updateCamera: (_action: AsServerAction<UpdateCameraAnnotationAction>): Description => {
    return {
      description: "Adjusted the camera",
      icon: <VideoCameraOutlined />,
    };
  },
  updateLargestSegmentId: (
    action: AsServerAction<UpdateLargestSegmentIdVolumeAction>,
  ): Description => {
    return {
      description: `Set largest segment id to ${action.value.largestSegmentId}`,
      icon: <NumberOutlined />,
    };
  },
  updateSegmentGroupsExpandedState: (
    action: AsServerAction<UpdateSegmentGroupsExpandedStateUpdateAction>,
  ): Description => {
    return {
      description: `${action.value.areExpanded ? "Expanded" : "Collapsed"} some segment groups.`,
      icon: <FolderOpenOutlined />,
    };
  },
  updateTreeGroupsExpandedState: (
    action: AsServerAction<UpdateTreeGroupsExpandedStateAction>,
  ): Description => {
    return {
      description: `${action.value.areExpanded ? "Expanded" : "Collapsed"} some tree groups.`,
      icon: <FolderOpenOutlined />,
    };
  },
  updateUserBoundingBoxVisibilityInSkeletonTracing: (
    firstAction: AsServerAction<UpdateUserBoundingBoxVisibilityInSkeletonTracingAction>,
  ): Description => ({
    description: `Toggled the visibility of bounding box ${firstAction.value.boundingBoxId}.`,
    icon: <EyeOutlined />,
  }),
  updateUserBoundingBoxVisibilityInVolumeTracing: (
    firstAction: AsServerAction<UpdateUserBoundingBoxVisibilityInVolumeTracingAction>,
  ): Description => ({
    description: `Toggled the visibility of bounding box ${firstAction.value.boundingBoxId}.`,
    icon: <EyeOutlined />,
  }),
} as const;

function maybeGetReadableVolumeTracingName(annotation: StoreAnnotation, tracingId: string): string {
  const volumeTracing = annotation.volumes.find((volume) => volume.tracingId === tracingId);
  return volumeTracing != null
    ? getReadableNameByVolumeTracingId(annotation, volumeTracing.tracingId)
    : "<unknown>";
}

function getDescriptionForSpecificBatch(
  actions: Array<ServerUpdateAction>,
  type: string,
  annotation: StoreAnnotation,
): Description {
  const firstAction = actions[0];

  if (firstAction.name !== type) {
    throw new Error("Type constraint violated");
  }
  const fn = descriptionFns[type];
  return fn(firstAction, actions.length, annotation);
}

// An update action batch can consist of more than one update action as a single user action
// can lead to multiple update actions. For example, deleting a node in a tree with multiple
// nodes will also delete an edge, so the batch contains those two update actions.
// This particular action and many more actions modify the active node of the tracing
// which results in an updateTracing action being part of the batch as well.
// The key of this function is to identify the most prominent action of a batch and label the
// batch with a description of this action.
// The order in which the actions are checked is, therefore, important. Check for
// "more expressive" update actions first and for more general ones later.
// The order is determined by the order in which the update actions are added to the
// `descriptionFns` object.
function getDescriptionForBatch(
  actions: Array<ServerUpdateAction>,
  annotation: StoreAnnotation,
): Description {
  const groupedUpdateActions = _.groupBy(actions, "name");

  const moveTreeComponentUAs = groupedUpdateActions.moveTreeComponent;

  if (moveTreeComponentUAs != null) {
    const firstMoveTreeComponentUA = moveTreeComponentUAs[0];

    if (firstMoveTreeComponentUA.name !== "moveTreeComponent") {
      throw new Error("Type constraint violated");
    }

    if (groupedUpdateActions.createTree != null) {
      return {
        description: `Split off a tree with ${firstMoveTreeComponentUA.value.nodeIds.length} nodes.`,
        icon: <ArrowsAltOutlined />,
      };
    } else if (groupedUpdateActions.deleteTree != null) {
      return {
        description: `Merged a tree with ${firstMoveTreeComponentUA.value.nodeIds.length} nodes.`,
        icon: <ShrinkOutlined />,
      };
    }
  }

  // If more than one createNode update actions are part of one batch, that is not a tree merge or split,
  // an NML was uploaded or an undo/redo action took place.
  const createNodeUAs = groupedUpdateActions.createNode;

  if (createNodeUAs != null && createNodeUAs.length > 1) {
    const createTreeUAs = groupedUpdateActions.createTree;

    if (createTreeUAs != null) {
      const pluralS = createTreeUAs.length > 1 ? "s" : "";
      return {
        description: `Added ${createTreeUAs.length} tree${pluralS} and ${createNodeUAs.length} nodes.`,
        icon: <PlusOutlined />,
      };
    }

    return {
      description: `Added ${createNodeUAs.length} nodes.`,
      icon: <PlusOutlined />,
    };
  }

  for (const key of Object.keys(descriptionFns)) {
    const updateActions = groupedUpdateActions[key];

    if (updateActions != null) {
      return getDescriptionForSpecificBatch(updateActions, key, annotation);
    }
  }

  // Catch-all for other update actions, currently updateTracing.
  return updateTracingDescription;
}

type Props = {
  actions: Array<ServerUpdateAction>;
  initialAllowUpdate: boolean;
  version: number;
  isNewest: boolean;
  isActive: boolean;
  isIndented: boolean;
  onRestoreVersion: (arg0: number) => Promise<void>;
  onPreviewVersion: (arg0: number) => Promise<void>;
};
export default function VersionEntry({
  actions,
  initialAllowUpdate,
  version,
  isNewest,
  isActive,
  isIndented,
  onRestoreVersion,
  onPreviewVersion,
}: Props) {
  const lastTimestamp = _.max(actions.map((action) => action.value.actionTimestamp));
  const contributors = useWkSelector((state) => state.annotation.contributors);
  const activeUser = useWkSelector((state) => state.activeUser);
  const owner = useWkSelector((state) => state.annotation.owner);
  const annotation = useWkSelector((state) => state.annotation);

  const liClassName = classNames("version-entry", {
    "active-version-entry": isActive,
    "version-entry-indented": isIndented,
  });
  const restoreButton = (
    <Button
      size="small"
      key="restore-button"
      type="primary"
      onClick={() => onRestoreVersion(version)}
    >
      {initialAllowUpdate ? "Restore" : "Download"}
    </Button>
  );
  const { description, icon } = getDescriptionForBatch(actions, annotation);

  // In case the actionAuthorId is not set, the action was created before the multi-contributor
  // support. Default to the owner in that case.
  const author = getContributorById(actions[0].value.actionAuthorId, contributors) || owner;
  const authorName = formatUserName(activeUser, author);

  return (
    <List.Item
      style={{
        cursor: "pointer",
      }}
      className={liClassName}
      actions={isActive && !isNewest ? [restoreButton] : []}
    >
      <List.Item.Meta
        title={
          <React.Fragment>
            Version {version} (
            {lastTimestamp != null && <FormattedDate timestamp={lastTimestamp} format="HH:mm" />})
          </React.Fragment>
        }
        /* @ts-expect-error ts-migrate(2322) FIXME: Type '{ title: Element; onClick: () => Promise<voi... Remove this comment to see the full error message */
        onClick={() => onPreviewVersion(version)}
        avatar={<Avatar size="small" icon={icon} />}
        description={
          <React.Fragment>
            {isNewest ? (
              <>
                <i>Newest version</i> <br />
              </>
            ) : null}
            {description}
            <div>Authored by {authorName}</div>
          </React.Fragment>
        }
      />
    </List.Item>
  );
}

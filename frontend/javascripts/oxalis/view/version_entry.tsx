import { Avatar, Button, List } from "antd";
import {
  ArrowsAltOutlined,
  BackwardOutlined,
  CodepenOutlined,
  CodeSandboxOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PictureOutlined,
  PlusOutlined,
  RocketOutlined,
  ShrinkOutlined,
} from "@ant-design/icons";
import * as React from "react";
import _ from "lodash";

import classNames from "classnames";
import type {
  ServerUpdateAction,
  CreateNodeUpdateAction,
  DeleteNodeUpdateAction,
  UpdateTreeUpdateAction,
  DeleteTreeUpdateAction,
  RevertToVersionUpdateAction,
  UpdateNodeUpdateAction,
  UpdateTreeVisibilityUpdateAction,
  UpdateTreeEdgesVisibilityUpdateAction,
  UpdateTreeGroupVisibilityUpdateAction,
  CreateEdgeUpdateAction,
  DeleteEdgeUpdateAction,
  SplitAgglomerateUpdateAction,
  MergeAgglomerateUpdateAction,
  CreateSegmentUpdateAction,
  UpdateSegmentUpdateAction,
  DeleteSegmentUpdateAction,
  MoveTreeComponentUpdateAction,
  MergeTreeUpdateAction,
  UpdateAnnotationLayerNameUpdateAction,
  UpdateMappingNameUpdateAction,
  DeleteSegmentDataUpdateAction,
  UpdateActionWithTracingId,
  AddLayerToAnnotationUpdateAction,
  DeleteAnnotationLayerUpdateAction,
  UpdateMetadataOfAnnotationUpdateAction,
} from "oxalis/model/sagas/update_actions";
import FormattedDate from "components/formatted_date";
import { MISSING_GROUP_ID } from "oxalis/view/right-border-tabs/tree_hierarchy_view_helpers";
import { useSelector } from "react-redux";
import type { HybridTracing, OxalisState } from "oxalis/store";
import { formatUserName, getContributorById } from "oxalis/model/accessors/user_accessor";
import { getReadableNameByVolumeTracingId } from "oxalis/model/accessors/volumetracing_accessor";
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
  (firstAction: any, actionCount: number, tracing: HybridTracing) => Description
> = {
  importVolumeTracing: (): Description => ({
    description: "Imported a volume tracing.",
    icon: <PlusOutlined />,
  }),
  createTracing: (): Description => ({
    description: "Created the annotation.",
    icon: <RocketOutlined />,
  }),
  updateUserBoundingBoxesInSkeletonTracing: (): Description => ({
    description: "Updated a bounding box.",
    icon: <CodepenOutlined />,
  }),
  updateUserBoundingBoxesInVolumeTracing: (): Description => ({
    description: "Updated a bounding box.",
    icon: <CodepenOutlined />,
  }),
  removeFallbackLayer: (): Description => ({
    description: "Removed the segmentation fallback layer.",
    icon: <DeleteOutlined />,
  }),
  updateMappingName: (action: UpdateMappingNameUpdateAction): Description => ({
    description:
      action.value.mappingName != null
        ? `Activated mapping ${action.value.mappingName}.`
        : "Deactivated the active mapping.",
    icon: <EyeOutlined />,
  }),
  splitAgglomerate: (action: SplitAgglomerateUpdateAction): Description => {
    const segment1Description =
      action.value.segmentPosition1 != null
        ? `at position ${action.value.segmentPosition1}`
        : action.value.segmentId1 ?? "unknown";
    const segment2Description =
      action.value.segmentPosition2 ?? action.value.segmentId1 ?? "unknown";
    const description = `Split agglomerate ${action.value.agglomerateId} by separating the segments ${segment1Description} and ${segment2Description}.`;
    return {
      description,
      icon: <DeleteOutlined />,
    };
  },
  mergeAgglomerate: (action: MergeAgglomerateUpdateAction): Description => {
    const segment1Description =
      action.value.segmentPosition1 != null
        ? `at position ${action.value.segmentPosition1}`
        : action.value.segmentId1 ?? "unknown";
    const segment2Description =
      action.value.segmentPosition2 ?? action.value.segmentId1 ?? "unknown";
    const description = `Merged agglomerates ${action.value.agglomerateId1} and ${action.value.agglomerateId2} by combining the segments  ${segment1Description} and ${segment2Description}.`;
    return {
      description,
      icon: <PlusOutlined />,
    };
  },
  deleteTree: (action: DeleteTreeUpdateAction, count: number): Description => ({
    description:
      count > 1 ? `Deleted ${count} trees.` : `Deleted the tree with id ${action.value.id}.`,
    icon: <DeleteOutlined />,
  }),
  deleteNode: (action: DeleteNodeUpdateAction, count: number): Description => ({
    description:
      count > 1 ? `Deleted ${count} nodes.` : `Deleted the node with id ${action.value.nodeId}.`,
    icon: <DeleteOutlined />,
  }),
  revertToVersion: (action: RevertToVersionUpdateAction): Description => ({
    description: `Reverted to version ${action.value.sourceVersion}.`,
    icon: <BackwardOutlined />,
  }),
  createNode: (action: CreateNodeUpdateAction): Description => ({
    description: `Created the node with id ${action.value.id}.`,
    icon: <PlusOutlined />,
  }),
  createTree: (action: UpdateTreeUpdateAction): Description => ({
    description: `Created the tree with id ${action.value.id}.`,
    icon: <PlusOutlined />,
  }),
  updateTreeGroups: (): Description => ({
    description: "Updated the tree groups.",
    icon: <EditOutlined />,
  }),
  updateTree: (action: UpdateTreeUpdateAction): Description => ({
    description: `Updated the tree with id ${action.value.id}.`,
    icon: <EditOutlined />,
  }),
  updateBucket: (
    firstAction: UpdateActionWithTracingId,
    _actionCount: number,
    tracing: HybridTracing,
  ): Description => {
    const layerName = maybeGetReadableVolumeTracingName(tracing, firstAction.value.actionTracingId);
    return {
      description: `Updated the segmentation of layer ${layerName}.`,
      icon: <PictureOutlined />,
    };
  },
  updateSegmentGroups: (
    firstAction: UpdateActionWithTracingId,
    _actionCount: number,
    tracing: HybridTracing,
  ): Description => {
    const layerName = maybeGetReadableVolumeTracingName(tracing, firstAction.value.actionTracingId);
    return {
      description: `Updated the segment groups of layer ${layerName}.`,
      icon: <EditOutlined />,
    };
  },
  updateNode: (action: UpdateNodeUpdateAction): Description => ({
    description: `Updated the node with id ${action.value.id}.`,
    icon: <EditOutlined />,
  }),
  updateTreeVisibility: (action: UpdateTreeVisibilityUpdateAction): Description => ({
    description: `Updated the visibility of the tree with id ${action.value.treeId}.`,
    icon: <EyeOutlined />,
  }),
  updateTreeEdgesVisibility: (action: UpdateTreeEdgesVisibilityUpdateAction): Description => ({
    description: `Updated the visibility of the edges of the tree with id ${action.value.treeId}.`,
    icon: <img src="/assets/images/hide-skeleton-edges-icon.svg" alt="Hide Tree Edges Icon" />,
  }),
  updateTreeGroupVisibility: (action: UpdateTreeGroupVisibilityUpdateAction): Description => ({
    description: `Updated the visibility of the group with id ${
      action.value.treeGroupId != null ? action.value.treeGroupId : MISSING_GROUP_ID
    }.`,
    icon: <EyeOutlined />,
  }),
  createEdge: (action: CreateEdgeUpdateAction): Description => ({
    description: `Created the edge between node ${action.value.source} and node ${action.value.target}.`,
    icon: <PlusOutlined />,
  }),
  deleteEdge: (action: DeleteEdgeUpdateAction): Description => ({
    description: `Deleted the edge between node ${action.value.source} and node ${action.value.target}.`,
    icon: <DeleteOutlined />,
  }),
  updateTdCamera: (): Description => ({
    description: "Updated the 3D view.",
    icon: <CodeSandboxOutlined />,
  }),
  createSegment: (
    firstAction: UpdateActionWithTracingId & CreateSegmentUpdateAction,
    _actionCount: number,
    tracing: HybridTracing,
  ): Description => {
    const layerName = maybeGetReadableVolumeTracingName(tracing, firstAction.value.actionTracingId);
    return {
      description: `Added the segment with id ${firstAction.value.id} to the segments list of layer ${layerName}.`,
      icon: <PlusOutlined />,
    };
  },
  updateSegment: (
    firstAction: UpdateActionWithTracingId & UpdateSegmentUpdateAction,
    _actionCount: number,
    tracing: HybridTracing,
  ): Description => {
    const layerName = maybeGetReadableVolumeTracingName(tracing, firstAction.value.actionTracingId);
    return {
      description: `Updated the segment with id ${firstAction.value.id} in the segments list  of layer ${layerName}.`,
      icon: <EditOutlined />,
    };
  },
  deleteSegment: (
    firstAction: UpdateActionWithTracingId & DeleteSegmentUpdateAction,
    _actionCount: number,
    tracing: HybridTracing,
  ): Description => {
    const layerName = maybeGetReadableVolumeTracingName(tracing, firstAction.value.actionTracingId);
    return {
      description: `Deleted the segment with id ${firstAction.value.id} from the segments list of layer ${layerName}.`,
      icon: <DeleteOutlined />,
    };
  },
  deleteSegmentData: (
    firstAction: UpdateActionWithTracingId & DeleteSegmentDataUpdateAction,
    _actionCount: number,
    tracing: HybridTracing,
  ): Description => {
    const layerName = maybeGetReadableVolumeTracingName(tracing, firstAction.value.actionTracingId);
    return {
      description: `Deleted the data of segment ${firstAction.value.id} of layer ${layerName}. All voxels with that id were overwritten with 0.`,
      icon: <DeleteOutlined />,
    };
  },
  addSegmentIndex: (
    firstAction: UpdateActionWithTracingId,
    _actionCount: number,
    tracing: HybridTracing,
  ): Description => {
    const layerName = maybeGetReadableVolumeTracingName(tracing, firstAction.value.actionTracingId);
    return {
      description: `Added segment index to layer ${layerName} to enable segment statistics.`,
      icon: <EditOutlined />,
    };
  },
  // This should never be shown since currently this update action can only be triggered
  // by merging or splitting trees which is recognized separately, before this description
  // is accessed.
  moveTreeComponent: (action: MoveTreeComponentUpdateAction): Description => ({
    description: `Moved ${action.value.nodeIds.length} nodes from tree with id ${action.value.sourceId} to tree with id ${action.value.targetId}.`,
    icon: <EditOutlined />,
  }),
  // This should never be shown since currently this update action is never dispatched.
  mergeTree: (action: MergeTreeUpdateAction): Description => ({
    description: `Merged the trees with id ${action.value.sourceId} and ${action.value.targetId}.`,
    icon: <EditOutlined />,
  }),
  updateSkeletonTracing: (): Description => updateTracingDescription,
  updateVolumeTracing: (): Description => updateTracingDescription,
  addLayerToAnnotation: (action: AddLayerToAnnotationUpdateAction): Description => ({
    description: `Added the layer ${action.value.layerParameters.name} to the annotation.`,
    icon: <PlusOutlined />,
  }),
  deleteLayerFromAnnotation: (action: DeleteAnnotationLayerUpdateAction): Description => ({
    description: `Deleted the layer with id ${action.value.layerName} (${action.value.tracingId}) from the annotation.`,
    icon: <DeleteOutlined />,
  }),
  updateLayerMetadata: (action: UpdateAnnotationLayerNameUpdateAction): Description => ({
    description: `Updated the name of the layer with id ${action.value.tracingId} to ${action.value.layerName}.`,
    icon: <EditOutlined />,
  }),
  updateMetadataOfAnnotation: (action: UpdateMetadataOfAnnotationUpdateAction): Description => {
    return {
      description: `Updated the description of the annotation to: ${action.value.description.slice(0, 100) || ""}`,
      icon: <EditOutlined />,
    };
  },
} as const;

function maybeGetReadableVolumeTracingName(tracing: HybridTracing, tracingId: string): string {
  const volumeTracing = tracing.volumes.find((volume) => volume.tracingId === tracingId);
  return volumeTracing != null
    ? getReadableNameByVolumeTracingId(tracing, volumeTracing.tracingId)
    : "<unknown>";
}

function getDescriptionForSpecificBatch(
  actions: Array<ServerUpdateAction>,
  type: string,
  tracing: HybridTracing,
): Description {
  const firstAction = actions[0];

  if (firstAction.name !== type) {
    throw new Error("Type constraint violated");
  }
  const fn = descriptionFns[type];
  return fn(firstAction, actions.length, tracing);
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
  tracing: HybridTracing,
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
      return getDescriptionForSpecificBatch(updateActions, key, tracing);
    }
  }

  // Catch-all for other update actions, currently updateTracing.
  return updateTracingDescription;
}

type Props = {
  actions: Array<ServerUpdateAction>;
  allowUpdate: boolean;
  version: number;
  isNewest: boolean;
  isActive: boolean;
  isIndented: boolean;
  onRestoreVersion: (arg0: number) => Promise<void>;
  onPreviewVersion: (arg0: number) => Promise<void>;
};
export default function VersionEntry({
  actions,
  allowUpdate,
  version,
  isNewest,
  isActive,
  isIndented,
  onRestoreVersion,
  onPreviewVersion,
}: Props) {
  const lastTimestamp = _.max(actions.map((action) => action.value.actionTimestamp));
  const contributors = useSelector((state: OxalisState) => state.tracing.contributors);
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const owner = useSelector((state: OxalisState) => state.tracing.owner);
  const tracing = useSelector((state: OxalisState) => state.tracing);

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
      {allowUpdate ? "Restore" : "Download"}
    </Button>
  );
  const { description, icon } = getDescriptionForBatch(actions, tracing);

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
            {/* @ts-expect-error ts-migrate(2322) FIXME: Type 'number | undefined' is not assignable to typ... Remove this comment to see the full error message */}
            Version {version} (<FormattedDate timestamp={lastTimestamp} format="HH:mm" />)
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

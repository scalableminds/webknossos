// @flow
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
  UpdateTreeGroupVisibilityUpdateAction,
  CreateEdgeUpdateAction,
  DeleteEdgeUpdateAction,
} from "oxalis/model/sagas/update_actions";
import FormattedDate from "components/formatted_date";
import { MISSING_GROUP_ID } from "oxalis/view/right-menu/tree_hierarchy_view_helpers";

type Description = { description: string, icon: React.Node };

// The order in which the update actions are added to this object,
// determines the order in which update actions are checked
// to describe an update action batch. See also the comment
// of the `getDescriptionForBatch` function.
const descriptionFns = {
  importVolumeTracing: (): Description => ({
    description: "Imported a volume tracing.",
    icon: <PlusOutlined />,
  }),
  createTracing: (): Description => ({
    description: "Created the annotation.",
    icon: <RocketOutlined />,
  }),
  updateUserBoundingBoxes: (): Description => ({
    description: "Updated a user bounding box.",
    icon: <CodepenOutlined />,
  }),
  removeFallbackLayer: (): Description => ({
    description: "Removed the segmentation fallback layer.",
    icon: <DeleteOutlined />,
  }),
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
  updateBucket: (): Description => ({
    description: "Updated the segmentation.",
    icon: <PictureOutlined />,
  }),
  updateNode: (action: UpdateNodeUpdateAction): Description => ({
    description: `Updated the node with id ${action.value.id}.`,
    icon: <EditOutlined />,
  }),
  updateTreeVisibility: (action: UpdateTreeVisibilityUpdateAction): Description => ({
    description: `Updated the visibility of the tree with id ${action.value.treeId}.`,
    icon: <EyeOutlined />,
  }),
  updateTreeGroupVisibility: (action: UpdateTreeGroupVisibilityUpdateAction): Description => ({
    description: `Updated the visibility of the group with id ${
      action.value.treeGroupId != null ? action.value.treeGroupId : MISSING_GROUP_ID
    }.`,
    icon: <EyeOutlined />,
  }),
  createEdge: (action: CreateEdgeUpdateAction): Description => ({
    description: `Created the edge between node ${action.value.source} and node ${
      action.value.target
    }.`,
    icon: <PlusOutlined />,
  }),
  deleteEdge: (action: DeleteEdgeUpdateAction): Description => ({
    description: `Deleted the edge between node ${action.value.source} and node ${
      action.value.target
    }.`,
    icon: <DeleteOutlined />,
  }),
  updateTdCamera: (): Description => ({
    description: "Updated the 3D view.",
    icon: <CodeSandboxOutlined />,
  }),
};

function getDescriptionForSpecificBatch(
  actions: Array<ServerUpdateAction>,
  type: string,
): Description {
  const firstAction = actions[0];
  if (firstAction.name !== type) {
    throw new Error("Flow constraint violated");
  }
  return descriptionFns[type](firstAction, actions.length);
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
function getDescriptionForBatch(actions: Array<ServerUpdateAction>): Description {
  const groupedUpdateActions = _.groupBy(actions, "name");

  const moveTreeComponentUAs = groupedUpdateActions.moveTreeComponent;
  if (moveTreeComponentUAs != null) {
    const firstMoveTreeComponentUA = moveTreeComponentUAs[0];
    if (firstMoveTreeComponentUA.name !== "moveTreeComponent") {
      throw new Error("Flow constraint violated");
    }
    if (groupedUpdateActions.createTree != null) {
      return {
        description: `Split off a tree with ${
          firstMoveTreeComponentUA.value.nodeIds.length
        } nodes.`,
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
        description: `Added ${createTreeUAs.length} tree${pluralS} and ${
          createNodeUAs.length
        } nodes.`,
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
      return getDescriptionForSpecificBatch(updateActions, key);
    }
  }

  // Catch-all for other update actions, currently updateTracing.
  return {
    description: "Modified the annotation.",
    icon: <EditOutlined />,
  };
}

type Props = {
  actions: Array<ServerUpdateAction>,
  allowUpdate: boolean,
  version: number,
  isNewest: boolean,
  isActive: boolean,
  isIndented: boolean,
  onRestoreVersion: number => Promise<void>,
  onPreviewVersion: number => Promise<void>,
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
  const lastTimestamp = _.max(actions.map(action => action.value.actionTimestamp));
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
  const { description, icon } = getDescriptionForBatch(actions);
  return (
    <React.Fragment>
      <List.Item
        style={{ cursor: "pointer" }}
        className={liClassName}
        actions={isActive && !isNewest ? [restoreButton] : []}
      >
        <List.Item.Meta
          title={
            <React.Fragment>
              Version {version} (<FormattedDate timestamp={lastTimestamp} format="HH:mm" />)
            </React.Fragment>
          }
          onClick={() => onPreviewVersion(version)}
          avatar={<Avatar size="small" icon={icon} />}
          description={
            <React.Fragment>
              {isNewest ? (
                <React.Fragment>
                  <i>Newest version</i> <br />
                </React.Fragment>
              ) : null}
              {description}
            </React.Fragment>
          }
        />
      </List.Item>
    </React.Fragment>
  );
}

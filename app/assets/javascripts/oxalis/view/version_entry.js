// @flow
import _ from "lodash";
import * as React from "react";
import { Avatar, Button, List } from "antd";
import FormattedDate from "components/formatted_date";
import classNames from "classnames";
import type {
  ServerUpdateAction,
  CreateNodeUpdateAction,
  DeleteNodeUpdateAction,
  UpdateTreeUpdateAction,
  DeleteTreeUpdateAction,
  RevertToVersionUpdateAction,
} from "oxalis/model/sagas/update_actions";

type Description = { description: string, type: string };

const descriptionFns = {
  deleteTree: (action: DeleteTreeUpdateAction): Description => ({
    description: `Deleted the tree with id ${action.value.id}.`,
    type: "delete",
  }),
  deleteNode: (action: DeleteNodeUpdateAction): Description => ({
    description: `Deleted the node with id ${action.value.nodeId}.`,
    type: "delete",
  }),
  revertToVersion: (action: RevertToVersionUpdateAction): Description => ({
    description: `Reverted to version ${action.value.sourceVersion}.`,
    type: "backward",
  }),
  createNode: (action: CreateNodeUpdateAction): Description => ({
    description: `Created the node with id ${action.value.id}.`,
    type: "plus",
  }),
  createTree: (action: UpdateTreeUpdateAction): Description => ({
    description: `Created the tree with id ${action.value.id}.`,
    type: "plus",
  }),
  updateTreeGroups: (): Description => ({
    description: "Updated the tree groups.",
    type: "edit",
  }),
  updateTree: (action: UpdateTreeUpdateAction): Description => ({
    description: `Updated the tree with id ${action.value.id}.`,
    type: "edit",
  }),
  updateBucket: (): Description => ({
    description: "Updated the segmentation.",
    type: "picture",
  }),
  createTracing: (): Description => ({
    description: "Created the tracing.",
    type: "rocket",
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
  return descriptionFns[type](firstAction);
}

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
        type: "arrows-alt",
      };
    } else if (groupedUpdateActions.deleteTree != null) {
      return {
        description: `Merged a tree with ${firstMoveTreeComponentUA.value.nodeIds.length} nodes.`,
        type: "shrink",
      };
    }
  }

  const deleteTreeUAs = groupedUpdateActions.deleteTree;
  if (deleteTreeUAs != null) {
    return getDescriptionForSpecificBatch(deleteTreeUAs, "deleteTree");
  }

  const deleteNodeUAs = groupedUpdateActions.deleteNode;
  if (deleteNodeUAs != null) {
    return getDescriptionForSpecificBatch(deleteNodeUAs, "deleteNode");
  }

  const revertToVersionUAs = groupedUpdateActions.revertToVersion;
  if (revertToVersionUAs != null) {
    return getDescriptionForSpecificBatch(revertToVersionUAs, "revertToVersion");
  }

  const createNodeUAs = groupedUpdateActions.createNode;
  if (createNodeUAs != null) {
    return getDescriptionForSpecificBatch(createNodeUAs, "createNode");
  }

  const createTreeUAs = groupedUpdateActions.createTree;
  if (createTreeUAs != null) {
    return getDescriptionForSpecificBatch(createTreeUAs, "createTree");
  }

  const updateTreeGroupsUAs = groupedUpdateActions.updateTreeGroups;
  if (updateTreeGroupsUAs != null) {
    return getDescriptionForSpecificBatch(updateTreeGroupsUAs, "updateTreeGroups");
  }

  const updateTreeUAs = groupedUpdateActions.updateTree;
  if (updateTreeUAs != null) {
    return getDescriptionForSpecificBatch(updateTreeUAs, "updateTree");
  }

  const updateBucketUAs = groupedUpdateActions.updateBucket;
  if (updateBucketUAs != null) {
    return getDescriptionForSpecificBatch(updateBucketUAs, "updateBucket");
  }

  const createTracingUAs = groupedUpdateActions.createTracing;
  if (createTracingUAs != null) {
    return getDescriptionForSpecificBatch(createTracingUAs, "createTracing");
  }

  // Catch-all for other update actions, currently updateNode and updateTracing.
  return {
    description: "Modified the tracing.",
    type: "edit",
  };
}

type Props = {
  actions: Array<ServerUpdateAction>,
  version: number,
  isNewest: boolean,
  isActive: boolean,
  onRestoreVersion: number => Promise<void>,
  onPreviewVersion: number => Promise<void>,
};

export default function VersionEntry({
  actions,
  version,
  isNewest,
  isActive,
  onRestoreVersion,
  onPreviewVersion,
}: Props) {
  const lastTimestamp = _.max(actions.map(action => action.value.actionTimestamp));
  const liClassName = classNames("version-entry", {
    "active-version-entry": isActive,
  });
  const restoreButton = (
    <Button
      size="small"
      key="restore-button"
      type="primary"
      onClick={() => onRestoreVersion(version)}
    >
      Restore
    </Button>
  );
  const { description, type } = getDescriptionForBatch(actions);
  return (
    <React.Fragment>
      <List.Item className={liClassName} actions={isActive && !isNewest ? [restoreButton] : []}>
        <List.Item.Meta
          title={
            <React.Fragment>
              Version {version} (<FormattedDate timestamp={lastTimestamp} />)
            </React.Fragment>
          }
          onClick={() => onPreviewVersion(version)}
          avatar={<Avatar size="small" icon={type} />}
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

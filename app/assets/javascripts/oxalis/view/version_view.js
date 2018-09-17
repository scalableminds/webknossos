// @flow

import * as React from "react";
import _ from "lodash";
import { Spin, Button, List, Avatar, Alert } from "antd";
import { ControlModeEnum } from "oxalis/constants";
import { connect } from "react-redux";
import Model from "oxalis/model";
import { getUpdateActionLog } from "admin/admin_rest_api";
import Store from "oxalis/store";
import { handleGenericError } from "libs/error_handling";
import FormattedDate from "components/formatted_date";
import api from "oxalis/api/internal_api";
import classNames from "classnames";
import { setVersionRestoreVisibilityAction } from "oxalis/model/actions/ui_actions";
import { setAnnotationAllowUpdateAction } from "oxalis/model/actions/annotation_actions";
import { revertToVersion } from "oxalis/model/sagas/update_actions";
import { pushSaveQueueAction, setVersionNumberAction } from "oxalis/model/actions/save_actions";
import { enforceSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import type { OxalisState, SkeletonTracingType } from "oxalis/store";
import type {
  ServerUpdateAction,
  CreateNodeUpdateAction,
  DeleteNodeUpdateAction,
  UpdateTreeUpdateAction,
  DeleteTreeUpdateAction,
  RevertToVersionUpdateAction,
} from "oxalis/model/sagas/update_actions";
import type { APIUpdateActionBatch } from "admin/api_flow_types";

type DescriptionType = { description: string, type: string };

type Props = {
  skeletonTracing: SkeletonTracingType,
};

type State = {
  isLoading: boolean,
  versions: Array<APIUpdateActionBatch>,
};

const descriptionFns = {
  deleteTree: (action: DeleteTreeUpdateAction): DescriptionType => ({
    description: `Deleted the tree with id ${action.value.id}.`,
    type: "delete",
  }),
  deleteNode: (action: DeleteNodeUpdateAction): DescriptionType => ({
    description: `Deleted the node with id ${action.value.nodeId}.`,
    type: "delete",
  }),
  revertToVersion: (action: RevertToVersionUpdateAction): DescriptionType => ({
    description: `Reverted to version ${action.value.sourceVersion}.`,
    type: "backward",
  }),
  createNode: (action: CreateNodeUpdateAction): DescriptionType => ({
    description: `Created the node with id ${action.value.id}.`,
    type: "plus",
  }),
  createTree: (action: UpdateTreeUpdateAction): DescriptionType => ({
    description: `Created the tree with id ${action.value.id}.`,
    type: "plus",
  }),
  updateTreeGroups: (): DescriptionType => ({
    description: "Updated the tree groups.",
    type: "edit",
  }),
  updateTree: (action: UpdateTreeUpdateAction): DescriptionType => ({
    description: `Updated the tree with id ${action.value.id}.`,
    type: "edit",
  }),
};

class VersionView extends React.Component<Props, State> {
  state = {
    isLoading: false,
    versions: [],
  };

  componentDidMount() {
    Store.dispatch(setAnnotationAllowUpdateAction(false));
    this.fetchData(this.props.skeletonTracing.tracingId);
  }

  async fetchData(tracingId: string) {
    const { url: dataStoreUrl } = Store.getState().dataset.dataStore;
    this.setState({ isLoading: true });
    try {
      const updateActionLog = await getUpdateActionLog(dataStoreUrl, tracingId, "skeleton");
      this.setState({ versions: updateActionLog });
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoading: false });
    }
  }

  getNewestVersion(): number {
    return _.max(this.state.versions.map(batch => batch.version)) || 0;
  }

  getDescriptionForSpecificBatch(
    actions: Array<ServerUpdateAction>,
    type: string,
  ): DescriptionType {
    const firstAction = actions[0];
    if (firstAction.name !== type) {
      throw new Error("Flow constraint violated");
    }
    return descriptionFns[type](firstAction);
  }

  getDescriptionForBatch(actions: Array<ServerUpdateAction>): DescriptionType {
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
      return this.getDescriptionForSpecificBatch(deleteTreeUAs, "deleteTree");
    }

    const deleteNodeUAs = groupedUpdateActions.deleteNode;
    if (deleteNodeUAs != null) {
      return this.getDescriptionForSpecificBatch(deleteNodeUAs, "deleteNode");
    }

    const revertToVersionUAs = groupedUpdateActions.revertToVersion;
    if (revertToVersionUAs != null) {
      return this.getDescriptionForSpecificBatch(revertToVersionUAs, "revertToVersion");
    }

    const createNodeUAs = groupedUpdateActions.createNode;
    if (createNodeUAs != null) {
      return this.getDescriptionForSpecificBatch(createNodeUAs, "createNode");
    }

    const createTreeUAs = groupedUpdateActions.createTree;
    if (createTreeUAs != null) {
      return this.getDescriptionForSpecificBatch(createTreeUAs, "createTree");
    }

    const updateTreeGroupsUAs = groupedUpdateActions.updateTreeGroups;
    if (updateTreeGroupsUAs != null) {
      return this.getDescriptionForSpecificBatch(updateTreeGroupsUAs, "updateTreeGroups");
    }

    const updateTreeUAs = groupedUpdateActions.updateTree;
    if (updateTreeUAs != null) {
      return this.getDescriptionForSpecificBatch(updateTreeUAs, "updateTree");
    }

    // Catch-all for other update actions, currently updateNode and updateTracing.
    return {
      description: "Modified the tracing.",
      type: "edit",
    };
  }

  async previewVersion(version: number) {
    const { tracingType, annotationId } = Store.getState().tracing;
    await api.tracing.restart(tracingType, annotationId, ControlModeEnum.TRACE, version);
    Store.dispatch(setAnnotationAllowUpdateAction(false));
  }

  async restoreVersion(version: number) {
    Store.dispatch(setVersionNumberAction(this.getNewestVersion(), "skeleton"));
    Store.dispatch(pushSaveQueueAction([revertToVersion(version)], "skeleton"));
    await Model.save();
    Store.dispatch(setVersionRestoreVisibilityAction(false));
    Store.dispatch(setAnnotationAllowUpdateAction(true));
  }

  handleClose = async () => {
    await this.previewVersion(this.getNewestVersion());
    Store.dispatch(setVersionRestoreVisibilityAction(false));
    Store.dispatch(setAnnotationAllowUpdateAction(true));
  };

  render() {
    const VersionEntry = ({ actions, version, isNewest }) => {
      const lastTimestamp = _.max(actions.map(action => action.value.actionTimestamp));
      const isActiveVersion = this.props.skeletonTracing.version === version;
      const liClassName = classNames("version-entry", {
        "active-version-entry": isActiveVersion,
      });
      const restoreButton = (
        <Button
          size="small"
          key="restore-button"
          type="primary"
          onClick={() => this.restoreVersion(version)}
        >
          Restore
        </Button>
      );
      const { description, type } = this.getDescriptionForBatch(actions);
      return (
        <React.Fragment>
          <List.Item
            className={liClassName}
            actions={isActiveVersion && !isNewest ? [restoreButton] : []}
          >
            <List.Item.Meta
              title={
                <React.Fragment>
                  Version {version} (<FormattedDate timestamp={lastTimestamp} />)
                </React.Fragment>
              }
              onClick={() => this.previewVersion(version)}
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
    };

    const filteredVersions = this.state.versions.filter(
      (batch, index) =>
        index === 0 || batch.value.length > 1 || batch.value[0].name !== "updateTracing",
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ flex: "0 1 auto" }}>
          <h4 style={{ display: "inline-block" }}>Version History</h4>
          <Button
            className="close-button"
            style={{ float: "right", border: 0 }}
            onClick={this.handleClose}
            shape="circle"
            icon="close"
          />
          <div style={{ fontSize: 12, marginBottom: 8, color: "rgba(0, 0, 0, 0.65)" }}>
            <Alert
              type="info"
              message={
                <React.Fragment>
                  You are currently previewing older versions of this tracing. Either restore a
                  version by selecting it or close this view to continue tracing. The shown tracing
                  is in <b>read-only</b> mode as long as this view is opened.
                </React.Fragment>
              }
            />
          </div>
        </div>
        <div style={{ flex: "1 1 auto", overflowY: "auto" }}>
          <Spin spinning={this.state.isLoading}>
            <List>
              {filteredVersions.map((batch, index) => (
                <VersionEntry
                  actions={batch.value}
                  version={batch.version}
                  isNewest={index === 0}
                  key={batch.version}
                />
              ))}
            </List>
          </Spin>
        </div>
      </div>
    );
  }
}

function mapStateToProps(state: OxalisState): Props {
  return {
    skeletonTracing: enforceSkeletonTracing(state.tracing),
  };
}

export default connect(mapStateToProps)(VersionView);

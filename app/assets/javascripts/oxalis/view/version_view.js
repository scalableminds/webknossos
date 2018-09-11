// @flow

import * as React from "react";
import _ from "lodash";
import { Spin, Button, List, Tooltip, Icon, Avatar } from "antd";
import { ControlModeEnum } from "oxalis/constants";
import { connect } from "react-redux";
import Model from "oxalis/model";
import { getUpdateActionLog } from "admin/admin_rest_api";
import Store from "oxalis/store";
import { handleGenericError } from "libs/error_handling";
import FormattedDate from "components/formatted_date";
import api from "oxalis/api/internal_api";
import classNames from "classnames";
import { setVersionRestoreModeAction } from "oxalis/model/actions/ui_actions";
import { setAnnotationAllowUpdateAction } from "oxalis/model/actions/annotation_actions";
import { revertToVersion } from "oxalis/model/sagas/update_actions";
import { pushSaveQueueAction, setVersionNumberAction } from "oxalis/model/actions/save_actions";
import { enforceSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import type { OxalisState, SkeletonTracingType } from "oxalis/store";
import type { ServerUpdateAction } from "oxalis/model/sagas/update_actions";

type Props = {
  skeletonTracing: SkeletonTracingType,
};

type State = {
  isLoading: boolean,
  versions: Array<Array<ServerUpdateAction>>,
  originalVersion: number,
};

class VersionView extends React.Component<Props, State> {
  state = {
    isLoading: false,
    versions: [],
    originalVersion: this.props.skeletonTracing.version,
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

  getDescriptionForBatch(batch: Array<ServerUpdateAction>): { description: string, type: string } {
    const groupedUpdateActions = _.groupBy(batch, "name");

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
    const firstDeleteTreeUA = deleteTreeUAs[0];
    if (firstDeleteTreeUA.name !== "deleteTree") {
        throw new Error("Flow constraint violated");
      }
    if (deleteTreeUAs != null) {
      return {
        description: `Deleted the tree with id ${firstDeleteTreeUA.value.id}.`,
        type: "delete",
      };
    }

    const deleteNodeUAs = groupedUpdateActions.deleteNode;
    const firstDeleteNodeUA = deleteNodeUAs[0];
    if (firstDeleteNodeUA.name !== "deleteNode") {
      throw new Error("Flow constraint violated");
    }
    if (deleteNodeUAs != null) {
      return {
        description: `Deleted the node with id ${firstDeleteNodeUA.value.nodeId}.`,
        type: "delete",
      };
    }

    const revertToVersionUAs = groupedUpdateActions.revertToVersion;
    const firstRevertToVersionUA = revertToVersionUAs[0];
    if (firstRevertToVersionUA.name !== "revertToVersion") {
      throw new Error("Flow constraint violated");
    }
    if (revertToVersionUAs != null) {
      return {
        description: `Reverted to version ${firstRevertToVersionUA.value.sourceVersion}.`,
        type: "backward",
      };
    }
    return {
      description: `${batch[0].name} and ${batch.length - 1} other entries.`,
      type: "plus-circle",
    };
  }

  async previewVersion(version: number) {
    const { tracingType, annotationId } = Store.getState().tracing;
    await api.tracing.restart(tracingType, annotationId, ControlModeEnum.TRACE, version);
    Store.dispatch(setAnnotationAllowUpdateAction(false));
  }

  async restoreVersion(version: number) {
    Store.dispatch(setVersionNumberAction(this.state.originalVersion, "skeleton"));
    Store.dispatch(pushSaveQueueAction([revertToVersion(version)], "skeleton"));
    await Model.save();
    Store.dispatch(setVersionRestoreModeAction(false));
    Store.dispatch(setAnnotationAllowUpdateAction(true));
  }

  handleClose = async () => {
    await this.previewVersion(this.state.originalVersion);
    Store.dispatch(setVersionRestoreModeAction(false));
    Store.dispatch(setAnnotationAllowUpdateAction(true));
  };

  render() {
    const VersionEntry = ({ batch, version, isNewest }) => {
      const lastTimestamp = Math.max(...batch.map(entry => entry.value.actionTimestamp));
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
          Restore this version
        </Button>
      );
      const { description, type } = this.getDescriptionForBatch(batch);
      return (
        <React.Fragment>
          <List.Item
            className={liClassName}
            actions={isActiveVersion && !isNewest ? [restoreButton] : []}
          >
            <List.Item.Meta
              title={<FormattedDate timestamp={lastTimestamp} />}
              onClick={() => this.previewVersion(version)}
              avatar={<Avatar icon={type} />}
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

    // TODO: server should send version numbers as part of the batches
    const versionsWithVersionNumbers = this.state.versions.map((batch, index) => {
      batch.forEach(action => {
        action.value.version = this.state.versions.length - index;
      });
      return batch;
    });
    const filteredVersions = versionsWithVersionNumbers.filter(
      (batch, index) => index === 0 || batch.length > 1 || batch[0].name !== "updateTracing",
    );

    return (
      <React.Fragment>
        <Tooltip
          title="You are currently previewing older versions of this tracing. Either restore a version by selecting it or abort the preview to continue tracing."
          placement="bottom"
        >
          <h3 style={{ display: "inline-block" }}>
            Version History <Icon style={{ color: "orange" }} type="exclamation-circle" />
          </h3>
        </Tooltip>
        <Button
          className="close-button"
          style={{ float: "right" }}
          onClick={this.handleClose}
          shape="circle"
          icon="close"
        />
        <Spin spinning={this.state.isLoading}>
          <List>
            {filteredVersions.map((batch, index) => (
              <VersionEntry
                batch={batch}
                version={batch[0].value.version}
                isNewest={index === 0}
                key={batch[0].value.version}
              />
            ))}
          </List>
        </Spin>
      </React.Fragment>
    );
  }
}

function mapStateToProps(state: OxalisState): Props {
  return {
    skeletonTracing: enforceSkeletonTracing(state.tracing),
  };
}

export default connect(mapStateToProps)(VersionView);

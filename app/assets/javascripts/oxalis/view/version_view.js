// @flow

import * as React from "react";
import { Spin, Button, List, Tooltip, Icon } from "antd";
import { ControlModeEnum } from "oxalis/constants";
import type { OxalisState, SkeletonTracingType } from "oxalis/store";
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

type Props = {
  skeletonTracing: SkeletonTracingType,
};

type State = {
  isLoading: boolean,
  versions: Array<Array<Object>>,
  originalVersion: number,
};

class VersionView extends React.Component<Props, State> {
  state = {
    isLoading: false,
    versions: [],
    originalVersion: this.props.skeletonTracing.version,
  };

  componentDidMount() {
    const { tracingId } = this.props.skeletonTracing;
    if (tracingId != null) {
      this.fetchData(tracingId);
      Store.dispatch(setAnnotationAllowUpdateAction(false));
    }
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
      return (
        <React.Fragment>
          <List.Item
            className={liClassName}
            actions={isActiveVersion && !isNewest ? [restoreButton] : []}
          >
            <List.Item.Meta
              title={<FormattedDate timestamp={lastTimestamp} />}
              onClick={() => this.previewVersion(version)}
              description={
                <React.Fragment>
                  {isNewest ? (
                    <React.Fragment>
                      <i>Newest version</i> <br />
                    </React.Fragment>
                  ) : null}
                  {batch[0].name} and {batch.length - 1} other entries.
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
        action.version = this.state.versions.length - index;
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
                version={batch[0].version}
                isNewest={index === 0}
                key={batch[0].version}
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

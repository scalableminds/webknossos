// @flow
import * as React from "react";
import _ from "lodash";
import { List } from "antd";
import Store from "oxalis/store";
import { ControlModeEnum } from "oxalis/constants";
import Model from "oxalis/model";
import api from "oxalis/api/internal_api";
import { getUpdateActionLog } from "admin/admin_rest_api";
import { setAnnotationAllowUpdateAction } from "oxalis/model/actions/annotation_actions";
import { setVersionRestoreVisibilityAction } from "oxalis/model/actions/ui_actions";
import { handleGenericError } from "libs/error_handling";
import { revertToVersion, serverCreateTracing } from "oxalis/model/sagas/update_actions";
import { pushSaveQueueAction, setVersionNumberAction } from "oxalis/model/actions/save_actions";
import VersionEntry from "oxalis/view/version_entry";
import type { APIUpdateActionBatch } from "admin/api_flow_types";
import type { SkeletonTracing, VolumeTracing } from "oxalis/store";
import type { Versions } from "oxalis/view/version_view";

type Props = {
  tracingType: "skeleton" | "volume",
  tracing: SkeletonTracing | VolumeTracing,
};

type State = {
  isLoading: boolean,
  versions: Array<APIUpdateActionBatch>,
};

const VERSION_LIST_PLACEHOLDER = { emptyText: "No versions created yet." };

export async function previewVersion(versions?: Versions) {
  const { tracingType, annotationId } = Store.getState().tracing;
  await api.tracing.restart(tracingType, annotationId, ControlModeEnum.TRACE, versions);
  Store.dispatch(setAnnotationAllowUpdateAction(false));
  if (versions != null && versions.volume != null) {
    Model.getSegmentationLayer().cube.collectAllBuckets();
    Model.getSegmentationLayer().layerRenderingManager.refresh();
  }
}

class VersionList extends React.Component<Props, State> {
  state = {
    isLoading: false,
    versions: [],
  };

  componentDidMount() {
    Store.dispatch(setAnnotationAllowUpdateAction(false));
    this.fetchData(this.props.tracing.tracingId);
  }

  async fetchData(tracingId: string) {
    const { url: dataStoreUrl } = Store.getState().dataset.dataStore;
    this.setState({ isLoading: true });
    try {
      const updateActionLog = await getUpdateActionLog(
        dataStoreUrl,
        tracingId,
        this.props.tracingType,
      );
      // Insert version 0
      updateActionLog.push({
        version: 0,
        value: [serverCreateTracing(this.props.tracing.createdTimestamp)],
      });
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

  restoreVersion = async (version: number) => {
    Store.dispatch(setVersionNumberAction(this.getNewestVersion(), this.props.tracingType));
    Store.dispatch(pushSaveQueueAction([revertToVersion(version)], this.props.tracingType));
    await Model.save();
    Store.dispatch(setVersionRestoreVisibilityAction(false));
    Store.dispatch(setAnnotationAllowUpdateAction(true));
  };

  render() {
    return (
      <List
        dataSource={this.state.versions}
        loading={this.state.isLoading}
        locale={VERSION_LIST_PLACEHOLDER}
        renderItem={(batch, index) => (
          <VersionEntry
            actions={batch.value}
            version={batch.version}
            isNewest={index === 0}
            isActive={this.props.tracing.version === batch.version}
            onRestoreVersion={this.restoreVersion}
            onPreviewVersion={version => previewVersion({ [this.props.tracingType]: version })}
            key={batch.version}
          />
        )}
      />
    );
  }
}

export default VersionList;

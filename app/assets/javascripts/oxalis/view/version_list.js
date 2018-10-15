// @flow
import * as React from "react";
import _ from "lodash";
import moment from "moment";
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
import VersionEntryGroup from "oxalis/view/version_entry_group";
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

// The string key is a date string
// The value is an array of chunked APIUpdateActionBatches
type GroupedAndChunkedVersions = { [string]: Array<Array<APIUpdateActionBatch>> };

const MOMENT_CALENDAR_FORMAT = {
  sameDay: "[Today]",
  nextDay: "[Tomorrow]",
  nextWeek: "dddd",
  lastDay: "[Yesterday]",
  lastWeek: "[Last] dddd (YYYY-MM-DD)",
  sameElse: "YYYY-MM-DD",
};

const VERSION_LIST_PLACEHOLDER = { emptyText: "No versions created yet." };

export async function previewVersion(versions?: Versions) {
  const { tracingType, annotationId } = Store.getState().tracing;
  await api.tracing.restart(tracingType, annotationId, ControlModeEnum.TRACE, versions);
  Store.dispatch(setAnnotationAllowUpdateAction(false));

  const segmentationLayer = Model.getSegmentationLayer();
  const shouldPreviewVolumeVersion = versions != null && versions.volume != null;
  const shouldPreviewNewestVersion = versions == null;
  if (segmentationLayer != null && (shouldPreviewVolumeVersion || shouldPreviewNewestVersion)) {
    segmentationLayer.cube.collectAllBuckets();
    segmentationLayer.layerRenderingManager.refresh();
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

  previewVersion = (version: number) => previewVersion({ [this.props.tracingType]: version });

  getGroupedAndChunkedVersions = _.memoize(
    (): GroupedAndChunkedVersions => {
      // This function first groups the versions by day, where the key is the output of the moment calendar function.
      // Then, the versions for each day are chunked into x-minute intervals,
      // so that the actions of one chunk are all from within one x-minute interval.
      const groupedVersions = _.groupBy(this.state.versions, batch =>
        moment
          .utc(_.max(batch.value.map(action => action.value.actionTimestamp)))
          .calendar(null, MOMENT_CALENDAR_FORMAT),
      );

      const CHUNK_BY_X_MINUTES = 5;
      return _.mapValues(groupedVersions, versions => {
        let chunkIndex = 0;
        let chunkTime = 0;
        return _.reduce(
          versions,
          (
            chunkedVersions: Array<Array<APIUpdateActionBatch>>,
            batch: APIUpdateActionBatch,
            index: number,
          ) => {
            const batchTime = _.max(batch.value.map(action => action.value.actionTimestamp));
            if (index === 0) chunkTime = batchTime;
            if (chunkTime - batchTime > CHUNK_BY_X_MINUTES * 60 * 1000) {
              chunkIndex++;
              chunkTime = batchTime;
            }
            if (chunkedVersions[chunkIndex] == null) chunkedVersions.push([]);
            chunkedVersions[chunkIndex].push(batch);
            return chunkedVersions;
          },
          [],
        );
      });
    },
  );

  render() {
    const groupedAndChunkedVersions = this.getGroupedAndChunkedVersions();
    const batchesAndDateStrings = _.flattenDepth(Object.entries(groupedAndChunkedVersions), 2);

    return (
      <List
        dataSource={batchesAndDateStrings}
        loading={this.state.isLoading}
        locale={VERSION_LIST_PLACEHOLDER}
        renderItem={batchesOrDateString =>
          _.isString(batchesOrDateString) ? (
            <List.Item style={{ fontWeight: "bold", backgroundColor: "#f5f5f5" }}>
              <div style={{ margin: "auto" }}>{batchesOrDateString}</div>
            </List.Item>
          ) : (
            <VersionEntryGroup
              batches={batchesOrDateString}
              newestVersion={this.state.versions[0].version}
              activeVersion={this.props.tracing.version}
              onRestoreVersion={this.restoreVersion}
              onPreviewVersion={this.previewVersion}
              key={batchesOrDateString[0].version}
            />
          )
        }
      />
    );
  }
}

export default VersionList;

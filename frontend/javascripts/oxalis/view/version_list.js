// @flow
import { List } from "antd";
import * as React from "react";
import _ from "lodash";
import moment from "moment";

import type { APIUpdateActionBatch } from "admin/api_flow_types";
import { ControlModeEnum } from "oxalis/constants";
import type { Versions } from "oxalis/view/version_view";
import { chunkIntoTimeWindows } from "libs/utils";
import { getUpdateActionLog, downloadNml } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import {
  pushSaveQueueTransaction,
  setVersionNumberAction,
} from "oxalis/model/actions/save_actions";
import { revertToVersion, serverCreateTracing } from "oxalis/model/sagas/update_actions";
import { setAnnotationAllowUpdateAction } from "oxalis/model/actions/annotation_actions";
import { setVersionRestoreVisibilityAction } from "oxalis/model/actions/ui_actions";
import Model from "oxalis/model";
import Store, { type SkeletonTracing, type VolumeTracing } from "oxalis/store";
import VersionEntryGroup from "oxalis/view/version_entry_group";
import api from "oxalis/api/internal_api";

type Props = {
  tracingType: "skeleton" | "volume",
  tracing: SkeletonTracing | VolumeTracing,
  allowUpdate: boolean,
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
  const { annotationType, annotationId } = Store.getState().tracing;
  await api.tracing.restart(annotationType, annotationId, ControlModeEnum.TRACE, versions);
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
    const { url: tracingStoreUrl } = Store.getState().tracing.tracingStore;
    this.setState({ isLoading: true });
    try {
      const updateActionLog = await getUpdateActionLog(
        tracingStoreUrl,
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

  handleRestoreVersion = async (version: number) => {
    if (this.props.allowUpdate) {
      Store.dispatch(setVersionNumberAction(this.getNewestVersion(), this.props.tracingType));
      Store.dispatch(pushSaveQueueTransaction([revertToVersion(version)], this.props.tracingType));
      await Model.ensureSavedState();
      Store.dispatch(setVersionRestoreVisibilityAction(false));
      Store.dispatch(setAnnotationAllowUpdateAction(true));
    } else {
      const { annotationType, annotationId, volume } = Store.getState().tracing;
      const includesVolumeData = volume != null;
      downloadNml(annotationId, annotationType, includesVolumeData, {
        // $FlowIssue[invalid-computed-prop] See https://github.com/facebook/flow/issues/8299
        [this.props.tracingType]: version,
      });
    }
  };

  // $FlowIssue[invalid-computed-prop] See https://github.com/facebook/flow/issues/8299
  handlePreviewVersion = (version: number) => previewVersion({ [this.props.tracingType]: version });

  // eslint-disable-next-line react/sort-comp
  getGroupedAndChunkedVersions = _.memoize(
    (versions: Array<APIUpdateActionBatch>): GroupedAndChunkedVersions => {
      // This function first groups the versions by day, where the key is the output of the moment calendar function.
      // Then, the versions for each day are chunked into x-minute intervals,
      // so that the actions of one chunk are all from within one x-minute interval.
      const groupedVersions = _.groupBy(versions, batch =>
        moment
          .utc(_.max(batch.value.map(action => action.value.actionTimestamp)))
          .calendar(null, MOMENT_CALENDAR_FORMAT),
      );

      const getBatchTime = batch => _.max(batch.value.map(action => action.value.actionTimestamp));
      return _.mapValues(groupedVersions, versionsOfOneDay =>
        chunkIntoTimeWindows(versionsOfOneDay, getBatchTime, 5),
      );
    },
  );

  render() {
    const groupedAndChunkedVersions = this.getGroupedAndChunkedVersions(this.state.versions);
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
              allowUpdate={this.props.allowUpdate}
              newestVersion={this.state.versions[0].version}
              activeVersion={this.props.tracing.version}
              onRestoreVersion={this.handleRestoreVersion}
              onPreviewVersion={this.handlePreviewVersion}
              key={batchesOrDateString[0].version}
            />
          )
        }
      />
    );
  }
}

export default VersionList;

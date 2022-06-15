import { List } from "antd";
import * as React from "react";
import _ from "lodash";
import moment from "moment";
import type { APIUpdateActionBatch } from "types/api_flow_types";
import type { Versions } from "oxalis/view/version_view";
import { chunkIntoTimeWindows } from "libs/utils";
import { getUpdateActionLog, downloadAnnotation } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import {
  pushSaveQueueTransaction,
  setVersionNumberAction,
} from "oxalis/model/actions/save_actions";
import { revertToVersion, serverCreateTracing } from "oxalis/model/sagas/update_actions";
import { setAnnotationAllowUpdateAction } from "oxalis/model/actions/annotation_actions";
import { setVersionRestoreVisibilityAction } from "oxalis/model/actions/ui_actions";
import Model from "oxalis/model";
import type { SkeletonTracing, VolumeTracing } from "oxalis/store";
import Store from "oxalis/store";
import VersionEntryGroup from "oxalis/view/version_entry_group";
import api from "oxalis/api/internal_api";
type Props = {
  tracingType: "skeleton" | "volume";
  tracing: SkeletonTracing | VolumeTracing;
  allowUpdate: boolean;
};
type State = {
  isLoading: boolean;
  versions: Array<APIUpdateActionBatch>;
};
// The string key is a date string
// The value is an array of chunked APIUpdateActionBatches
type GroupedAndChunkedVersions = Record<string, Array<Array<APIUpdateActionBatch>>>;
const MOMENT_CALENDAR_FORMAT = {
  sameDay: "[Today]",
  nextDay: "[Tomorrow]",
  nextWeek: "dddd",
  lastDay: "[Yesterday]",
  lastWeek: "[Last] dddd (YYYY-MM-DD)",
  sameElse: "YYYY-MM-DD",
};
const VERSION_LIST_PLACEHOLDER = {
  emptyText: "No versions created yet.",
};
export async function previewVersion(versions?: Versions) {
  const state = Store.getState();
  const { controlMode } = state.temporaryConfiguration;
  const { annotationId } = state.tracing;
  await api.tracing.restart(null, annotationId, controlMode, versions);
  Store.dispatch(setAnnotationAllowUpdateAction(false));
  const segmentationLayersToReload = [];

  if (versions == null) {
    // No versions were passed which means that the newest annotation should be
    // shown. Therefore, reload all segmentation layers.
    segmentationLayersToReload.push(...Model.getSegmentationTracingLayers());
  } else if (versions.volumes != null) {
    // Since volume versions were specified, reload the volumeTracing layers
    const versionedSegmentationLayers = Object.keys(versions.volumes).map((volumeTracingId) =>
      Model.getSegmentationTracingLayer(volumeTracingId),
    );
    segmentationLayersToReload.push(...versionedSegmentationLayers);
  }

  for (const segmentationLayer of segmentationLayersToReload) {
    segmentationLayer.cube.collectAllBuckets();
    segmentationLayer.layerRenderingManager.refresh();
  }
}

class VersionList extends React.Component<Props, State> {
  state: State = {
    isLoading: false,
    versions: [],
  };

  componentDidMount() {
    Store.dispatch(setAnnotationAllowUpdateAction(false));
    this.fetchData(this.props.tracing.tracingId);
  }

  async fetchData(tracingId: string) {
    const { url: tracingStoreUrl } = Store.getState().tracing.tracingStore;
    this.setState({
      isLoading: true,
    });

    try {
      const updateActionLog = await getUpdateActionLog(
        tracingStoreUrl,
        tracingId,
        this.props.tracingType,
      );
      // Insert version 0
      updateActionLog.push({
        version: 0,
        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ name: string; value: { actionTimestamp: nu... Remove this comment to see the full error message
        value: [serverCreateTracing(this.props.tracing.createdTimestamp)],
      });
      this.setState({
        versions: updateActionLog,
      });
    } catch (error) {
      handleGenericError(error as Error);
    } finally {
      this.setState({
        isLoading: false,
      });
    }
  }

  getNewestVersion(): number {
    return _.max(this.state.versions.map((batch) => batch.version)) || 0;
  }

  handleRestoreVersion = async (version: number) => {
    if (this.props.allowUpdate) {
      Store.dispatch(
        setVersionNumberAction(
          this.getNewestVersion(),
          this.props.tracingType,
          this.props.tracing.tracingId,
        ),
      );
      Store.dispatch(
        pushSaveQueueTransaction(
          [revertToVersion(version)],
          this.props.tracingType,
          this.props.tracing.tracingId,
        ),
      );
      await Model.ensureSavedState();
      Store.dispatch(setVersionRestoreVisibilityAction(false));
      Store.dispatch(setAnnotationAllowUpdateAction(true));
    } else {
      const { annotationType, annotationId, volumes } = Store.getState().tracing;
      const includesVolumeFallbackData = volumes.some((volume) => volume.fallbackLayer != null);
      downloadAnnotation(annotationId, annotationType, includesVolumeFallbackData, {
        [this.props.tracingType]: version,
      });
    }
  };

  handlePreviewVersion = (version: number) => {
    if (this.props.tracingType === "skeleton") {
      return previewVersion({
        skeleton: version,
      });
    } else {
      return previewVersion({
        volumes: {
          [this.props.tracing.tracingId]: version,
        },
      });
    }
  };

  // eslint-disable-next-line react/sort-comp
  getGroupedAndChunkedVersions = _.memoize(
    (versions: Array<APIUpdateActionBatch>): GroupedAndChunkedVersions => {
      // This function first groups the versions by day, where the key is the output of the moment calendar function.
      // Then, the versions for each day are chunked into x-minute intervals,
      // so that the actions of one chunk are all from within one x-minute interval.
      const groupedVersions = _.groupBy(versions, (batch) =>
        moment
          .utc(_.max(batch.value.map((action) => action.value.actionTimestamp)))
          .calendar(null, MOMENT_CALENDAR_FORMAT),
      );

      // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'batch' implicitly has an 'any' type.
      const getBatchTime = (batch) =>
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'action' implicitly has an 'any' type.
        _.max(batch.value.map((action) => action.value.actionTimestamp));

      return _.mapValues(groupedVersions, (versionsOfOneDay) =>
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '(batch: any) => unknown' is not ... Remove this comment to see the full error message
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
        renderItem={(batchesOrDateString) =>
          _.isString(batchesOrDateString) ? (
            <List.Item className="version-section">
              <div
                style={{
                  margin: "auto",
                }}
              >
                {batchesOrDateString}
              </div>
            </List.Item>
          ) : (
            <VersionEntryGroup
              // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
              batches={batchesOrDateString}
              allowUpdate={this.props.allowUpdate}
              newestVersion={this.state.versions[0].version}
              activeVersion={this.props.tracing.version}
              onRestoreVersion={this.handleRestoreVersion}
              onPreviewVersion={this.handlePreviewVersion}
              // @ts-expect-error ts-migrate(2339) FIXME: Property 'version' does not exist on type 'APIUpda... Remove this comment to see the full error message
              key={batchesOrDateString[0].version}
            />
          )
        }
      />
    );
  }
}

export default VersionList;

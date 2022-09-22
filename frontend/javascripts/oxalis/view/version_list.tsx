import { List } from "antd";
import React, { useState, useEffect } from "react";
import _ from "lodash";
import moment from "moment";
import type { APIUpdateActionBatch } from "types/api_flow_types";
import type { Versions } from "oxalis/view/version_view";
import { chunkIntoTimeWindows } from "libs/utils";
import { getUpdateActionLog, downloadAnnotation } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import {
  pushSaveQueueTransaction,
  SaveQueueType,
  setVersionNumberAction,
} from "oxalis/model/actions/save_actions";
import {
  revertToVersion,
  serverCreateTracing,
  type ServerUpdateAction,
} from "oxalis/model/sagas/update_actions";
import { setAnnotationAllowUpdateAction } from "oxalis/model/actions/annotation_actions";
import { setVersionRestoreVisibilityAction } from "oxalis/model/actions/ui_actions";
import Model from "oxalis/model";
import type { EditableMapping, SkeletonTracing, VolumeTracing } from "oxalis/store";
import Store from "oxalis/store";
import VersionEntryGroup from "oxalis/view/version_entry_group";
import api from "oxalis/api/internal_api";
import Toast from "libs/toast";

type Props = {
  versionedObjectType: SaveQueueType;
  tracing: SkeletonTracing | VolumeTracing | EditableMapping;
  allowUpdate: boolean;
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

async function handleRestoreVersion(
  props: Props,
  versions: APIUpdateActionBatch[],
  version: number,
) {
  const getNewestVersion = () => {
    return _.max(versions.map((batch) => batch.version)) || 0;
  };
  if (props.allowUpdate) {
    Store.dispatch(
      setVersionNumberAction(
        getNewestVersion(),
        props.versionedObjectType,
        props.tracing.tracingId,
      ),
    );
    Store.dispatch(
      pushSaveQueueTransaction(
        [revertToVersion(version)],
        props.versionedObjectType,
        props.tracing.tracingId,
      ),
    );
    await Model.ensureSavedState();
    Store.dispatch(setVersionRestoreVisibilityAction(false));
    Store.dispatch(setAnnotationAllowUpdateAction(true));
  } else {
    const { annotationType, annotationId, volumes } = Store.getState().tracing;
    const includesVolumeFallbackData = volumes.some((volume) => volume.fallbackLayer != null);
    downloadAnnotation(annotationId, annotationType, includesVolumeFallbackData, {
      [props.versionedObjectType]: version,
    });
  }
}

function handlePreviewVersion(props: Props, version: number) {
  if (props.versionedObjectType === "skeleton") {
    return previewVersion({
      skeleton: version,
    });
  } else if (props.versionedObjectType === "volume") {
    return previewVersion({
      volumes: {
        [props.tracing.tracingId]: version,
      },
    });
  } else {
    Toast.warning(
      `Version preview and restoring for ${props.versionedObjectType}s is not supported yet.`,
    );
    return Promise.resolve();
  }
}

// eslint-disable-next-line react/sort-comp
const getGroupedAndChunkedVersions = _.memoize(
  (versions: Array<APIUpdateActionBatch>): GroupedAndChunkedVersions => {
    // This function first groups the versions by day, where the key is the output of the moment calendar function.
    // Then, the versions for each day are chunked into x-minute intervals,
    // so that the actions of one chunk are all from within one x-minute interval.
    const groupedVersions = _.groupBy(versions, (batch) =>
      moment
        .utc(_.max(batch.value.map((action) => action.value.actionTimestamp)))
        .calendar(null, MOMENT_CALENDAR_FORMAT),
    );

    const getBatchTime = (batch: APIUpdateActionBatch): number =>
      _.max(batch.value.map((action: ServerUpdateAction) => action.value.actionTimestamp)) || 0;

    return _.mapValues(groupedVersions, (versionsOfOneDay) =>
      chunkIntoTimeWindows(versionsOfOneDay, getBatchTime, 5),
    );
  },
);

function VersionList(props: Props) {
  const [versions, setVersions] = useState<APIUpdateActionBatch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const groupedAndChunkedVersions = getGroupedAndChunkedVersions(versions);

  const batchesAndDateStrings = _.flattenDepth(Object.entries(groupedAndChunkedVersions), 2);

  async function fetchData() {
    const { tracingId } = props.tracing;
    const { url: tracingStoreUrl } = Store.getState().tracing.tracingStore;
    setIsLoading(true);

    try {
      const updateActionLog = await getUpdateActionLog(
        tracingStoreUrl,
        tracingId,
        props.versionedObjectType,
      );
      // Insert version 0
      updateActionLog.push({
        version: 0,
        value: [serverCreateTracing(props.tracing.createdTimestamp)],
      });
      setVersions(updateActionLog);
    } catch (error) {
      handleGenericError(error as Error);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    Store.dispatch(setAnnotationAllowUpdateAction(false));
    fetchData();
  }, []);

  return (
    <List
      dataSource={batchesAndDateStrings}
      loading={isLoading}
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
            allowUpdate={props.allowUpdate}
            newestVersion={versions[0].version}
            activeVersion={props.tracing.version}
            onRestoreVersion={(version) => handleRestoreVersion(props, versions, version)}
            onPreviewVersion={(version) => handlePreviewVersion(props, version)}
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'version' does not exist on type 'APIUpda... Remove this comment to see the full error message
            key={batchesOrDateString[0].version}
          />
        )
      }
    ></List>
  );
}

export default VersionList;

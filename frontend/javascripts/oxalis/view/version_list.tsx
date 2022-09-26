import { Button, List } from "antd";
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
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";

const ENTRIES_PER_PAGE = 500;

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
  const getNewestVersion = () => _.max(versions.map((batch) => batch.version)) || 0;
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

async function getUpdateActionLogPage(
  props: Props,
  tracingStoreUrl: string,
  tracingId: string,
  versionedObjectType: SaveQueueType,
  baseVersion: number,
  // 0 is the "newest" page (i.e., the page in which the base version is)
  relativePageNumber: number,
) {
  if (ENTRIES_PER_PAGE % 10 !== 0) {
    // Otherwise, the oldestVersion === 1 condition at the end of this
    // function would not work correctly.
    throw new Error("ENTRIES_PER_PAGE should be divisible by 10.");
  }

  // For example, the following parameters would be a valid variable set:
  // baseVersion = 23
  // relativePageNumber = 1
  // absolutePageNumber = 10
  // newestVersion = 22
  // oldestVersion = 21
  const absolutePageNumber = Math.floor(baseVersion / ENTRIES_PER_PAGE) - relativePageNumber;
  if (absolutePageNumber < 0) {
    throw new Error("Negative absolute page number received.");
  }
  const newestVersion = (1 + absolutePageNumber) * ENTRIES_PER_PAGE;
  // The backend won't send the version 0 as that does not exist. The frontend however
  // shows that as the initial version.
  const oldestVersion = Math.max(absolutePageNumber * ENTRIES_PER_PAGE + 1, 1);

  const updateActionLog = await getUpdateActionLog(
    tracingStoreUrl,
    tracingId,
    versionedObjectType,
    oldestVersion,
    newestVersion,
  );

  // Insert version 0
  if (oldestVersion === 1) {
    updateActionLog.push({
      version: 0,
      value: [serverCreateTracing(props.tracing.createdTimestamp)],
    });
  }

  const nextPage = oldestVersion > 1 ? relativePageNumber + 1 : undefined;

  return { data: updateActionLog, nextPage };
}

function VersionList(props: Props) {
  const queryClient = useQueryClient();
  // Remember the version with which the version view was opened (
  // the active version could change by the actions of the user).
  // Based on this version, the page numbers are calculated.
  const [baseVersion] = useState(props.tracing.version);

  function fetchPaginatedVersions({ pageParam = 0 }) {
    const { tracingId } = props.tracing;
    const { url: tracingStoreUrl } = Store.getState().tracing.tracingStore;

    return getUpdateActionLogPage(
      props,
      tracingStoreUrl,
      tracingId,
      props.versionedObjectType,
      baseVersion,
      pageParam,
    );
  }

  const queryKey = ["versions", props.tracing.tracingId];
  const {
    data: versions,
    error,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
  } = useInfiniteQuery(queryKey, fetchPaginatedVersions, {
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    getNextPageParam: (lastPage) => lastPage.nextPage,
  });
  const flattenedVersions = _.flatten(versions?.pages.map((page) => page.data) || []);
  const groupedAndChunkedVersions = getGroupedAndChunkedVersions(flattenedVersions);
  const batchesAndDateStrings = _.flattenDepth(
    Object.entries(groupedAndChunkedVersions),
    2,
  ) as Array<string | APIUpdateActionBatch[]>;

  useEffect(() => {
    // Remove all previous existent queries so that the content of this view
    // is loaded from scratch. This is important since the loaded page numbers
    // are relative to the base version. If the version of the tracing changed,
    // old pages are not valid anymore.
    queryClient.removeQueries(queryKey);
    Store.dispatch(setAnnotationAllowUpdateAction(false));
  }, []);

  useEffect(() => {
    // The initially loaded page could be quite short (e.g., if
    // ENTRIES_PER_PAGE is 100 and the current version is 105, the first
    // page will only contain 5 items). In that case, also load the next
    // page.
    if (
      flattenedVersions.length === 0 ||
      flattenedVersions.length > ENTRIES_PER_PAGE ||
      baseVersion < ENTRIES_PER_PAGE
    ) {
      // No need to pre-fetch the next page.
      return;
    }
    if (hasNextPage || !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [flattenedVersions, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    if (error) {
      handleGenericError(error as Error);
    }
  }, [error]);

  return (
    <div>
      {flattenedVersions && (
        <List
          dataSource={batchesAndDateStrings}
          loading={isFetching}
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
                batches={batchesOrDateString}
                allowUpdate={props.allowUpdate}
                newestVersion={flattenedVersions[0].version}
                activeVersion={props.tracing.version}
                onRestoreVersion={(version) =>
                  handleRestoreVersion(props, flattenedVersions, version)
                }
                onPreviewVersion={(version) => handlePreviewVersion(props, version)}
                key={batchesOrDateString[0].version}
              />
            )
          }
        />
      )}
      {hasNextPage && (
        <div style={{ display: "flex", justifyContent: "center", margin: 12 }}>
          <Button onClick={() => fetchNextPage()} disabled={!hasNextPage || isFetchingNextPage}>
            {isFetchingNextPage ? "Loading more..." : "Load More"}
          </Button>
        </div>
      )}
    </div>
  );
}

export default VersionList;

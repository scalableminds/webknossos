import { Button, List, Spin } from "antd";
import { useState, useEffect } from "react";
import _ from "lodash";
import dayjs from "dayjs";
import type { APIUpdateActionBatch } from "types/api_flow_types";
import { chunkIntoTimeWindows } from "libs/utils";
import {
  getUpdateActionLog,
  downloadAnnotation,
  getNewestVersionForTracing,
} from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import {
  pushSaveQueueTransaction,
  setVersionNumberAction,
} from "oxalis/model/actions/save_actions";
import {
  revertToVersion,
  serverCreateTracing,
  type ServerUpdateAction,
} from "oxalis/model/sagas/update_actions";
import { setAnnotationAllowUpdateAction } from "oxalis/model/actions/annotation_actions";
import { setVersionRestoreVisibilityAction } from "oxalis/model/actions/ui_actions";
import { Model } from "oxalis/singletons";
import type { HybridTracing, OxalisState } from "oxalis/store";
import Store from "oxalis/store";
import VersionEntryGroup from "oxalis/view/version_entry_group";
import { api } from "oxalis/singletons";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffectOnlyOnce } from "libs/react_hooks";
import { useFetch } from "libs/react_helpers";
import { useSelector } from "react-redux";
import { getCreationTimestamp } from "oxalis/model/accessors/annotation_accessor";

const ENTRIES_PER_PAGE = 5000;

type Props = {
  allowUpdate: boolean;
};

// The string key is a date string
// The value is an array of chunked APIUpdateActionBatches
type GroupedAndChunkedVersions = Record<string, Array<Array<APIUpdateActionBatch>>>;

const VERSION_LIST_PLACEHOLDER = {
  emptyText: "No versions created yet.",
};
export async function previewVersion(version?: number) {
  const state = Store.getState();
  const { controlMode } = state.temporaryConfiguration;
  const { annotationId } = state.tracing;
  await api.tracing.restart(null, annotationId, controlMode, version);
  Store.dispatch(setAnnotationAllowUpdateAction(false));
  const segmentationLayersToReload = [];

  // TODOp: properly determine which layers to reload.
  // No versions were passed which means that the newest annotation should be
  // shown. Therefore, reload all segmentation layers.
  segmentationLayersToReload.push(...Model.getSegmentationTracingLayers());

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
  if (props.allowUpdate) {
    const newestVersion = _.max(versions.map((batch) => batch.version)) || 0;
    Store.dispatch(setVersionNumberAction(newestVersion));
    Store.dispatch(
      pushSaveQueueTransaction(
        [revertToVersion(version)],
        // todop
        "experimental; leaving out tracingId as this should not be required",
      ),
    );
    await Model.ensureSavedState();
    Store.dispatch(setVersionRestoreVisibilityAction(false));
    Store.dispatch(setAnnotationAllowUpdateAction(true));
  } else {
    const { annotationType, annotationId, volumes } = Store.getState().tracing;
    const includesVolumeFallbackData = volumes.some((volume) => volume.fallbackLayer != null);
    downloadAnnotation(annotationId, annotationType, includesVolumeFallbackData, version);
  }
}

const getGroupedAndChunkedVersions = _.memoize(
  (versions: Array<APIUpdateActionBatch>): GroupedAndChunkedVersions => {
    // This function first groups the versions by day, where the key is the output of the moment calendar function.
    // Then, the versions for each day are chunked into x-minute intervals,
    // so that the actions of one chunk are all from within one x-minute interval.
    const groupedVersions = _.groupBy(versions, (batch) =>
      dayjs.utc(_.max(batch.value.map((action) => action.value.actionTimestamp))).calendar(null),
    );

    const getBatchTime = (batch: APIUpdateActionBatch): number =>
      _.max(batch.value.map((action: ServerUpdateAction) => action.value.actionTimestamp)) || 0;

    return _.mapValues(groupedVersions, (versionsOfOneDay) =>
      chunkIntoTimeWindows(versionsOfOneDay, getBatchTime, 5),
    );
  },
);

async function getUpdateActionLogPage(
  tracing: HybridTracing,
  tracingStoreUrl: string,
  annotationId: string,
  newestVersion: number,
  // 0 is the "newest" page (i.e., the page in which the newest version is)
  relativePageNumber: number,
) {
  if (ENTRIES_PER_PAGE % 10 !== 0) {
    // Otherwise, the oldestVersion === 1 condition at the end of this
    // function would not work correctly.
    throw new Error("ENTRIES_PER_PAGE should be divisible by 10.");
  }

  // For example, the following parameters would be a valid variable set
  // (assuming ENTRIES_PER_PAGE = 2):
  // newestVersion = 23
  // relativePageNumber = 1
  // absolutePageNumber = ⌊11.5⌋ - 1 = 10
  // newestVersion = 22
  // oldestVersion = 21
  // Thus, versions 21 and 22 will be fetched for the second newest page
  const absolutePageNumber = Math.floor(newestVersion / ENTRIES_PER_PAGE) - relativePageNumber;
  if (absolutePageNumber < 0) {
    throw new Error("Negative absolute page number received.");
  }
  const newestVersionInPage = (1 + absolutePageNumber) * ENTRIES_PER_PAGE;
  const oldestVersionInPage = absolutePageNumber * ENTRIES_PER_PAGE + 1;

  const updateActionLog = await getUpdateActionLog(
    tracingStoreUrl,
    annotationId,
    oldestVersionInPage,
    newestVersionInPage,
  );

  // The backend won't send the version 0 as that does not exist. The frontend however
  // shows that as the initial version. Thus, insert version 0.
  if (oldestVersionInPage === 1) {
    updateActionLog.push({
      version: 0,
      value: [serverCreateTracing(getCreationTimestamp(tracing))],
    });
  }

  // nextPage will contain older versions
  const nextPage = oldestVersionInPage > 1 ? relativePageNumber + 1 : undefined;
  // previousPage will contain newer versions
  const previousPage = newestVersion > newestVersionInPage ? relativePageNumber - 1 : undefined;

  return { data: updateActionLog, nextPage, previousPage };
}

function VersionList(props: Props) {
  const tracingStoreUrl = useSelector((state: OxalisState) => state.tracing.tracingStore.url);
  const annotationId = useSelector((state: OxalisState) => state.tracing.annotationId);

  const newestVersion = useFetch(
    () => getNewestVersionForTracing(tracingStoreUrl, annotationId),
    null,
    [annotationId],
  );
  console.log("newestVersion", newestVersion);

  if (newestVersion == null) {
    return (
      <div className="flex-center-child">
        <Spin spinning />
      </div>
    );
  }

  return <InnerVersionList {...props} newestVersion={newestVersion} />;
}

function InnerVersionList(props: Props & { newestVersion: number }) {
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const queryClient = useQueryClient();
  // Remember the version with which the version view was opened (
  // the active version could change by the actions of the user).
  // Based on this version, the page numbers are calculated.
  const { newestVersion } = props;
  const [initialVersion] = useState(tracing.version);

  function fetchPaginatedVersions({ pageParam }: { pageParam?: number }) {
    // TODOp: maybe refactor this so that this method is not calculated very rendering cycle
    if (pageParam == null) {
      pageParam = Math.floor((newestVersion - initialVersion) / ENTRIES_PER_PAGE);
    }
    const { url: tracingStoreUrl } = Store.getState().tracing.tracingStore;
    const annotationId = Store.getState().tracing.annotationId;

    return getUpdateActionLogPage(tracing, tracingStoreUrl, annotationId, newestVersion, pageParam);
  }

  const queryKey = ["versions", tracing.annotationId];

  useEffectOnlyOnce(() => {
    // Remove all previous existent queries so that the content of this view
    // is loaded from scratch. This is important since the loaded page numbers
    // are relative to the base version. If the version of the tracing changed,
    // old pages are not valid anymore.
    queryClient.removeQueries(queryKey);
    Store.dispatch(setAnnotationAllowUpdateAction(false));
  });

  const {
    data: versions,
    error,
    isFetching,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    hasPreviousPage,
    fetchPreviousPage,
    isFetchingPreviousPage,
  } = useInfiniteQuery(queryKey, fetchPaginatedVersions, {
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    getPreviousPageParam: (lastPage) => lastPage.previousPage,
  });
  const flattenedVersions = _.flatten(versions?.pages.map((page) => page.data) || []);
  const groupedAndChunkedVersions = getGroupedAndChunkedVersions(flattenedVersions);
  const batchesAndDateStrings: Array<string | APIUpdateActionBatch[]> = _.flattenDepth(
    Object.entries(groupedAndChunkedVersions) as any,
    2,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: Needs investigation whether fetchNextPage should be added to the dependencies.
  useEffect(() => {
    // The initially loaded page could be quite short (e.g., if
    // ENTRIES_PER_PAGE is 100 and the current version is 105, the first
    // page will only contain 5 items). In that case, also load the next
    // page.
    if (
      flattenedVersions.length === 0 ||
      flattenedVersions.length > ENTRIES_PER_PAGE ||
      newestVersion < ENTRIES_PER_PAGE
    ) {
      // No need to pre-fetch the next page.
      return;
    }
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [flattenedVersions, hasNextPage, isFetchingNextPage, newestVersion]);

  useEffect(() => {
    if (error) {
      handleGenericError(error as Error);
    }
  }, [error]);

  return (
    <div>
      {hasPreviousPage && (
        <div className="flex-center-child">
          <Button
            onClick={() => fetchPreviousPage()}
            disabled={!hasPreviousPage || isFetchingPreviousPage}
          >
            {isFetchingPreviousPage ? "Loading more..." : "Load More"}
          </Button>
        </div>
      )}
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
                activeVersion={tracing.version}
                onRestoreVersion={(version) =>
                  handleRestoreVersion(props, flattenedVersions, version)
                }
                onPreviewVersion={(version) => previewVersion(version)}
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

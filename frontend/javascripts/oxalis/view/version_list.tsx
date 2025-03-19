import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  downloadAnnotation,
  getAnnotationProto,
  getNewestVersionForAnnotation,
  getUpdateActionLog,
} from "admin/admin_rest_api";
import { Button, List, Spin } from "antd";
import dayjs from "dayjs";
import { handleGenericError } from "libs/error_handling";
import { useFetch } from "libs/react_helpers";
import { useEffectOnlyOnce } from "libs/react_hooks";
import { chunkIntoTimeWindows } from "libs/utils";
import _ from "lodash";
import { getCreationTimestamp } from "oxalis/model/accessors/annotation_accessor";
import { setAnnotationAllowUpdateAction } from "oxalis/model/actions/annotation_actions";
import {
  pushSaveQueueTransactionIsolated,
  setVersionNumberAction,
} from "oxalis/model/actions/save_actions";
import { setVersionRestoreVisibilityAction } from "oxalis/model/actions/ui_actions";
import {
  type ServerUpdateAction,
  revertToVersion,
  serverCreateTracing,
} from "oxalis/model/sagas/update_actions";
import { Model } from "oxalis/singletons";
import { api } from "oxalis/singletons";
import type { HybridTracing, OxalisState } from "oxalis/store";
import Store from "oxalis/store";
import VersionEntryGroup from "oxalis/view/version_entry_group";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import type { APIUpdateActionBatch } from "types/api_flow_types";

const ENTRIES_PER_PAGE = 5000;

type Props = {
  initialAllowUpdate: boolean;
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
  const { annotationId, tracingStore, annotationLayers } = state.tracing;

  const annotationProto = await getAnnotationProto(tracingStore.url, annotationId, version);

  if (
    !_.isEqual(
      annotationProto.annotationLayers.map((l) => l.tracingId),
      annotationLayers.map((l) => l.tracingId),
    )
  ) {
    const params = new URLSearchParams();
    if (version != null) {
      params.append("showVersionRestore", "true");
      params.append("version", `${version}`);
    }
    location.href = `${location.origin}/annotations/${annotationId}?${params}${location.hash}`;
    return;
  }

  await api.tracing.restart(null, annotationId, controlMode, version, false, false);
  Store.dispatch(setAnnotationAllowUpdateAction(false));
  const segmentationLayersToReload = [];

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
  if (props.initialAllowUpdate) {
    const newestVersion = _.max(versions.map((batch) => batch.version)) || 0;
    Store.dispatch(setVersionNumberAction(newestVersion));
    Store.dispatch(pushSaveQueueTransactionIsolated(revertToVersion(version)));
    await Model.ensureSavedState();
    Store.dispatch(setVersionRestoreVisibilityAction(false));
    Store.dispatch(setAnnotationAllowUpdateAction(true));
  } else {
    const { annotationType, annotationId, volumes } = Store.getState().tracing;
    const includesVolumeFallbackData = volumes.some((volume) => volume.fallbackLayer != null);
    downloadAnnotation(annotationId, annotationType, includesVolumeFallbackData, version);
  }
}

export const handleCloseRestoreView = async () => {
  // This will load the newest version of both skeleton and volume tracings
  await previewVersion();
  Store.dispatch(setVersionRestoreVisibilityAction(false));
  const { initialAllowUpdate } = Store.getState().tracing.restrictions;
  Store.dispatch(setAnnotationAllowUpdateAction(initialAllowUpdate));
};

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
  earliestAccessibleVersion: number,
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
  // relativePageNumber = 1 (0 is the newest, 1 is the second newest)
  // absolutePageNumber = ⌊23/2⌋ - 1 = 10
  // newestVersionInPage = 22
  // oldestVersionInPage = 21
  // Thus, versions 21 and 22 will be fetched for the second newest page
  const absolutePageNumber = Math.floor(newestVersion / ENTRIES_PER_PAGE) - relativePageNumber;
  if (absolutePageNumber < 0) {
    throw new Error("Negative absolute page number received.");
  }
  const newestVersionInPage = (1 + absolutePageNumber) * ENTRIES_PER_PAGE;
  const oldestVersionInPage = Math.max(
    absolutePageNumber * ENTRIES_PER_PAGE + 1,
    earliestAccessibleVersion,
  );

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
  const nextPage =
    oldestVersionInPage > Math.max(earliestAccessibleVersion, 1)
      ? relativePageNumber + 1
      : undefined;
  // previousPage will contain newer versions
  const previousPage = newestVersion > newestVersionInPage ? relativePageNumber - 1 : undefined;

  return { data: updateActionLog, nextPage, previousPage };
}

function VersionList() {
  const tracingStoreUrl = useSelector((state: OxalisState) => state.tracing.tracingStore.url);
  const annotationId = useSelector((state: OxalisState) => state.tracing.annotationId);
  const initialAllowUpdate = useSelector(
    (state: OxalisState) => state.tracing.restrictions.initialAllowUpdate,
  );
  const newestVersion = useFetch(
    async () => {
      if (annotationId === "") {
        return null;
      }
      return getNewestVersionForAnnotation(tracingStoreUrl, annotationId);
    },
    null,
    [annotationId],
  );

  if (newestVersion == null) {
    return (
      <div className="flex-center-child">
        <Spin spinning />
      </div>
    );
  }

  return <InnerVersionList newestVersion={newestVersion} initialAllowUpdate={initialAllowUpdate} />;
}

function InnerVersionList(props: Props & { newestVersion: number; initialAllowUpdate: boolean }) {
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const queryClient = useQueryClient();
  // Remember the version with which the version view was opened (
  // the active version could change by the actions of the user).
  // Based on this version, the page numbers are calculated.
  const { newestVersion } = props;
  const [initialVersion] = useState(tracing.version);

  // true if another version is being restored or previewed
  const [isChangingVersion, setIsChangingVersion] = useState(false);

  function fetchPaginatedVersions({ pageParam }: { pageParam?: number }) {
    if (pageParam == null) {
      pageParam = Math.floor((newestVersion - initialVersion) / ENTRIES_PER_PAGE);
    }
    const { url: tracingStoreUrl } = Store.getState().tracing.tracingStore;
    const { annotationId, earliestAccessibleVersion } = Store.getState().tracing;

    return getUpdateActionLogPage(
      tracing,
      tracingStoreUrl,
      annotationId,
      earliestAccessibleVersion,
      newestVersion,
      pageParam,
    );
  }

  const queryKey = ["versions", tracing.annotationId];

  useEffectOnlyOnce(() => {
    // Remove all previous existent queries so that the content of this view
    // is loaded from scratch. This is important since the loaded page numbers
    // are relative to the base version. If the version of the tracing changed,
    // old pages are not valid anymore.
    queryClient.removeQueries(queryKey);
    // Will be set back by handleRestoreVersion or handleCloseRestoreView
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

  const executeUnlessSwitchingVersions = async (fn: () => Promise<void>) => {
    if (isChangingVersion) {
      return;
    }
    setIsChangingVersion(true);
    try {
      await fn();
    } finally {
      setIsChangingVersion(false);
    }
  };

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
          loading={isFetching || isChangingVersion}
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
                initialAllowUpdate={props.initialAllowUpdate}
                newestVersion={flattenedVersions[0].version}
                activeVersion={tracing.version}
                onRestoreVersion={async (version) => {
                  executeUnlessSwitchingVersions(() =>
                    handleRestoreVersion(props, flattenedVersions, version),
                  );
                }}
                onPreviewVersion={async (version) => {
                  executeUnlessSwitchingVersions(() => previewVersion(version));
                }}
                key={batchesOrDateString[0].version}
              />
            )
          }
        />
      )}
      {hasNextPage ? (
        <div style={{ display: "flex", justifyContent: "center", margin: 12 }}>
          <Button onClick={() => fetchNextPage()} disabled={!hasNextPage || isFetchingNextPage}>
            {isFetchingNextPage ? "Loading more..." : "Load More"}
          </Button>
        </div>
      ) : tracing.earliestAccessibleVersion > 0 ? (
        <div style={{ textAlign: "center", marginTop: 8, marginBottom: 4 }}>
          Cannot show versions earlier than {tracing.earliestAccessibleVersion}.
        </div>
      ) : null}
    </div>
  );
}

export default VersionList;

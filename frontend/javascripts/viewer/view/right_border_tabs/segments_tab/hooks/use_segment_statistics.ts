import { useQuery } from "@tanstack/react-query";
import {
  getSegmentBoundingBoxes,
  getSegmentCentersOfMass,
  getSegmentCovarianceMatrices,
  getSegmentMaxDistances,
  getSegmentSphericities,
  getSegmentSurfaceArea,
  getSegmentVolumes,
} from "admin/rest_api";
import { useWkSelector } from "libs/react_hooks";
import { useMemo } from "react";
import type {
  APISegmentationLayer,
  SegmentCovarianceMatrix,
  SegmentStatisticsFileInfo,
} from "types/api_types";
import type { Vector3 } from "viewer/constants";
import {
  getMagInfo,
  getMaybeSegmentIndexAvailability,
} from "viewer/model/accessors/dataset_accessor";
import { getCurrentMappingName } from "viewer/model/accessors/volumetracing_accessor";
import type { LayerSourceInfo } from "viewer/model/bucket_data_handling/wkstore_helper";
import { api, Store } from "viewer/singletons";
import { type AvailableFileMetrics, getAvailableFileMetrics } from "../segment_statistics_helpers";
import { useSegmentStatisticsFile } from "./use_segment_statistics_file";

export type SegmentBoundingBox = {
  topLeft: Vector3;
  width: number;
  height: number;
  depth: number;
};

export type SegmentStatistic<T> = {
  // Positional, matching the requested segment ids.
  data: T[] | undefined;
  isLoading: boolean;
  isError: boolean;
};

export type SegmentStatistics = {
  /** False when neither a segment index nor a statistics file can answer anything for this layer. */
  areSegmentStatisticsAvailable: boolean;
  fileInfo: SegmentStatisticsFileInfo | null;
  /** The mag every statistic except the bounding box is requested in. */
  statisticsMag: Vector3;
  /** Bounding boxes are never in the statistics file and stay on the layer's finest mag. */
  boundingBoxMag: Vector3;
  availableFileMetrics: AvailableFileMetrics;
  volumes: SegmentStatistic<number>;
  boundingBoxes: SegmentStatistic<SegmentBoundingBox>;
  surfaceAreas: SegmentStatistic<number>;
  maxDistances: SegmentStatistic<number>;
  sphericities: SegmentStatistic<number>;
  centersOfMass: SegmentStatistic<Vector3>;
  covarianceMatrices: SegmentStatistic<SegmentCovarianceMatrix>;
};

type Options = {
  layer: APISegmentationLayer | null | undefined;
  segmentIds: bigint[];
  /** Set to false to defer fetching, e.g. until the user asks for the statistics. */
  enabled?: boolean;
  /** Change this to force a refetch, e.g. for an explicit reload button. */
  refreshToken?: number | null;
};

const NOT_REQUESTED = { data: undefined, isLoading: false, isError: false };

/*
 * Fetches segment statistics for a list of segments. This is the single source of truth for both
 * the segment statistics table and the viewport context menu, so that both agree on which mag to
 * request, which metrics the layer can answer, and how partial failures are reported. Consumers
 * are free to display only a subset.
 *
 * Volume, surface area and bounding box are always requested (the backend falls back to computing
 * them). The remaining four come from a precomputed statistics file and are only requested when
 * that file offers them for the currently active mapping.
 */
export function useSegmentStatistics({
  layer,
  segmentIds,
  enabled = true,
  refreshToken,
}: Options): SegmentStatistics {
  const dataset = useWkSelector((state) => state.dataset);
  const annotation = useWkSelector((state) => state.annotation);
  const mappingName = useWkSelector(getCurrentMappingName);
  const additionalCoordinates = useWkSelector((state) => state.flycam.additionalCoordinates);
  const currentMeshFileName = useWkSelector((state) =>
    layer != null
      ? state.localSegmentationStateByLayer[layer.name]?.currentMeshFile?.name
      : undefined,
  );
  const isSegmentIndexAvailable =
    useWkSelector((state) => getMaybeSegmentIndexAvailability(state.dataset, layer?.name)) === true;

  const { fileInfo, isLoading: isLoadingFileInfo } = useSegmentStatisticsFile(layer);
  const availableFileMetrics = useMemo(
    () => getAvailableFileMetrics(fileInfo, mappingName),
    [fileInfo, mappingName],
  );

  const boundingBoxMag = useMemo(
    () => (layer != null ? getMagInfo(layer.mags).getFinestMag() : ([1, 1, 1] as Vector3)),
    [layer],
  );
  // A statistics file can only answer queries in its own mag or coarser ones, so requesting its mag
  // is what lets volume and surface area be served from the file instead of being recomputed.
  const statisticsMag = fileInfo?.mag ?? boundingBoxMag;

  const areSegmentStatisticsAvailable = isSegmentIndexAvailable || fileInfo != null;

  const layerSourceInfo: LayerSourceInfo | null = useMemo(
    () =>
      layer == null
        ? null
        : {
            dataset,
            annotation,
            tracingId: layer.tracingId,
            segmentationLayerName: layer.name,
          },
    [dataset, annotation, layer],
  );

  const canRequest = enabled && layerSourceInfo != null && segmentIds.length > 0;
  // Waiting for the file info avoids firing every query twice, once per mag.
  const isReady = canRequest && !isLoadingFileInfo && areSegmentStatisticsAvailable;

  // Only identifying values belong in the query key. react-query hashes keys on every render, and
  // `layerSourceInfo` carries the whole dataset and annotation (including skeleton trees), which
  // would make that hashing dominate rendering. The request itself closes over it instead.
  const sharedKey = [
    dataset.id,
    layer?.name ?? null,
    layer?.tracingId ?? null,
    // BigInts cannot be serialized by react-query's JSON-based key hashing, so stringify them.
    segmentIds.map(String),
    additionalCoordinates,
    mappingName,
    refreshToken ?? null,
  ];

  // Volume, surface area and bounding box may be served by a volume annotation, whose pending
  // changes have to be flushed before they can be counted.
  const saveAndGetAnnotationVersion = async () => {
    await api.tracing.save();
    return Store.getState().annotation.version;
  };

  const volumes = useQuery({
    queryKey: ["segmentVolumes", statisticsMag, ...sharedKey],
    queryFn: async () =>
      getSegmentVolumes(
        layerSourceInfo as LayerSourceInfo,
        statisticsMag,
        segmentIds,
        additionalCoordinates,
        mappingName,
        await saveAndGetAnnotationVersion(),
      ),
    enabled: isReady,
    gcTime: 0,
  });

  const boundingBoxes = useQuery({
    queryKey: ["segmentBoundingBoxes", boundingBoxMag, ...sharedKey],
    queryFn: async () =>
      getSegmentBoundingBoxes(
        layerSourceInfo as LayerSourceInfo,
        boundingBoxMag,
        segmentIds,
        additionalCoordinates,
        mappingName,
        await saveAndGetAnnotationVersion(),
      ),
    enabled: isReady,
    gcTime: 0,
  });

  const surfaceAreas = useQuery({
    queryKey: ["segmentSurfaceAreas", statisticsMag, currentMeshFileName ?? null, ...sharedKey],
    queryFn: async () =>
      getSegmentSurfaceArea(
        layerSourceInfo as LayerSourceInfo,
        statisticsMag,
        currentMeshFileName,
        segmentIds,
        additionalCoordinates,
        mappingName,
        await saveAndGetAnnotationVersion(),
      ),
    enabled: isReady,
    gcTime: 0,
  });

  // The remaining metrics are only served from the statistics file, so there is nothing to flush
  // and nothing to fall back to.
  const maxDistances = useQuery({
    queryKey: ["segmentMaxDistances", statisticsMag, ...sharedKey],
    queryFn: () =>
      getSegmentMaxDistances(
        layerSourceInfo as LayerSourceInfo,
        statisticsMag,
        segmentIds,
        additionalCoordinates,
        mappingName,
      ),
    enabled: isReady && availableFileMetrics.maxDistance,
    gcTime: 0,
  });

  const sphericities = useQuery({
    queryKey: ["segmentSphericities", statisticsMag, ...sharedKey],
    queryFn: () =>
      getSegmentSphericities(
        layerSourceInfo as LayerSourceInfo,
        statisticsMag,
        segmentIds,
        additionalCoordinates,
        mappingName,
      ),
    enabled: isReady && availableFileMetrics.sphericity,
    gcTime: 0,
  });

  const centersOfMass = useQuery({
    queryKey: ["segmentCentersOfMass", statisticsMag, ...sharedKey],
    queryFn: () =>
      getSegmentCentersOfMass(
        layerSourceInfo as LayerSourceInfo,
        statisticsMag,
        segmentIds,
        additionalCoordinates,
        mappingName,
      ),
    enabled: isReady && availableFileMetrics.centerOfMass,
    gcTime: 0,
  });

  const covarianceMatrices = useQuery({
    queryKey: ["segmentCovarianceMatrices", statisticsMag, ...sharedKey],
    queryFn: () =>
      getSegmentCovarianceMatrices(
        layerSourceInfo as LayerSourceInfo,
        statisticsMag,
        segmentIds,
        additionalCoordinates,
        mappingName,
      ),
    enabled: isReady && availableFileMetrics.covariance,
    gcTime: 0,
  });

  type RawQuery<T> = { data: T[] | undefined; isError: boolean };

  /*
   * Reports a statistic as pending whenever it has been requested but has neither arrived nor
   * failed, rather than forwarding react-query's `isLoading`. That flag is `isPending && isFetching`,
   * and `isFetching` is false both before the fetch has actually been kicked off and for as long as
   * PersistQueryClientProvider is restoring the cache from localStorage — in either window a
   * consumer would render an empty cell instead of a spinner.
   */
  const toStatistic = <T>(query: RawQuery<T>, isRequested: boolean): SegmentStatistic<T> =>
    isRequested
      ? {
          data: query.data,
          isLoading: query.data === undefined && !query.isError,
          isError: query.isError,
        }
      : NOT_REQUESTED;

  // The three core statistics count as requested while the file info is still resolving, since they
  // are only waiting for the mag that it decides. The file-backed ones cannot be known to exist yet.
  const isCoreRequested = canRequest && (isLoadingFileInfo || areSegmentStatisticsAvailable);

  return {
    areSegmentStatisticsAvailable,
    fileInfo,
    statisticsMag,
    boundingBoxMag,
    availableFileMetrics,
    volumes: toStatistic(volumes, isCoreRequested),
    boundingBoxes: toStatistic(boundingBoxes, isCoreRequested),
    surfaceAreas: toStatistic(surfaceAreas, isCoreRequested),
    maxDistances: toStatistic(maxDistances, isReady && availableFileMetrics.maxDistance),
    sphericities: toStatistic(sphericities, isReady && availableFileMetrics.sphericity),
    centersOfMass: toStatistic(centersOfMass, isReady && availableFileMetrics.centerOfMass),
    covarianceMatrices: toStatistic(covarianceMatrices, isReady && availableFileMetrics.covariance),
  };
}

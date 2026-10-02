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
import type { BoundingBoxObject } from "types/bounding_box";
import type { Vector3 } from "viewer/constants";
import {
  getMagInfo,
  getMaybeSegmentIndexAvailability,
} from "viewer/model/accessors/dataset_accessor";
import { getCurrentMappingName } from "viewer/model/accessors/volumetracing_accessor";
import type { LayerSourceInfo } from "viewer/model/bucket_data_handling/wkstore_helper";
import { api, Store } from "viewer/singletons";
import {
  type AvailableFileMetrics,
  getAvailableMetricsFromFileInfo,
} from "../segment_statistics_helpers";
import { useSegmentStatisticsFile } from "./use_segment_statistics_file";

export type SegmentStatistic<T> = {
  // Positional, matching the requested segment ids.
  data: T[] | undefined;
  isLoading: boolean;
  isError: boolean;
};

export type SegmentStatistics = {
  // False when neither a segment index nor a statistics file can answer anything for this layer.
  areSegmentStatisticsAvailable: boolean;
  fileInfo: SegmentStatisticsFileInfo | null;
  // The mag every statistic except the bounding box is requested in.
  statisticsMag: Vector3;
  // Bounding boxes are never in the statistics file and stay on the layer's finest mag.
  boundingBoxMag: Vector3;
  // Bounding boxes can only be computed from a segment index; there is no fallback for them.
  isBoundingBoxAvailable: boolean;
  // Either the statistics file holds volumes, or a segment index can be counted.
  isVolumeAvailable: boolean;
  // Either the statistics file holds surfaces, or a segment index can drive ad-hoc meshing.
  isSurfaceAreaAvailable: boolean;
  availableFileMetrics: AvailableFileMetrics;
  // Note, that the segment statistics file format has slightly different keys as some are in plural and some in singular.
  volumes: SegmentStatistic<number>;
  boundingBoxes: SegmentStatistic<BoundingBoxObject>;
  surfaceAreas: SegmentStatistic<number>;
  maxDistances: SegmentStatistic<number>;
  sphericities: SegmentStatistic<number>;
  centersOfMass: SegmentStatistic<Vector3>;
  covarianceMatrices: SegmentStatistic<SegmentCovarianceMatrix>;
};

type Options = {
  layer: APISegmentationLayer | null | undefined;
  segmentIds: bigint[];
  // Set to false to defer fetching, e.g. until the user asks for the statistics.
  enabled?: boolean;
  // Change this to force a refetch, e.g. for an explicit reload button.
  refreshToken?: number | null;
};

const NOT_REQUESTED = { data: undefined, isLoading: false, isError: false };

/*
 * Fetches segment statistics for a list of segments. This hook should be used by and component using
 * the segment statistics as it has a shared query cache.
 *
 * Volume, surface area and bounding box are always requested (the backend falls back to computing
 * them). The remaining four come from a precomputed statistics file and are only requested when
 * that file offers them for the currently active mapping.
 *
 * How the fallback works: Volume falls back to counting the segment index. Surface area falls back
 * to a precomputed mesh file, or failing that to ad-hoc meshing, which itself walks the segment index.
 * When no source applies, the route 404s rather than returning a value, so it must not be requested at
 * all. We don't support the ad-hoc meshing via seed position here though.
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
  const currentMeshFile = useWkSelector((state) =>
    layer != null ? state.localSegmentationStateByLayer[layer.name]?.currentMeshFile : null,
  );
  const currentMeshFileName = currentMeshFile?.name;
  const isSegmentIndexAvailable =
    useWkSelector((state) => getMaybeSegmentIndexAvailability(state.dataset, layer?.name)) === true;

  const { fileInfo, isLoading: isLoadingFileInfo } = useSegmentStatisticsFile(layer);
  const availableFileMetrics = useMemo(
    () => getAvailableMetricsFromFileInfo(fileInfo, mappingName),
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

  // Which of the three fallback-capable statistics this layer can actually answer.
  const isVolumeAvailable = availableFileMetrics.volume || isSegmentIndexAvailable;
  // The backend only uses the selected mesh file when its mapping is exactly the requested one,
  // otherwise it falls through to ad-hoc meshing. Mirrors `meshFileMappingMatches` in
  // SegmentStatisticsController.
  const canMeshFileServeSurfaceArea =
    currentMeshFile != null && (currentMeshFile.mappingName || null) === (mappingName || null);
  const isSurfaceAreaAvailable =
    availableFileMetrics.surfaceArea || canMeshFileServeSurfaceArea || isSegmentIndexAvailable;

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
    enabled: isReady && isVolumeAvailable,
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
    // Bounding boxes are computed from the segment index only; unlike volume and surface area they
    // have neither a statistics-file source nor a fallback, so without one the route 404s.
    enabled: isReady && isSegmentIndexAvailable,
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
    enabled: isReady && isSurfaceAreaAvailable,
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
    isBoundingBoxAvailable: isSegmentIndexAvailable,
    isVolumeAvailable,
    isSurfaceAreaAvailable,
    fileInfo,
    statisticsMag,
    boundingBoxMag,
    availableFileMetrics,
    volumes: toStatistic(volumes, isCoreRequested && isVolumeAvailable),
    boundingBoxes: toStatistic(boundingBoxes, isCoreRequested && isSegmentIndexAvailable),
    surfaceAreas: toStatistic(surfaceAreas, isCoreRequested && isSurfaceAreaAvailable),
    maxDistances: toStatistic(maxDistances, isReady && availableFileMetrics.maxDistance),
    sphericities: toStatistic(sphericities, isReady && availableFileMetrics.sphericity),
    centersOfMass: toStatistic(centersOfMass, isReady && availableFileMetrics.centerOfMass),
    covarianceMatrices: toStatistic(covarianceMatrices, isReady && availableFileMetrics.covariance),
  };
}

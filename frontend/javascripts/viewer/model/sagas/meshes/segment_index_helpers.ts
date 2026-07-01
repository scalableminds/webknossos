import { getBucketPositionsForAdHocMesh, hasSegmentIndexInDataStoreCached } from "admin/rest_api";
import { V3 } from "libs/mjs";
import { call } from "typed-redux-saga";
import type { AdditionalCoordinate, APIDataset, APISegmentationLayer } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { sortByDistanceTo } from "viewer/controller/mesh_helpers";
import type { LayerSourceInfo } from "viewer/model/bucket_data_handling/wkstore_helper";
import type { Saga } from "viewer/model/sagas/effect_generators";
import type { StoreAnnotation, VolumeTracing } from "viewer/store";

/**
 * Whether the segment index can be used to look up segment positions. For
 * annotation layers, the volume tracing must have a segment index and must not
 * have an editable mapping; for plain dataset layers, the data store is asked
 * (and the result is cached).
 */
export function* getUsePositionsFromSegmentIndex(
  volumeTracing: VolumeTracing | null | undefined,
  dataset: APIDataset,
  layerName: string,
  maybeTracingId?: string | null,
): Saga<boolean> {
  if (volumeTracing == null) {
    return yield* call(
      hasSegmentIndexInDataStoreCached,
      dataset.dataStore.url,
      dataset.id,
      layerName,
    );
  }
  return (
    volumeTracing.hasSegmentIndex && !volumeTracing.hasEditableMapping && maybeTracingId != null
  );
}

/**
 * Builds the LayerSourceInfo that the data/tracing store requests need. By
 * default the tracing store is used when a volume tracing exists; pass
 * `useDataStoreOverride` to force a specific store.
 */
export function getLayerSourceInfo(
  dataset: APIDataset,
  annotation: StoreAnnotation | null,
  visibleSegmentationLayer: APISegmentationLayer,
  volumeTracing: VolumeTracing | null | undefined,
  useDataStoreOverride?: boolean | null,
): LayerSourceInfo {
  let useDataStore = volumeTracing == null || visibleSegmentationLayer.tracingId == null;
  if (useDataStoreOverride != null) {
    useDataStore = useDataStoreOverride;
  } else if (volumeTracing?.hasEditableMapping) {
    // An editable mapping can only be served by the tracing store.
    useDataStore = false;
  }
  return {
    dataset,
    annotation,
    tracingId: visibleSegmentationLayer.tracingId,
    segmentationLayerName: visibleSegmentationLayer.fallbackLayer ?? visibleSegmentationLayer.name,
    useDataStore,
  };
}

/**
 * Queries the segment index for the chunk positions (mag 1) that contain
 * `segmentId`, sorted by distance to `seedPosition`. The lookup happens on the
 * server and respects the active mapping (via `mappingName`).
 */
export function* getChunkPositionsFromSegmentIndex(
  layerSourceInfo: LayerSourceInfo,
  segmentId: number,
  cubeSize: Vector3,
  mag: Vector3,
  seedPosition: Vector3,
  additionalCoordinates: AdditionalCoordinate[] | null | undefined,
  mappingName: string | null | undefined,
  tracingVersion: number,
): Saga<Vector3[]> {
  const targetMagPositions = yield* call(
    getBucketPositionsForAdHocMesh,
    layerSourceInfo,
    segmentId,
    cubeSize,
    mag,
    additionalCoordinates,
    mappingName,
    tracingVersion,
  );
  const mag1Positions = targetMagPositions.map((pos) => V3.scale3(pos, mag));
  return sortByDistanceTo(mag1Positions, seedPosition) as Vector3[];
}

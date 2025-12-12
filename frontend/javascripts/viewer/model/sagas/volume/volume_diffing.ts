import { diffDiffableMaps } from "libs/diffable_map";
import { diffArrays } from "libs/utils";
import _ from "lodash";
import memoizeOne from "memoize-one";
import { AnnotationLayerEnum } from "types/api_types";
import {
  createSegmentVolumeAction,
  deleteSegmentVolumeAction,
  removeFallbackLayer,
  updateActiveSegmentId,
  updateLargestSegmentId,
  updateMappingName,
  updateMetadataOfSegmentUpdateAction,
  updateSegmentGroups,
  updateSegmentGroupsExpandedState,
  updateSegmentPartialVolumeAction,
  updateSegmentVisibilityVolumeAction,
  type UpdateActionWithoutIsolationRequirement,
} from "viewer/model/sagas/volume/update_actions";
import {
  SegmentPropertiesWithoutUserState,
  type Segment,
  type SegmentMap,
  type VolumeTracing,
} from "viewer/store";
import { diffBoundingBoxes, diffGroups } from "viewer/model/helpers/diff_helpers";

export function* diffVolumeTracing(
  prevVolumeTracing: VolumeTracing,
  volumeTracing: VolumeTracing,
): Generator<UpdateActionWithoutIsolationRequirement, void, void> {
  if (prevVolumeTracing === volumeTracing) {
    return;
  }
  if (prevVolumeTracing.activeCellId !== volumeTracing.activeCellId) {
    yield updateActiveSegmentId(volumeTracing.activeCellId, volumeTracing.tracingId);
  }
  if (prevVolumeTracing.largestSegmentId !== volumeTracing.largestSegmentId) {
    yield updateLargestSegmentId(volumeTracing.largestSegmentId, volumeTracing.tracingId);
  }

  yield* diffBoundingBoxes(
    prevVolumeTracing.userBoundingBoxes,
    volumeTracing.userBoundingBoxes,
    volumeTracing.tracingId,
    AnnotationLayerEnum.Volume,
  );

  if (prevVolumeTracing.segments !== volumeTracing.segments) {
    for (const action of cachedDiffSegmentLists(
      volumeTracing.tracingId,
      prevVolumeTracing.segments,
      volumeTracing.segments,
    )) {
      yield action;
    }
  }

  const groupDiff = diffGroups(prevVolumeTracing.segmentGroups, volumeTracing.segmentGroups);

  if (groupDiff.didContentChange) {
    // The groups (without isExpanded) actually changed. Save them to the server.
    yield updateSegmentGroups(volumeTracing.segmentGroups, volumeTracing.tracingId);
  }

  if (groupDiff.newlyExpandedIds.length > 0) {
    yield updateSegmentGroupsExpandedState(
      groupDiff.newlyExpandedIds,
      true,
      volumeTracing.tracingId,
    );
  }
  if (groupDiff.newlyNotExpandedIds.length > 0) {
    yield updateSegmentGroupsExpandedState(
      groupDiff.newlyNotExpandedIds,
      false,
      volumeTracing.tracingId,
    );
  }

  if (prevVolumeTracing.fallbackLayer != null && volumeTracing.fallbackLayer == null) {
    yield removeFallbackLayer(volumeTracing.tracingId);
  }

  if (
    prevVolumeTracing.mappingName !== volumeTracing.mappingName ||
    prevVolumeTracing.mappingIsLocked !== volumeTracing.mappingIsLocked
  ) {
    // Once the first volume action is performed on a volume layer, the mapping state is locked.
    // In case no mapping is active, this is denoted by setting the mapping name to null.
    const action = updateMappingName(
      volumeTracing.mappingName || null,
      volumeTracing.hasEditableMapping || null,
      volumeTracing.mappingIsLocked,
      volumeTracing.tracingId,
    );
    yield action;
  }
}

export const cachedDiffSegmentLists = memoizeOne(
  (tracingId: string, prevSegments: SegmentMap, newSegments: SegmentMap) =>
    Array.from(uncachedDiffSegmentLists(tracingId, prevSegments, newSegments)),
);

function* uncachedDiffSegmentLists(
  tracingId: string,
  prevSegments: SegmentMap,
  newSegments: SegmentMap,
): Generator<UpdateActionWithoutIsolationRequirement, void, void> {
  const {
    onlyA: deletedSegmentIds,
    onlyB: addedSegmentIds,
    changed: bothSegmentIds,
  } = diffDiffableMaps(prevSegments, newSegments);

  for (const segmentId of deletedSegmentIds) {
    yield deleteSegmentVolumeAction(segmentId, tracingId);
  }

  for (const segmentId of addedSegmentIds) {
    const segment = newSegments.getOrThrow(segmentId);
    yield createSegmentVolumeAction(
      segment.id,
      segment.anchorPosition,
      segment.additionalCoordinates,
      segment.name,
      segment.color,
      segment.groupId,
      segment.metadata,
      tracingId,
    );
    if (!segment.isVisible) {
      yield updateSegmentVisibilityVolumeAction(segment.id, segment.isVisible, tracingId);
    }
  }

  for (const segmentId of bothSegmentIds) {
    const segment = newSegments.getOrThrow(segmentId);
    const prevSegment = prevSegments.getOrThrow(segmentId);

    const changedPropertyNames: Set<Exclude<keyof Segment, "isVisible">> = new Set();
    for (const propertyName of SegmentPropertiesWithoutUserState) {
      if (!_.isEqual(prevSegment[propertyName], segment[propertyName])) {
        changedPropertyNames.add(propertyName);
      }
    }
    if (changedPropertyNames.size > 0) {
      if (changedPropertyNames.has("metadata")) {
        changedPropertyNames.delete("metadata");
        yield* diffMetadataOfSegments(segment, prevSegment, tracingId);
      }

      yield updateSegmentPartialVolumeAction(
        Object.fromEntries([
          ["id", segment.id],
          ...Array.from(changedPropertyNames).map((prop) => [prop, segment[prop]]),
        ]),
        tracingId,
      );
    }

    if (segment.isVisible !== prevSegment.isVisible) {
      yield updateSegmentVisibilityVolumeAction(segment.id, segment.isVisible, tracingId);
    }
  }
}

export function* diffMetadataOfSegments(segment: Segment, prevSegment: Segment, tracingId: string) {
  const { metadata } = segment;
  const { metadata: prevMetadata } = prevSegment;

  if (metadata === prevMetadata) {
    return;
  }

  const metadataDict = _.keyBy(metadata, "key");
  const prevMetadataDict = _.keyBy(prevMetadata, "key");

  const { both, onlyA, onlyB } = diffArrays(
    prevMetadata.map((m) => m.key),
    metadata.map((m) => m.key),
  );

  const changedKeys = both.filter((key) => metadataDict[key] !== prevMetadataDict[key]);
  const upsertEntriesByKey = [
    ...changedKeys.map((key) => metadataDict[key]),
    ...onlyB.map((key) => metadataDict[key]),
  ];
  const removeEntriesByKey = onlyA;

  yield updateMetadataOfSegmentUpdateAction(
    segment.id,
    upsertEntriesByKey,
    removeEntriesByKey,
    tracingId,
  );
}

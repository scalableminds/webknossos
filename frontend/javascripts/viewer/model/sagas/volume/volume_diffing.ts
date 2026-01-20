import { diffDiffableMaps } from "libs/diffable_map";
import { diffArrays } from "libs/utils";
import _ from "lodash";
import memoizeOne from "memoize-one";
import { AnnotationLayerEnum } from "types/api_types";
import {
  type GranularGroupDiff,
  type ParentUpdate,
  buildOrderDependencies,
  diffBoundingBoxes,
  diffGroupsGranular,
  topologicallySortUpdates,
} from "viewer/model/helpers/diff_helpers";
import {
  type UpdateActionWithoutIsolationRequirement,
  createSegmentVolumeAction,
  deleteSegmentGroupUpdateAction,
  deleteSegmentVolumeAction,
  mergeSegmentsVolumeAction,
  removeFallbackLayer,
  updateActiveSegmentId,
  updateLargestSegmentId,
  updateMappingName,
  updateMetadataOfSegmentUpdateAction,
  updateSegmentGroupsExpandedState,
  updateSegmentPartialVolumeAction,
  updateSegmentVisibilityVolumeAction,
  upsertSegmentGroupUpdateAction,
} from "viewer/model/sagas/volume/update_actions";
import {
  type Segment,
  type SegmentGroup,
  type SegmentJournalEntry,
  type SegmentMap,
  SegmentPropertiesWithoutUserState,
  type VolumeTracing,
} from "viewer/store";

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

  if (
    prevVolumeTracing.segments !== volumeTracing.segments ||
    prevVolumeTracing.segmentJournal !== volumeTracing.segmentJournal
  ) {
    for (const action of cachedDiffSegmentLists(
      volumeTracing.tracingId,
      prevVolumeTracing.segments,
      volumeTracing.segments,
      prevVolumeTracing.segmentJournal,
      volumeTracing.segmentJournal,
    )) {
      yield action;
    }
  }

  yield* diffSegmentGroups(
    prevVolumeTracing.segmentGroups,
    volumeTracing.segmentGroups,
    volumeTracing.tracingId,
  );

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
  (
    tracingId: string,
    prevSegments: SegmentMap,
    newSegments: SegmentMap,
    prevSegmentJournal: Array<SegmentJournalEntry>,
    segmentJournal: Array<SegmentJournalEntry>,
  ) =>
    Array.from(
      uncachedDiffSegmentLists(
        tracingId,
        prevSegments,
        newSegments,
        prevSegmentJournal,
        segmentJournal,
      ),
    ),
);

function* uncachedDiffSegmentLists(
  tracingId: string,
  prevSegments: SegmentMap,
  newSegments: SegmentMap,
  prevSegmentJournal: Array<SegmentJournalEntry>,
  segmentJournal: Array<SegmentJournalEntry>,
): Generator<UpdateActionWithoutIsolationRequirement, void, void> {
  const {
    onlyA: initialDeletedSegmentIds,
    onlyB: addedSegmentIds,
    changed: bothSegmentIds,
  } = diffDiffableMaps(prevSegments, newSegments);
  const deletedSegmentIdSet = new Set(initialDeletedSegmentIds);

  const prevLatestJournalEntryIndex = prevSegmentJournal.at(-1)?.entryIndex;
  const journalDiff =
    prevLatestJournalEntryIndex == null
      ? segmentJournal
      : (() => {
          const splitIndex = _.sortedIndexBy<{ entryIndex: number }>(
            segmentJournal,
            { entryIndex: prevLatestJournalEntryIndex },
            "entryIndex",
          );

          return segmentJournal.slice(splitIndex + 1);
        })();

  for (const mergeJournalEntry of journalDiff) {
    // todop: what about the source segment that got its name changed potentially?
    // that should (?) be respected so that no updateSegmentPartialVolumeAction
    // is emitted for that.
    yield mergeSegmentsVolumeAction(
      mergeJournalEntry.sourceId,
      mergeJournalEntry.targetId,
      tracingId,
    );

    // Note that the merge entry doesn't always imply the existence
    // of targetId in deletedSegmentIdSet. This happens when two agglomerates
    // were merged, but there was no segment item for the target.
    // The following line will be a no-op then.
    deletedSegmentIdSet.delete(mergeJournalEntry.targetId);
  }

  for (const segmentId of deletedSegmentIdSet) {
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

export function* diffSegmentGroups(
  prevSegmentGroups: SegmentGroup[],
  segmentGroups: SegmentGroup[],
  volumeTracingId: string,
) {
  const groupDiff = diffGroupsGranular(prevSegmentGroups, segmentGroups);

  // Delete groups that don't exist in volumeTracing anymore
  for (const groupId of groupDiff.onlyA) {
    yield deleteSegmentGroupUpdateAction(groupId, volumeTracingId);
  }

  // Update groups that were changed
  yield* getOrderedUpsertsForChangedItems(groupDiff, volumeTracingId);

  // Add new groups
  for (const groupId of groupDiff.onlyB) {
    const group = groupDiff.groupsById.get(groupId)!;
    yield upsertSegmentGroupUpdateAction(
      groupId,
      {
        name: group.name,
        newParentId: group.parentGroupId,
      },
      volumeTracingId,
    );
  }

  // Update expanded state
  if (groupDiff.newlyExpandedIds.length > 0) {
    yield updateSegmentGroupsExpandedState(groupDiff.newlyExpandedIds, true, volumeTracingId);
  }
  if (groupDiff.newlyNotExpandedIds.length > 0) {
    yield updateSegmentGroupsExpandedState(groupDiff.newlyNotExpandedIds, false, volumeTracingId);
  }
}

function* getOrderedUpsertsForChangedItems(groupDiff: GranularGroupDiff, volumeTracingId: string) {
  // Groups are diffed by comparing old and new properties. When updating
  // the parentGroupId, we must be careful that we don't move a group into one
  // of its subgroups first (instead, that action should come after an update action
  // that hoists the subgroup).
  // For that we first build temporary ParentUpdate descriptors, sort these and then
  // yield the actual upsertSegmentGroupUpdateAction.

  const parentUpdates: ParentUpdate[] = [];

  for (const groupId of groupDiff.changed) {
    const prevGroup = groupDiff.prevGroupsById.get(groupId)!;
    const group = groupDiff.groupsById.get(groupId)!;

    const parentChanged = prevGroup.parentGroupId !== group.parentGroupId;
    const nameChanged = prevGroup.name !== group.name;

    if (!parentChanged && !nameChanged) continue;

    parentUpdates.push({
      groupId,
      from: prevGroup.parentGroupId,
      to: group.parentGroupId,
      nameChanged,
      newName: nameChanged ? group.name : undefined,
    });
  }

  const deps = buildOrderDependencies(parentUpdates, groupDiff.prevGroupsById);
  const orderedUpdates = topologicallySortUpdates(parentUpdates, deps);

  for (const u of orderedUpdates) {
    yield upsertSegmentGroupUpdateAction(
      u.groupId,
      {
        ...(u.nameChanged ? { name: u.newName } : {}),
        ...(u.from !== u.to ? { newParentId: u.to } : {}),
      },
      volumeTracingId,
    );
  }
}

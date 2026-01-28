import { diffDiffableMaps } from "libs/diffable_map";
import { ColoredLogger, diffArrays } from "libs/utils";
import isEqual from "lodash/isEqual";
import keyBy from "lodash/keyBy";
import sortedIndexBy from "lodash/sortedIndexBy";
import memoizeOne from "memoize-one";
import { AnnotationLayerEnum } from "types/api_types";
import {
  buildOrderDependencies,
  diffBoundingBoxes,
  diffGroupsGranular,
  type GranularGroupDiff,
  type ParentUpdate,
  topologicallySortUpdates,
} from "viewer/model/helpers/diff_helpers";
import { getUpdatedSourcePropsAfterMerge } from "viewer/model/reducers/volumetracing_reducer_helpers";
import {
  createSegmentVolumeAction,
  deleteSegmentGroupUpdateAction,
  deleteSegmentVolumeAction,
  mergeSegmentsVolumeAction,
  removeFallbackLayer,
  type UpdateActionWithoutIsolationRequirement,
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

function diffSegmentJournals(
  prevSegmentJournal: SegmentJournalEntry[],
  segmentJournal: SegmentJournalEntry[],
) {
  const prevLatestJournalEntryIndex = prevSegmentJournal.at(-1)?.entryIndex;
  const journalDiff =
    prevLatestJournalEntryIndex == null
      ? segmentJournal
      : (() => {
          const splitIndex = sortedIndexBy<{ entryIndex: number }>(
            segmentJournal,
            { entryIndex: prevLatestJournalEntryIndex },
            "entryIndex",
          );

          return segmentJournal.slice(splitIndex + 1);
        })();
  return journalDiff;
}

export function* uncachedDiffSegmentLists(
  tracingId: string,
  prevSegments: SegmentMap,
  newSegments: SegmentMap,
  prevSegmentJournal: Array<SegmentJournalEntry>,
  segmentJournal: Array<SegmentJournalEntry>,
): Generator<UpdateActionWithoutIsolationRequirement, void, void> {
  /*
   * This function diffs (a) prevSegments and (b) newSegments and outputs UpdateActions
   * that transform a to b.
   * Additionally, the segmentJournals for "prev" and "current" are passed.
   * These journals are also diffed so that we can infer whether a mergeSegments operation
   * happened (currently, this can only happen during proofreading).
   * If such mergeSegments operations were found, `prevSegments` will be transformed
   * by applying these merge operations.
   * Afterwards, the "new" `prevSegments` will be diffed against `segments`. This approach
   * ensures that we can still detect additional changes to segments that were also part of a
   * mergeSegments operation.
   * The downside of this approach is that we always assume that a merge operation happened *first*
   * and only afterwards the segments were edited. In practice, the diff is computed so frequently
   * that this shouldn't matter, though.
   */
  const journalDiff = diffSegmentJournals(prevSegmentJournal, segmentJournal);
  prevSegments = applyJournalDiffOnSegments(prevSegments, newSegments, journalDiff);

  for (const journalEntry of journalDiff) {
    yield mergeSegmentsVolumeAction(journalEntry.sourceId, journalEntry.targetId, tracingId);
  }

  const {
    onlyA: initialDeletedSegmentIds,
    onlyB: addedSegmentIds,
    changed: bothSegmentIds,
  } = diffDiffableMaps(prevSegments, newSegments);
  const deletedSegmentIdSet = new Set(initialDeletedSegmentIds);

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
      if (!isEqual(prevSegment[propertyName], segment[propertyName])) {
        changedPropertyNames.add(propertyName);
      }
    }
    if (changedPropertyNames.has("metadata")) {
      changedPropertyNames.delete("metadata");
      yield* diffMetadataOfSegments(segment, prevSegment, tracingId);
    }
    if (changedPropertyNames.size > 0) {
      ColoredLogger.logRed("changedPropertyNames", changedPropertyNames);
      console.log("  diffed were prevSegment:", prevSegment);
      console.log("  diffed were segment:", segment);
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

  const metadataDict = keyBy(metadata, "key");
  const prevMetadataDict = keyBy(prevMetadata, "key");

  const { both, onlyA, onlyB } = diffArrays(
    prevMetadata.map((m) => m.key),
    metadata.map((m) => m.key),
  );

  const changedKeys = both.filter((key) => !isEqual(metadataDict[key], prevMetadataDict[key]));
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

function applyJournalDiffOnSegments(
  prevSegments: SegmentMap,
  newSegments: SegmentMap,
  journalDiff: SegmentJournalEntry[],
): SegmentMap {
  /*
   * All operations in journalDiff are applied on prevSegments
   * and a new SegmentMap is returned as a result.
   * See the docstring in uncachedDiffSegmentLists for an explanation
   * of the context.
   * `newSegments` is only needed to provide a safe fallback value
   * for the creationTime because the timestamp cannot be reliably
   * reconstructed otherwise.
   */
  for (const journalEntry of journalDiff) {
    const prevSourceSegment = prevSegments.getNullable(journalEntry.sourceId);
    const fallbackCreationTime = newSegments.getNullable(journalEntry.sourceId)?.creationTime;
    const updatedSourceProps = getUpdatedSourcePropsAfterMerge(
      journalEntry.sourceId,
      journalEntry.targetId,
      prevSourceSegment,
      prevSegments.getNullable(journalEntry.targetId),
    );

    const newSourceSegment: Segment =
      prevSourceSegment != null
        ? {
            ...prevSourceSegment,
            ...updatedSourceProps,
          }
        : {
            id: journalEntry.sourceId,
            creationTime: fallbackCreationTime ?? 0,
            name: null,
            color: null,
            groupId: null,
            isVisible: true,
            anchorPosition: undefined,
            metadata: [],
            ...updatedSourceProps,
          };

    // Note the immutability of set and delete.
    prevSegments = prevSegments.set(journalEntry.sourceId, newSourceSegment);
    prevSegments = prevSegments.delete(journalEntry.targetId);
  }

  return prevSegments;
}

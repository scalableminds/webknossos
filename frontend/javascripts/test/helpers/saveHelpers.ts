import type { TracingStats } from "viewer/model/accessors/annotation_accessor";
import type { UpdateActionWithoutIsolationRequirement } from "viewer/model/sagas/volume/update_actions";
import type { SaveQueueEntry } from "viewer/store";
import { idUserA } from "test/e2e-setup";
import dummyUser from "test/fixtures/dummy_user";

export function createSaveQueueFromUpdateActions(
  updateActions: UpdateActionWithoutIsolationRequirement[][],
  timestamp: number,
  stats: TracingStats | null = null,
  useE2eAuthorId: boolean = false,
  // If initialVersion is -1, all versions will be assigned -1
  // because it is a placeholder. Otherwise, the version will
  // be incremented for each batch.
  initialVersion: number = -1,
): SaveQueueEntry[] {
  return updateActions.map((ua, index) => ({
    version: initialVersion === -1 ? -1 : initialVersion + index,
    timestamp,
    stats,
    actions: ua,
    info: "[]",
    transactionGroupCount: 1,
    authorId: useE2eAuthorId ? idUserA : dummyUser.id,
    transactionGroupIndex: 0,
    transactionId: "dummyRequestId",
  }));
}

export function withoutUpdateActiveItemTracing(
  items: UpdateActionWithoutIsolationRequirement[],
): UpdateActionWithoutIsolationRequirement[] {
  return items.filter(
    (item) => item.name !== "updateActiveNode" && item.name !== "updateActiveSegmentId",
  );
}

export function withoutUpdateTree(
  items: UpdateActionWithoutIsolationRequirement[],
): UpdateActionWithoutIsolationRequirement[] {
  return items.filter((item) => item.name !== "updateTree");
}

export function withoutUpdateSegment(
  items: UpdateActionWithoutIsolationRequirement[],
): UpdateActionWithoutIsolationRequirement[] {
  return items.filter((item) => item.name !== "updateSegment");
}
